import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { MOCK_OPTIONS, mockOptions, mockSubscription } from './dc-options.mocks'

// Area dc-options: datacenter options (/datacenter/options) and node
// subscriptions (/datacenter/options/subscription/:node, /node/:node/subscription).
//
// Lab test (@lab, desktop): records the whole /cluster/options first, edits
// options that cannot disturb other areas' tests (values equal or close to
// the defaults, tags named e2e-dcopt) and restores the recorded options
// exactly afterwards. Console, consent text, WebAuthn and migration network
// are never written on the lab. Subscriptions are only ever mocked: no key is
// uploaded to or removed from the lab.
// Phone tests (@mobile) use page.route() mocks.

type Options = Record<string, unknown>

/** Computed by GET, not settable. */
const COMPUTED = new Set(['allowed-tags'])

/** A GET value as an order-independent PUT string. */
function asText(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined
  if (Array.isArray(v)) return v.length ? v.map(String).join(';') : undefined
  if (typeof v === 'object') {
    const parts = Object.entries(v as Options)
      .filter(([, x]) => x !== undefined && x !== null && x !== '')
      .map(([k, x]) => `${k}=${Array.isArray(x) ? x.join(';') : String(x)}`)
    return parts.length ? parts.join(',') : undefined
  }
  return String(v)
}
const canon = (v: unknown) => asText(v)?.split(',').sort().join(',')

const getOptions = (pve: PveApi) => pve.get<Options>('/cluster/options')

/** Put /cluster/options back to `before`: changed keys rewritten, new keys deleted. */
async function restoreOptions(pve: PveApi, before: Options) {
  const now = await getOptions(pve)
  const params: Record<string, string> = {}
  const del: string[] = []
  for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (COMPUTED.has(key) || canon(before[key]) === canon(now[key])) continue
    const value = asText(before[key])
    if (value === undefined) del.push(key)
    else params[key] = value
  }
  if (del.length) params.delete = del.join(',')
  if (Object.keys(params).length) await pve.put('/cluster/options', params)
}

function changed(before: Options, after: Options): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !COMPUTED.has(k) && canon(before[k]) !== canon(after[k]))
}

