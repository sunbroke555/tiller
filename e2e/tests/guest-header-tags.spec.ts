import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// All writes in this spec are browser mocks, including on mobile. The shared
// lab guests and the datacenter's global colour map are never changed.
async function mockTags(page: Page, pve: PveApi, vmid = 100) {
  const resources = await pve.get<Array<{ vmid?: number; node: string; type: string; tags?: string }>>('/cluster/resources')
  const guest = resources.find((g) => g.vmid === vmid)!
  const config = await pve.get<Record<string, unknown>>(`/nodes/${guest.node}/${guest.type}/${vmid}/config`)
  const state = {
    tags: vmid === 200 ? '' : 'keep',
    style: 'color-map=keep:AABBCC:112233;other:334455,shape=dense,ordering=config',
    configWrites: [] as URLSearchParams[],
    styleWrites: [] as URLSearchParams[],
    failColor: false,
    failConfig: false,
  }
  await page.route(/\/api2\/json\/cluster\/resources(?:\?.*)?$/, (route) => route.fulfill({ json: { data: resources.map((g) => g.vmid === vmid ? { ...g, tags: state.tags } : g) } }))
  await page.route(/\/api2\/json\/cluster\/options(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'PUT') {
      const params = new URLSearchParams(route.request().postData() ?? '')
      state.styleWrites.push(params)
      if (state.failColor) {
        state.failColor = false
        return route.fulfill({ status: 500, json: { data: null, message: '颜色保存失败' } })
      }
      state.style = params.get('tag-style') ?? ''
    }
    return route.fulfill({ json: { data: { 'tag-style': state.style, 'registered-tags': ['reserved'], 'user-tag-access': 'user-allow=free' } } })
  })
  await page.route(new RegExp(`/api2/json/nodes/[^/]+/${guest.type}/${vmid}/config(?:\\?.*)?$`), (route) => {
    if (route.request().method() === 'PUT') {
      const params = new URLSearchParams(route.request().postData() ?? '')
      state.configWrites.push(params)
      if (state.failConfig) {
        state.failConfig = false
        return route.fulfill({ status: 500, json: { data: null, message: '标签删除失败，请重试' } })
      }
      if (params.get('delete')?.split(',').includes('tags')) state.tags = ''
      else if (params.has('tags')) state.tags = params.get('tags')!
    }
    return route.fulfill({ json: { data: { ...config, tags: state.tags, digest: 'current-digest' } } })
  })
  await page.goto(`/guest/${guest.node}/${guest.type}/${vmid}`)
  await expect(page.locator('header').getByRole('button', { name: '添加标签', exact: true })).toBeVisible()
  return state
}

const header = (page: Page) => page.locator('header', { has: page.getByRole('heading', { level: 1 }) })
const add = async (page: Page) => {
  await header(page).getByRole('button', { name: '添加标签', exact: true }).click()
  return page.getByRole('dialog', { name: '添加标签', exact: true })
}

