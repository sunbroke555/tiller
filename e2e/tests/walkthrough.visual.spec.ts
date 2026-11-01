import path from 'node:path'

import type { Page } from '@playwright/test'

import { env, expect, splitUser, test } from '../fixtures'

// Full visual walkthrough: every main screen in every theme at phone
// (390x844) and desktop (1440x900) size. Skipped unless WALK=1; images go to
// test-results/walk/<m|d>-<theme>-<screen>.png (fetch with rt --back).
//   rt --back e2e/test-results -- bash -lc '… WALK=1 make e2e PORT=8120 SPEC=tests/walkthrough.visual.spec.ts'
// WALK_ONLY=<regexp> limits the screens, WALK_THEMES=dark,paper the themes.
// Read-only: it never changes the lab (wizards stop before 完成).

const ALL_THEMES = ['dark', 'light', 'paper'] as const
const THEMES = process.env.WALK_THEMES ? (process.env.WALK_THEMES.split(',') as (typeof ALL_THEMES)[number][]) : ALL_THEMES
const ONLY = process.env.WALK_ONLY ? new RegExp(process.env.WALK_ONLY) : null

const N = env.node
const VM = 101 // running VM
const CT = 200 // running container

interface Screen {
  name: string
  path: string
  /** Text that shows once the screen has loaded. */
  ready?: string
  /** Desktop or mobile only. */
  only?: 'mobile' | 'desktop'
  /** Screenshot the viewport only (full-screen layouts, long lists). */
  viewport?: boolean
  act?: (page: Page, mobile: boolean) => Promise<void>
}

/** A container console shows nothing until a key is pressed: get the login prompt. */
async function wakeTerminal(page: Page) {
  const term = page.locator('.xterm').first()
  if (!(await term.count())) return
  await term.click()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(800)
}

const SCREENS: Screen[] = [
  { name: 'overview', path: '/', ready: '虚拟机与容器' },
  { name: 'datacenter', path: '/datacenter', ready: '健康状态' },
  { name: 'pools', path: '/pool' },
  { name: 'tasks', path: '/tasks', viewport: true },
  { name: 'cluster-log', path: '/cluster/log', viewport: true },
  { name: 'node-summary', path: `/node/${N}` },
  { name: 'node-services', path: `/node/${N}/services` },
  { name: 'node-syslog', path: `/node/${N}/syslog`, viewport: true },
  { name: 'node-tasks', path: `/node/${N}/tasks`, viewport: true },
  { name: 'node-shell', path: `/node/${N}/shell`, viewport: true },
  { name: 'node-network', path: `/node/${N}/network` },
  { name: 'storage', path: '/storage' },
  { name: 'storage-summary', path: `/storage/${N}/local` },
  { name: 'storage-iso', path: `/storage/${N}/local/iso` },
  { name: 'storage-vztmpl', path: `/storage/${N}/local/vztmpl` },
  { name: 'storage-backup', path: `/storage/${N}/local/backup` },
  { name: 'storage-images', path: `/storage/${N}/local-lvm/images` },
  { name: 'vm-summary', path: `/guest/${N}/qemu/${VM}` },
  { name: 'vm-hardware', path: `/guest/${N}/qemu/${VM}/hardware` },
  { name: 'vm-cloudinit', path: `/guest/${N}/qemu/${VM}/cloudinit` },
  { name: 'vm-options', path: `/guest/${N}/qemu/${VM}/options` },
  { name: 'vm-snapshots', path: `/guest/${N}/qemu/${VM}/snapshots` },
  { name: 'vm-backup', path: `/guest/${N}/qemu/${VM}/backup` },
  { name: 'vm-tasks', path: `/guest/${N}/qemu/${VM}/tasks`, viewport: true },
  { name: 'vm-console', path: `/guest/${N}/qemu/${VM}/console`, viewport: true },
  {
    name: 'vm-actions',
    path: `/guest/${N}/qemu/${VM}`,
    viewport: true,
    act: async (page, mobile) => {
      if (mobile) await page.getByRole('toolbar', { name: '操作' }).getByRole('button', { name: /^更多/ }).click()
      else await page.getByRole('button', { name: '更多操作', exact: true }).locator('visible=true').first().click()
    },
  },
  { name: 'vm-template', path: `/guest/${N}/qemu/9000` },
  { name: 'ct-summary', path: `/guest/${N}/lxc/${CT}` },
  { name: 'ct-resources', path: `/guest/${N}/lxc/${CT}/resources` },
  { name: 'ct-network', path: `/guest/${N}/lxc/${CT}/network` },
  { name: 'ct-dns', path: `/guest/${N}/lxc/${CT}/dns` },
  { name: 'ct-options', path: `/guest/${N}/lxc/${CT}/options` },
  { name: 'ct-snapshots', path: `/guest/${N}/lxc/${CT}/snapshots` },
  { name: 'ct-backup', path: `/guest/${N}/lxc/${CT}/backup` },
  { name: 'ct-console', path: `/guest/${N}/lxc/${CT}/console`, viewport: true, act: wakeTerminal },
  { name: 'console-fullscreen', path: `/console/${N}/lxc/${CT}`, viewport: true, act: wakeTerminal },
  { name: 'shell', path: '/shell' },
  { name: 'account', path: '/account', ready: '两步验证' },
  { name: 'permissions', path: '/account/permissions' },
  { name: 'settings', path: '/settings/appearance', ready: '界面语言' },
  {
    name: 'palette',
    path: '/',
    ready: '虚拟机与容器',
    viewport: true,
    act: async (page, mobile) => {
      if (mobile) await page.getByRole('button', { name: '搜索' }).click()
      else await page.keyboard.press('Control+K')
      await page.getByPlaceholder('搜索资源、页面或操作…').fill('tiny')
    },
  },
  {
    name: 'create-menu',
    path: '/',
    ready: '虚拟机与容器',
    viewport: true,
    act: async (page) => {
      await page.getByRole('button', { name: '新建' }).first().click()
    },
  },
  { name: 'not-found', path: '/no-such-page' },
]

