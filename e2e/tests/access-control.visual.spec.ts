import type { Page } from '@playwright/test'

import { expect, test } from '../fixtures'

// Visual QA screenshots of the access-control screens (dark theme), phone
// (390×844) and desktop (1440×900). Off by default; run with
//   rt --back e2e/test-results -- scripts/with-lab-env.sh make e2e-visual PORT=8302 SPEC=tests/access-control.visual.spec.ts
// Lists are mocked (page.route); nothing is submitted.

const ACL = [
  { path: '/', type: 'user', ugid: 'alice@pve', roleid: 'PVEAuditor', propagate: 1 },
  { path: '/', type: 'group', ugid: 'admins', roleid: 'Administrator', propagate: 1 },
  { path: '/pool/dev', type: 'group', ugid: 'developers', roleid: 'PVEVMAdmin', propagate: 1 },
  { path: '/storage/nas-backup', type: 'user', ugid: 'backup@pve', roleid: 'PVEDatastoreUser', propagate: 1 },
  { path: '/vms/100', type: 'user', ugid: 'tester@pve', roleid: 'PVEVMUser', propagate: 1 },
  { path: '/vms/100', type: 'token', ugid: 'ci@pve!deploy', roleid: 'Ops', propagate: 0 },
  { path: '/access/groups', type: 'user', ugid: 'helpdesk@corp', roleid: 'PVEUserAdmin', propagate: 1 },
]
const OPS_PRIVS = ['VM.Audit', 'VM.Console', 'VM.PowerMgmt', 'VM.Snapshot', 'VM.Backup', 'Datastore.Audit', 'Sys.Audit']
const REALMS = [
  { realm: 'pam', type: 'pam', comment: 'Linux PAM standard authentication' },
  { realm: 'pve', type: 'pve', comment: 'Proxmox VE authentication server', default: 1 },
  { realm: 'corp', type: 'ad', comment: '公司 Active Directory', tfa: 'type=oath' },
  { realm: 'ldap1', type: 'ldap', comment: 'OpenLDAP' },
  { realm: 'sso', type: 'openid', comment: 'Keycloak 单点登录' },
]
const LDAP1 = {
  type: 'ldap',
  base_dn: 'ou=people,dc=example,dc=com',
  user_attr: 'uid',
  server1: 'ldap1.example.com',
  server2: 'ldap2.example.com',
  mode: 'ldaps',
  verify: 1,
  bind_dn: 'cn=pve-reader,dc=example,dc=com',
  sync_attributes: 'email=mail',
  group_name_attr: 'cn',
  filter: '(memberOf=cn=pve,ou=groups,dc=example,dc=com)',
  'sync-defaults-options': 'scope=both,enable-new=1,remove-vanished=acl;entry',
  comment: 'OpenLDAP',
  digest: 'x',
}
const JOBS = [
  { id: 'realmsync-1a2b3c4d-5e6f7', realm: 'ldap1', schedule: 'daily', enabled: 1, scope: 'both', 'remove-vanished': 'acl;entry', 'next-run': 1793577600, comment: '每天同步' },
  { id: 'corp-weekly', realm: 'corp', schedule: 'sun 03:00', enabled: 0, scope: 'users' },
]
const POOLS = [
  { poolid: 'dev', comment: '开发环境' },
  { poolid: 'dev/web', comment: '前端' },
  { poolid: 'dev/web/staging' },
  { poolid: 'lab-pool', comment: 'pve-web lab pool' },
  { poolid: 'prod', comment: '生产' },
]

async function shot(page: Page, name: string, mobile: boolean) {
  await page.waitForTimeout(450) // animations, sheets
  await page.screenshot({ path: `test-results/ac-shots/${mobile ? 'phone' : 'desktop'}-${name}.png` })
}