test('header adds a coloured tag, preserves concurrent tags and refreshes all views', async ({ page, pve, mobile }, info) => {
  const state = await mockTags(page, pve)
  state.tags = 'keep;concurrent'
  const editor = await add(page)
  await editor.getByLabel('标签名称').fill('quick-tag')
  await editor.getByRole('button', { name: '颜色 #82BBDD', exact: true }).click()
  await editor.getByLabel('颜色值', { exact: true }).fill(' #123456 ')
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: info.outputPath('quick-add.png') })
  await editor.getByRole('button', { name: '添加', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(state.tags).toBe('keep;concurrent;quick-tag')
  expect(state.configWrites[0]!.get('digest')).toBe('current-digest')
  expect(state.style).toBe('color-map=keep:AABBCC:112233;other:334455;quick-tag:123456,shape=dense,ordering=config')
  const chip = header(page).getByRole('button', { name: '编辑标签 quick-tag', exact: true })
  await expect(chip.locator('[style]')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  if (!mobile) await expect(page.getByRole('tree').locator('[aria-label="标签 quick-tag"]')).toHaveCSS('background-color', 'rgb(18, 52, 86)')
  await page.reload()
  await chip.click()
  const colors = page.getByRole('dialog', { name: '编辑标签 quick-tag', exact: true })
  await expect(colors.getByLabel('颜色值', { exact: true })).toHaveValue('#123456')
  await colors.getByRole('button', { name: '默认色', exact: true }).click()
  await colors.getByRole('button', { name: '保存颜色', exact: true }).click()
  await expect(colors).toBeHidden()
  expect(state.style).toBe('color-map=keep:AABBCC:112233;other:334455,shape=dense,ordering=config')
  expect(state.configWrites).toHaveLength(1)
})

test('failed colour save can be retried without adding the tag twice', async ({ page, pve }) => {
  const state = await mockTags(page, pve)
  state.failColor = true
  const editor = await add(page)
  await editor.getByLabel('标签名称').fill('retry-tag')
  await editor.getByRole('button', { name: '颜色 #82BBDD', exact: true }).click()
  await editor.getByRole('button', { name: '添加', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('标签已添加，颜色未保存')
  await editor.getByRole('button', { name: '保存颜色', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(state.configWrites).toHaveLength(1)
  expect(state.tags).toBe('keep;retry-tag')
  expect(state.styleWrites).toHaveLength(2)
  expect(state.style).toContain('retry-tag:82BBDD')
})

test('invalid input and cancellation leave tags and colours unchanged', async ({ page, pve }) => {
  const state = await mockTags(page, pve)
  const editor = await add(page)
  await editor.getByLabel('标签名称').fill('bad tag')
  await editor.getByRole('button', { name: '添加', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('只能包含')
  await editor.getByLabel('标签名称').fill('keep')
  await editor.getByRole('button', { name: '添加', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('标签已存在')
  await editor.getByLabel('标签名称').fill('valid')
  await editor.getByLabel('颜色值', { exact: true }).fill('#xyz')
  await expect(editor.getByRole('button', { name: '添加', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: '取消', exact: true }).click()
  expect(state.configWrites).toHaveLength(0)
  expect(state.styleWrites).toHaveLength(0)
})

test('guest-only permission allows ordinary tags but hides global colour editing', async ({ page, pve }) => {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage).filter((key) => key.startsWith('tiller:session'))) {
      const session = JSON.parse(localStorage.getItem(key)!)
      session.username = 'tag-editor@pve'
      localStorage.setItem(key, JSON.stringify(session))
    }
  })
  await page.route(/\/api2\/json\/access\/permissions(?:\?.*)?$/, (route) => route.fulfill({ json: { data: { '/vms/100': { 'VM.Audit': 1, 'VM.Config.Options': 1 }, '/': { 'Sys.Audit': 1 } } } }))
  const state = await mockTags(page, pve)
  await expect(header(page).getByRole('button', { name: '编辑标签 keep', exact: true })).toBeVisible()
  const editor = await add(page)
  await expect(editor.getByLabel('自定义标签颜色')).toHaveCount(0)
  await editor.getByLabel('标签名称').fill('reserved')
  await editor.getByRole('button', { name: '添加', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('管理员权限')
  await editor.getByLabel('标签名称').fill('ordinary')
  await editor.getByRole('button', { name: '添加', exact: true }).click()
  await expect(editor).toBeHidden()
  expect(state.tags).toBe('keep;ordinary')
  expect(state.styleWrites).toHaveLength(0)

  await header(page).getByRole('button', { name: '编辑标签 ordinary', exact: true }).click()
  const ordinary = page.getByRole('dialog', { name: '编辑标签 ordinary', exact: true })
  await expect(ordinary.getByRole('button', { name: '保存颜色', exact: true })).toHaveCount(0)
  await ordinary.getByRole('button', { name: '删除标签', exact: true }).click()
  await expect(ordinary).toBeHidden()
  expect(state.tags).toBe('keep')

  state.tags = 'keep;reserved'
  await page.reload()
  await header(page).getByRole('button', { name: '编辑标签 reserved', exact: true }).click()
  const reserved = page.getByRole('dialog', { name: '编辑标签 reserved', exact: true })
  await expect(reserved.getByRole('button', { name: '删除标签', exact: true })).toBeDisabled()
  await expect(reserved).toContainText('此标签需要管理员权限')
  expect(state.configWrites).toHaveLength(2)
})

test('a container with no tags can add its first tag from the header', async ({ page, pve }) => {
  const state = await mockTags(page, pve, 200)
  const editor = await add(page)
  await editor.getByLabel('标签名称').fill('container')
  await editor.getByLabel('标签名称').press('Enter')
  await expect(editor).toBeHidden()
  await expect(header(page).getByRole('button', { name: '编辑标签 container', exact: true })).toBeVisible()
  expect(state.tags).toBe('container')
  expect(state.styleWrites).toHaveLength(0)

  await header(page).getByRole('button', { name: '编辑标签 container', exact: true }).click()
  const edit = page.getByRole('dialog', { name: '编辑标签 container', exact: true })
  await edit.getByRole('button', { name: '删除标签', exact: true }).click()
  await expect(edit).toBeHidden()
  await expect(header(page).getByRole('button', { name: '编辑标签 container', exact: true })).toHaveCount(0)
  expect(state.tags).toBe('')
  expect(state.configWrites[1]!.get('delete')).toBe('tags')
  expect(state.configWrites[1]!.has('tags')).toBe(false)
  await expect(header(page).getByRole('button', { name: '添加标签', exact: true })).toBeVisible()
})

test('quick deletion keeps concurrent guest tags and the shared colour map', async ({ page, pve, mobile }, info) => {
  const state = await mockTags(page, pve)
  const originalStyle = state.style
  await header(page).getByRole('button', { name: '编辑标签 keep', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑标签 keep', exact: true })
  state.tags = 'keep;concurrent'
  // A pending colour choice must not be saved when deleting the guest tag.
  await editor.getByRole('button', { name: '颜色 #82BBDD', exact: true }).click()
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: info.outputPath('quick-delete.png') })
  await editor.getByRole('button', { name: '删除标签', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(header(page).getByRole('button', { name: '编辑标签 keep', exact: true })).toHaveCount(0)
  await expect(header(page).getByRole('button', { name: '编辑标签 concurrent', exact: true })).toBeVisible()
  expect(state.tags).toBe('concurrent')
  expect(state.configWrites[0]!.get('digest')).toBe('current-digest')
  expect(state.styleWrites).toHaveLength(0)
  expect(state.style).toBe(originalStyle)
  if (!mobile) await expect(page.getByRole('tree').locator('a[href$="/qemu/100"]').locator('[aria-label="标签 keep"]')).toHaveCount(0)
  await page.reload()
  await expect(header(page).getByRole('button', { name: '编辑标签 keep', exact: true })).toHaveCount(0)
})

test('failed quick deletion keeps the tag visible and supports retry', async ({ page, pve }) => {
  const state = await mockTags(page, pve)
  state.failConfig = true
  const tag = header(page).getByRole('button', { name: '编辑标签 keep', exact: true })
  await tag.click()
  const editor = page.getByRole('dialog', { name: '编辑标签 keep', exact: true })
  await editor.getByRole('button', { name: '删除标签', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('标签删除失败')
  await expect(tag).toBeVisible()
  expect(state.tags).toBe('keep')
  await editor.getByRole('button', { name: '删除标签', exact: true }).click()
  await expect(editor).toBeHidden()
  await expect(tag).toHaveCount(0)
  expect(state.tags).toBe('')
  expect(state.configWrites).toHaveLength(2)
  expect(state.styleWrites).toHaveLength(0)
})