async function openOption(page: Page, key: string, label: string, title = label) {
  await page.locator(`[data-option="${key}"]`).getByRole('button', { name: new RegExp(`^${label}：`) }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  return dialog
}

async function pick(page: Page, dialog: ReturnType<Page['getByRole']>, field: string, option: string | RegExp) {
  await dialog.getByRole('combobox', { name: field, exact: true }).click()
  await page.getByRole('option', { name: option }).click()
}

test.describe('datacenter options on the lab', { tag: '@lab' }, () => {
  let before: Options

  test.beforeAll(async ({ pve }) => {
    before = await getOptions(pve)
  })
  test.afterAll(async ({ pve }) => {
    await restoreOptions(pve, before)
    expect(changed(before, await getOptions(pve)), '/cluster/options 没有恢复原样').toEqual([])
  })

  test('edit options and restore defaults', async ({ page, pve }) => {
    test.setTimeout(150_000)
    const opt = async (key: string) => (await getOptions(pve))[key]
    try {
      await page.goto('/datacenter/options')
      await expect(page.getByRole('heading', { name: '数据中心选项', level: 1 })).toBeVisible()
      await expect(page.locator('[data-option="keyboard"]')).toContainText('en-us')

      await test.step('number option, then 恢复默认 from the row menu', async () => {
        const dialog = await openOption(page, 'max_workers', '批量操作最大并发')
        await dialog.getByRole('textbox', { name: '最大并发' }).fill('5')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect(dialog).toBeHidden()
        await expect.poll(async () => String(await opt('max_workers'))).toBe('5')
        await expect(page.locator('[data-option="max_workers"]')).toContainText('5')
        await page.getByRole('button', { name: '更多操作：批量操作最大并发' }).click()
        await page.getByRole('menuitem', { name: '恢复默认' }).click()
        await expect.poll(() => opt('max_workers')).toBeUndefined()
        await expect(page.locator('[data-option="max_workers"]')).toContainText('默认（4）')
      })

      await test.step('select option', async () => {
        const dialog = await openOption(page, 'keyboard', '键盘布局')
        await pick(page, dialog, '键盘布局', '英语（英国）（en-gb）')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(() => opt('keyboard')).toBe('en-gb')
        await restoreOptions(pve, before) // the console area reads the keyboard layout
      })

      await test.step('bandwidth limit with a unit', async () => {
        const dialog = await openOption(page, 'bwlimit', '带宽限制')
        await pick(page, dialog, '迁移单位', 'GiB/s')
        await dialog.getByRole('textbox', { name: '迁移', exact: true }).fill('1')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(() => opt('bwlimit')).toBe('migration=1048576')
        await expect(page.locator('[data-option="bwlimit"]')).toContainText('迁移 1 GiB/s')
      })

      await test.step('next-id range is validated', async () => {
        const dialog = await openOption(page, 'next-id', 'VMID 自动分配范围')
        await dialog.getByRole('textbox', { name: '下限' }).fill('6000')
        await dialog.getByRole('textbox', { name: '上限' }).fill('5000')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect(dialog.getByText('必须大于下限')).toBeVisible()
        // The default range, written out: harmless for the other areas.
        await dialog.getByRole('textbox', { name: '下限' }).fill('100')
        await dialog.getByRole('textbox', { name: '上限' }).fill('1000000')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(async () => asText(await opt('next-id'))).toMatch(/lower=100.*upper=1000000|upper=1000000.*lower=100/)
      })

      await test.step('CRS', async () => {
        const dialog = await openOption(page, 'crs', '集群资源调度')
        await expect(dialog.getByRole('switch', { name: '自动重新平衡' })).toBeDisabled()
        await pick(page, dialog, '调度模式', '静态负载')
        await dialog.getByRole('switch', { name: '自动重新平衡' }).click()
        await dialog.getByRole('textbox', { name: '不均衡阈值' }).fill('40')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(async () => canon(await opt('crs'))).toBe('ha-auto-rebalance-threshold=40,ha-auto-rebalance=1,ha=static')
      })

      await test.step('tag style with a colour override', async () => {
        const dialog = await openOption(page, 'tag-style', '标签样式')
        await pick(page, dialog, '资源树形状', /^完整/)
        await dialog.getByRole('button', { name: '添加覆盖' }).click()
        await dialog.getByRole('textbox', { name: '标签', exact: true }).fill('e2e-dcopt')
        await dialog.getByLabel('e2e-dcopt 背景色').fill('#d92d20')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(async () => canon(await opt('tag-style'))).toBe('color-map=e2e-dcopt:D92D20,shape=full')
        await expect(page.locator('[data-option="tag-style"]')).toContainText('1 个颜色覆盖')
      })

      await test.step('registered tags and user tag access', async () => {
        let dialog = await openOption(page, 'registered-tags', '注册标签')
        await dialog.getByRole('textbox', { name: '添加注册标签' }).fill('e2e-dcopt')
        await dialog.getByRole('textbox', { name: '添加注册标签' }).press('Enter')
        await expect(dialog.getByRole('list', { name: '注册标签' })).toContainText('e2e-dcopt')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(() => opt('registered-tags')).toEqual(['e2e-dcopt'])

        dialog = await openOption(page, 'user-tag-access', '用户标签权限')
        await pick(page, dialog, '模式', /^free/)
        await dialog.getByRole('textbox', { name: '添加预定义标签' }).fill('e2e-dcopt')
        await dialog.getByRole('button', { name: '添加', exact: true }).click()
        await expect(dialog.getByText(/同时是注册标签/)).toBeVisible()
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect.poll(async () => canon(await opt('user-tag-access'))).toBe('user-allow-list=e2e-dcopt,user-allow=free')
      })

      await test.step('saving an unchanged dialog sends nothing', async () => {
        const writes: string[] = []
        page.on('request', (r) => {
          if (r.url().includes('/cluster/options') && r.method() === 'PUT') writes.push(r.postData() ?? '')
        })
        const dialog = await openOption(page, 'crs', '集群资源调度')
        await dialog.getByRole('button', { name: '保存' }).click()
        await expect(dialog).toBeHidden()
        expect(writes).toEqual([])
      })
    } finally {
      await restoreOptions(pve, before)
    }
  })
})

test.describe('phone layout (mocked)', { tag: '@mobile' }, () => {
  test('options list, editors and a mocked save', async ({ page }) => {
    const writes = await mockOptions(page)
    await page.goto('/datacenter/options')
    await expect(page.locator('[data-option="bwlimit"]')).toContainText('默认 100 MiB/s，备份恢复 50 MiB/s')
    await expect(page.locator('[data-option="migration"]')).toContainText('网络 10.10.0.0/24')
    await expect(page.locator('[data-option="consent-text"]')).toContainText('仅限授权人员')
    await expect(page.locator('[data-option="user-tag-access"]')).toContainText('模式 existing')

    // Tag style: two overrides from the mocked color-map.
    let sheet = await openOption(page, 'tag-style', '标签样式')
    await expect(sheet.getByTestId('color-override')).toHaveCount(2)
    await expect(sheet.getByRole('textbox', { name: '标签', exact: true }).first()).toHaveValue('prod')
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toBeHidden()

    sheet = await openOption(page, 'webauthn', 'WebAuthn', 'WebAuthn 设置')
    await expect(sheet.getByRole('textbox', { name: /ID/ })).toHaveValue('pve.example.com')
    await sheet.getByRole('textbox', { name: /ID/ }).fill('other.example.com')
    await expect(sheet.getByText('更改 ID 会使已经注册的 WebAuthn 两步验证全部失效。')).toBeVisible()
    await sheet.getByRole('button', { name: '取消' }).click()
    await expect(sheet).toBeHidden()

    // A save sends only the changed key.
    sheet = await openOption(page, 'max_workers', '批量操作最大并发')
    await sheet.getByRole('textbox', { name: '最大并发' }).fill('10')
    await sheet.getByRole('button', { name: '保存' }).click()
    await expect(sheet).toBeHidden()
    expect(writes.map((r) => r.postData())).toEqual(['max_workers=10'])

    // Clearing a value deletes it.
    sheet = await openOption(page, 'http_proxy', 'HTTP 代理')
    await sheet.getByRole('textbox', { name: 'HTTP 代理' }).fill('')
    await sheet.getByRole('button', { name: '保存' }).click()
    await expect(sheet).toBeHidden()
    expect(writes.map((r) => r.postData())).toEqual(['max_workers=10', 'delete=http_proxy'])
    expect(MOCK_OPTIONS.http_proxy).toBeTruthy()
  })

  test('node subscription actions (mocked)', async ({ page, pve }) => {
    const writes = await mockSubscription(page, pve.node)
    await page.goto('/datacenter/options')
    await page.locator(`[data-node="${pve.node}"]`).click()
    await expect(page).toHaveURL(new RegExp(`/datacenter/options/subscription/${pve.node}$`))
    await expect(page.getByText('有效 · Community').first()).toBeVisible()
    await expect(page.getByText('pve1c-0123456789')).toBeVisible()

    const bar = page.getByRole('toolbar', { name: '订阅操作' })
    await bar.getByRole('button', { name: '上传密钥' }).click()
    const upload = page.getByRole('dialog', { name: '上传订阅密钥' })
    await upload.getByRole('textbox', { name: '订阅密钥' }).fill('not-a-key')
    await upload.getByRole('button', { name: '上传' }).click()
    await expect(upload.getByText('格式如 pve2c-0123456789').first()).toBeVisible()
    await upload.getByRole('textbox', { name: '订阅密钥' }).fill(' pve2c-0123456789 ')
    await upload.getByRole('button', { name: '上传' }).click()
    await expect(upload).toBeHidden()

    await bar.getByRole('button', { name: '检查' }).click()
    await expect.poll(() => writes.length).toBe(2)

    await bar.getByRole('button', { name: '删除订阅' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect.poll(() => writes.length).toBe(3)
    expect(writes.map((r) => `${r.method()} ${r.postData() ?? ''}`)).toEqual(['PUT key=pve2c-0123456789', 'POST force=1', 'DELETE '])

    await bar.getByRole('button', { name: '系统报告' }).click()
    await expect(page.getByRole('dialog', { name: '系统报告' })).toContainText('pve-manager: 9.2.21')
  })

  test('node subscription tab', async ({ page, pve }) => {
    await mockSubscription(page, pve.node, { status: 'notfound', serverid: 'FAC0B9201BBD4F98A875A4F1730951F3', message: 'There is no subscription key' })
    await page.goto(`/node/${pve.node}/subscription`)
    await expect(page.getByText('没有订阅密钥').first()).toBeVisible()
    await expect(page.getByRole('toolbar', { name: '订阅操作' }).getByRole('button', { name: '删除订阅' })).toHaveCount(0)
  })
})
