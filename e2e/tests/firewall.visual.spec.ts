import type { Page } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'
import { DC, PREFIX, sweepFirewall } from './firewall-helpers'

// Visual QA of the firewall screens (dark theme, 1440×900 and 390×844).
// Only runs with E2E_SCREENSHOTS=1, one worker (both projects share the
// fixture objects):
//   E2E_WORKERS=1 make e2e-visual PORT=8207 SPEC=tests/firewall.visual.spec.ts
// Output: e2e/test-results/fw-screens/<project>-<screen>.png
// The datacenter firewall stays disabled; everything is removed afterwards.

const VMID = 5601

test.describe.configure({ timeout: 300_000 })

async function fixture(pve: PveApi) {
  await sweepFirewall(pve)
  await pve.destroyGuest(VMID)
  await pve.post(`${DC}/aliases`, { name: `${PREFIX}-office`, cidr: '10.20.0.0/16', comment: '办公网' })
  await pve.post(`${DC}/ipset`, { name: `${PREFIX}-block`, comment: '封禁地址' })
  await pve.post(`${DC}/ipset/${PREFIX}-block`, { cidr: '203.0.113.0/24', comment: '扫描来源' })
  await pve.post(`${DC}/ipset/${PREFIX}-block`, { cidr: '203.0.113.7', nomatch: 1, comment: '合作方' })
  await pve.post(`${DC}/ipset/${PREFIX}-block`, { cidr: `dc/${PREFIX}-office` })
  await pve.post(`${DC}/groups`, { group: `${PREFIX}-web`, comment: 'Web 服务器' })
  await pve.post(`${DC}/groups/${PREFIX}-web`, { type: 'in', action: 'ACCEPT', macro: 'HTTPS', enable: 1 })
  await pve.post(`${DC}/groups/${PREFIX}-web`, { type: 'in', action: 'ACCEPT', macro: 'HTTP', enable: 1 })
  // Created on top, so in reverse order.
  await pve.post(`${DC}/rules`, { type: 'group', action: `${PREFIX}-web`, iface: 'vmbr0', enable: 1, comment: `${PREFIX} web` })
  await pve.post(`${DC}/rules`, { type: 'out', action: 'REJECT', proto: 'tcp', dport: '25', enable: 0, comment: `${PREFIX} 禁止发信` })
  await pve.post(`${DC}/rules`, { type: 'in', action: 'DROP', source: `+dc/${PREFIX}-block`, log: 'info', enable: 1, comment: `${PREFIX} 封禁` })
  await pve.post(`${DC}/rules`, { type: 'in', action: 'ACCEPT', proto: 'icmp', 'icmp-type': 'echo-request', enable: 1, comment: `${PREFIX} ping` })
  await pve.post(`${DC}/rules`, { type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006,22', source: '192.168.0.0/24', enable: 1, comment: `${PREFIX} 管理访问` })

  await pve.createTestVm({ vmid: VMID, name: 'e2e-fw-screens' })
  const base = `/nodes/${pve.node}/qemu/${VMID}/firewall`
  await pve.put(`${base}/options`, { enable: 1, policy_in: 'DROP', log_level_in: 'info' })
  await pve.post(`${base}/rules`, { type: 'out', action: 'DROP', proto: 'tcp', dport: '25', enable: 1, comment: '禁止发信' })
  await pve.post(`${base}/rules`, { type: 'group', action: `${PREFIX}-web`, iface: 'net0', enable: 1 })
  await pve.post(`${base}/rules`, { type: 'in', action: 'ACCEPT', macro: 'SSH', source: `dc/${PREFIX}-office`, iface: 'net0', enable: 1, comment: '办公网 SSH' })
  await pve.post(`${base}/ipset`, { name: 'ipfilter-net0' })
  await pve.post(`${base}/ipset/ipfilter-net0`, { cidr: '10.20.1.15' })
}

test('screens', async ({ page, pve, cleanup, mobile }) => {
  await fixture(pve)
  cleanup.guest(VMID)
  cleanup.add(() => sweepFirewall(pve))
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('pve-web:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  const project = mobile ? 'mobile' : 'desktop'
  const shot = (name: string, full = true) => page.screenshot({ path: `test-results/fw-screens/${project}-${name}.png`, fullPage: full })
  const settle = async (page: Page) => {
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await page.waitForTimeout(400)
  }

  await page.goto('/datacenter/firewall/rules')
  await expect(page.getByText(`${PREFIX} 管理访问`)).toBeVisible()
  await settle(page)
  await shot('dc-rules')

  // Rule editor (edit the ICMP rule) and, on phones, the move sheet.
  if (mobile) {
    await page.getByRole('button', { name: '更多操作：规则 #1' }).click()
    await page.getByRole('menuitem', { name: '移动…' }).click()
    await expect(page.getByRole('dialog', { name: '移动规则' })).toBeVisible()
    await settle(page)
    await shot('dc-move-sheet', false)
    await page.getByRole('button', { name: '完成' }).click()
    await page.getByRole('list', { name: '规则列表' }).getByRole('listitem').nth(1).getByRole('button').first().click()
  } else {
    await page.locator('tr', { hasText: `${PREFIX} ping` }).dblclick()
  }
  await expect(page.getByRole('dialog', { name: '编辑规则 #1' })).toBeVisible()
  await settle(page)
  await shot('dc-rule-dialog', false)
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.goto(`/datacenter/firewall/groups/${PREFIX}-web`)
  await expect(page.getByRole('region', { name: '组内规则' })).toContainText('HTTPS')
  await settle(page)
  await shot('dc-group')

  await page.goto('/datacenter/firewall/aliases')
  await expect(page.getByText(`${PREFIX}-office`)).toBeVisible()
  await settle(page)
  await shot('dc-aliases')

  await page.goto(`/datacenter/firewall/ipset/${PREFIX}-block`)
  await expect(page.getByText('203.0.113.7')).toBeVisible()
  await settle(page)
  await shot('dc-ipset')

  await page.goto('/datacenter/firewall/options')
  await expect(page.getByText('日志限速')).toBeVisible()
  await settle(page)
  await shot('dc-options')
  await page.getByRole('switch', { name: '防火墙' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('8006')
  await settle(page)
  await shot('dc-enable-confirm', false)
  await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()

  const guest = `/guest/${pve.node}/qemu/${VMID}/firewall`
  await page.goto(guest)
  await expect(page.getByText('办公网 SSH')).toBeVisible()
  await settle(page)
  await shot('guest-rules')
  await page.goto(`${guest}?fw=options`)
  await expect(page.getByText('MAC 过滤')).toBeVisible()
  await settle(page)
  await shot('guest-options')
  await page.goto(`${guest}?fw=ipset&item=ipfilter-net0`)
  await expect(page.getByText('10.20.1.15')).toBeVisible()
  await settle(page)
  await shot('guest-ipset')

  await page.goto(`/node/${pve.node}/firewall?fw=options`)
  await expect(page.getByText('连接跟踪', { exact: true })).toBeVisible()
  await settle(page)
  await shot('node-options')
  await page.goto(`/node/${pve.node}/firewall?fw=log`)
  await expect(page.getByRole('log', { name: '防火墙日志' })).toBeVisible()
  await settle(page)
  await shot('node-log')
})