async function settle(page: Page, ready?: string) {
  if (ready) await expect(page.getByText(ready).first()).toBeVisible({ timeout: 20_000 })
  else await expect(page.locator('main, [role="main"], body').first()).toBeVisible()
  // Wait for skeletons to go (bounded), then for charts to settle.
  await page
    .waitForFunction(() => document.querySelectorAll('[data-slot="skeleton"]').length === 0, null, { timeout: 15_000 })
    .catch(() => {})
  // Consoles: wait until connected (or failed) so the shot shows the screen.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="console-status"]')
        return !el || !/连接中/.test(el.textContent ?? '')
      },
      null,
      { timeout: 20_000 },
    )
    .catch(() => {})
  await page.waitForTimeout(900)
}

async function overflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth
    if (document.documentElement.scrollWidth <= w) return []
    return [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > w + 1)
      .slice(0, 6)
      .map((el) => `${el.tagName}.${String((el as HTMLElement).className).slice(0, 60)} → ${Math.round(el.getBoundingClientRect().right)}`)
  })
}

async function next(page: Page, step: string) {
  await page.getByRole('button', { name: /^下一步/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: step, exact: true })).toBeVisible()
}

test.skip(!process.env.WALK, '只在 WALK=1 时截图')
test.use({ actionTimeout: 10_000, navigationTimeout: 30_000 })