test('access control screens (dark)', async ({ page, mobile, pve }) => {
  test.setTimeout(240_000)
  if (mobile) await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    localStorage.setItem('tiller:appearance', JSON.stringify({ mode: 'dark', accent: 'indigo', glass: true, density: 'comfortable' }))
  })
  const get = (pattern: string, data: unknown) =>
    page.route(pattern, (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data } }) : route.fulfill({ json: { data: null } })))
  await get('**/api2/json/access/acl', ACL)
  await page.route('**/api2/json/access/roles', async (route) => {
    const res = await route.fetch()
    const body = (await res.json()) as { data: unknown[] }
    await route.fulfill({ json: { data: [...body.data, { roleid: 'Ops', privs: OPS_PRIVS.join(','), special: 0 }] } })
  })
  await get('**/api2/json/access/roles/Ops', Object.fromEntries(OPS_PRIVS.map((p) => [p, 1])))
  await get('**/api2/json/access/domains', REALMS)
  await get('**/api2/json/access/domains/ldap1', LDAP1)
  await get('**/api2/json/cluster/jobs/realm-sync', JOBS)
  await get('**/api2/json/pools', POOLS)

  await page.goto('/datacenter/permissions/acl')
  await expect(page.locator('li[data-testid="acl-row"]')).toHaveCount(ACL.length)
  await shot(page, '01-acl', mobile)

  await page.getByRole('button', { name: '添加' }).click()
  await page.getByRole('menuitem', { name: '组权限' }).click()
  const add = page.getByRole('dialog', { name: '添加组权限' })
  await add.getByRole('textbox', { name: '路径' }).fill('/pool/dev')
  await shot(page, '02-acl-add', mobile)
  await add.getByRole('button', { name: '选择路径' }).click()
  await shot(page, '03-acl-path-picker', mobile)
  await page.keyboard.press('Escape')
  await add.getByRole('button', { name: '取消' }).click()
  const discard = page.getByRole('alertdialog')
  if (await discard.isVisible().catch(() => false)) await discard.getByRole('button', { name: /放弃/ }).click()

  await page.goto('/datacenter/permissions/roles')
  await expect(page.locator('li[data-role="Ops"]')).toBeVisible()
  await shot(page, '04-roles', mobile)
  await page.getByRole('button', { name: '编辑角色 Ops' }).click()
  await expect(page.getByRole('dialog', { name: '编辑角色 Ops' }).getByRole('checkbox', { name: 'VM.Audit', exact: true })).toBeChecked()
  await shot(page, '05-role-edit', mobile)
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.goto('/datacenter/permissions/realms')
  await expect(page.locator('li[data-realm="sso"]')).toBeVisible()
  await shot(page, '06-realms', mobile)
  await page.getByRole('button', { name: '编辑认证域 ldap1' }).click()
  const ldap = page.getByRole('dialog', { name: '编辑认证域 ldap1' })
  await expect(ldap.getByRole('textbox', { name: '服务器', exact: true })).toHaveValue('ldap1.example.com')
  await shot(page, '07-ldap-general', mobile)
  await ldap.getByRole('tab', { name: '同步选项' }).click()
  await shot(page, '08-ldap-sync-options', mobile)
  await ldap.getByRole('button', { name: '取消' }).click()
  await page.getByRole('button', { name: '同步 ldap1' }).click()
  await expect(page.getByRole('dialog', { name: '同步认证域 ldap1' }).getByRole('checkbox', { name: '条目' })).toBeChecked()
  await shot(page, '09-sync', mobile)
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()
  await page.getByRole('button', { name: '添加' }).first().click()
  await page.getByRole('menuitem', { name: 'OpenID Connect 服务器' }).click()
  await shot(page, '10-openid-add', mobile)
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.goto('/datacenter/permissions/pools')
  await expect(page.locator('li[data-pool="dev/web/staging"]')).toBeVisible()
  await shot(page, '11-pools', mobile)

  await page.goto('/pool/lab-pool')
  await expect(page.getByRole('region', { name: '资源池权限' })).toBeVisible()
  await shot(page, '12-pool-page', mobile)
  await page.getByRole('button', { name: '添加成员' }).click()
  await page.getByRole('menuitem', { name: '客户机' }).click()
  await shot(page, '13-pool-add-guests', mobile)
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  await page.goto(`/guest/${pve.node}/qemu/100/permissions`)
  await expect(page.locator('li[data-testid="acl-row"]').first()).toBeVisible()
  await shot(page, '14-guest-permissions', mobile)
})