for (const theme of THEMES) {
  test(`walkthrough ${theme}`, async ({ page, mobile }, testInfo) => {
    test.setTimeout(1_800_000)
    await page.addInitScript((mode) => {
      localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
      localStorage.setItem('pve-web:install-dismissed', String(Date.now()))
    }, theme)
    const vp = mobile ? 'm' : 'd'
    const file = (name: string) => path.join(testInfo.project.outputDir, 'walk', `${vp}-${theme}-${name}.png`)
    const size = mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }
    await page.setViewportSize(size)
    const shot = async (name: string, fullPage: boolean) => {
      if (!fullPage) {
        await page.screenshot({ path: file(name), animations: 'disabled', caret: 'hide' })
        return
      }
      // Grow the viewport to the page height instead of a stitched full-page
      // shot, so fixed bars (bottom nav, task bar) sit at the bottom as they
      // do on a real screen. Capped so very long pages stay readable.
      const h = await page.evaluate(() => document.documentElement.scrollHeight)
      await page.setViewportSize({ width: size.width, height: Math.min(Math.max(h, size.height), 3200) })
      await page.waitForTimeout(300)
      await page.screenshot({ path: file(name), animations: 'disabled', caret: 'hide' })
      await page.setViewportSize(size)
    }
    const want = (name: string) => !ONLY || ONLY.test(name)
    const problems: string[] = []

    for (const s of SCREENS) {
      if (!want(s.name)) continue
      if (s.only && s.only !== (mobile ? 'mobile' : 'desktop')) continue
      try {
        await page.goto(s.path)
        await settle(page, s.ready)
        const wide = await overflow(page)
        if (wide.length) problems.push(`${s.name} 横向溢出: ${wide.join('; ')}`)
        if (s.act) {
          await s.act(page, mobile)
          await page.waitForTimeout(500)
        }
        await shot(s.name, !s.viewport && !s.act)
        if (s.act) await page.keyboard.press('Escape')
      } catch (e) {
        problems.push(`${s.name}: ${(e as Error).message.split('\n')[0]}`)
        await shot(`${s.name}-ERROR`, false).catch(() => {})
      }
    }

    // Create wizards, every step (stops before creating anything).
    if (want('create-qemu')) {
      try {
        await page.goto('/create/qemu')
        await expect(page.getByRole('textbox', { name: 'VM ID', exact: true })).not.toHaveValue('')
        await expect(page.getByText('可用', { exact: true })).toBeVisible()
        await settle(page)
        await shot('create-qemu-1-general', true)
        const steps = ['操作系统', '系统', '磁盘', 'CPU', '内存', '网络', '确认']
        for (const [i, step] of steps.entries()) {
          if (step === '系统') await page.getByRole('radio', { name: /不使用介质/ }).click()
          await next(page, step)
          await page.waitForTimeout(500)
          const wide = await overflow(page)
          if (wide.length) problems.push(`create-qemu ${step} 横向溢出: ${wide.join('; ')}`)
          await shot(`create-qemu-${i + 2}-${step === 'CPU' ? 'cpu' : step}`, true)
        }
      } catch (e) {
        problems.push(`create-qemu: ${(e as Error).message.split('\n')[0]}`)
        await shot('create-qemu-ERROR', false).catch(() => {})
      }
    }
    if (want('create-lxc')) {
      try {
        await page.goto('/create/lxc')
        await expect(page.getByText('可用', { exact: true })).toBeVisible()
        await settle(page)
        await shot('create-lxc-1-general', true)
        await page.getByLabel('密码', { exact: true }).fill('secret12')
        await page.getByLabel('确认密码', { exact: true }).fill('secret12')
        const steps = ['模板', '磁盘', 'CPU', '内存', '网络', 'DNS', '确认']
        for (const [i, step] of steps.entries()) {
          await next(page, step)
          if (step === '模板') {
            await page.getByRole('combobox', { name: '模板' }).click()
            await page.getByRole('option', { name: /alpine/ }).first().click()
          }
          await page.waitForTimeout(500)
          const wide = await overflow(page)
          if (wide.length) problems.push(`create-lxc ${step} 横向溢出: ${wide.join('; ')}`)
          await shot(`create-lxc-${i + 2}-${step === 'CPU' ? 'cpu' : step === 'DNS' ? 'dns' : step}`, true)
        }
      } catch (e) {
        problems.push(`create-lxc: ${(e as Error).message.split('\n')[0]}`)
        await shot('create-lxc-ERROR', false).catch(() => {})
      }
    }

    // Logged-out login page.
    if (want('login')) {
      await page.context().clearCookies()
      await page.evaluate(() => localStorage.removeItem('pve-web:session'))
      await page.goto('/login')
      await expect(page.getByLabel('用户名')).toBeVisible()
      await page.waitForTimeout(600)
      await shot('login', false)
    }

    // Limited account: tester@pve (PVEAuditor on /, PVEVMUser on /vms/100).
    if (want('tester') && env.testerPassword) {
      try {
        await page.context().clearCookies()
        await page.evaluate(() => localStorage.removeItem('pve-web:session'))
        const { username, realm } = splitUser(env.testerUser)
        await page.goto('/login')
        await page.getByLabel('用户名').fill(username)
        await page.getByLabel('密码', { exact: true }).fill(env.testerPassword)
        const realmBox = page.getByRole('combobox', { name: '认证域' })
        await expect(realmBox).toBeEnabled()
        if (!(await realmBox.textContent())?.includes(`@${realm}`)) {
          await realmBox.click()
          await page.getByRole('option', { name: new RegExp(`@${realm}$`) }).click()
        }
        await page.getByRole('button', { name: '登录', exact: true }).click()
        await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
        for (const [name, p] of [
          ['tester-overview', '/'],
          ['tester-vm100', `/guest/${N}/qemu/100`],
          ['tester-vm100-hardware', `/guest/${N}/qemu/100/hardware`],
          ['tester-vm101', `/guest/${N}/qemu/${VM}`],
          ['tester-vm101-snapshots', `/guest/${N}/qemu/${VM}/snapshots`],
          ['tester-ct-options', `/guest/${N}/lxc/${CT}/options`],
          ['tester-node', `/node/${N}`],
          ['tester-storage', `/storage/${N}/local/iso`],
          ['tester-datacenter', '/datacenter'],
        ] as const) {
          await page.goto(p)
          await settle(page)
          await shot(name, false)
        }
      } catch (e) {
        problems.push(`tester: ${(e as Error).message.split('\n')[0]}`)
      }
    }

    if (problems.length) await testInfo.attach('problems', { body: problems.join('\n'), contentType: 'text/plain' })
    expect.soft(problems).toEqual([])
  })
}
