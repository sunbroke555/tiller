import type { Page, Route } from '@playwright/test'

import { expect, test, type PveApi } from '../fixtures'

// Access control (area access-control): /datacenter/permissions/{acl,roles,
// realms,pools}, the pool page's management and the guest permission tab.
//
// @lab (desktop): everything the tests create is named e2e-ac-* (a role, a
// pool, a group as ACL subject, an LDAP realm without a server, a sync job)
// and removed in cleanup. root@pam, tester@pve, their ACLs, the pam/pve
// realms and lab-pool are never changed. Directory sync and the AD / OpenID
// forms are submitted against page.route() mocks (no directory server).
// Phones: read-only checks with mocked state.
// Run: rt -- scripts/with-lab-env.sh make e2e-area AREA=access-control PORT=8302

const P = 'e2e-ac-'
const ROLE = 'e2e-ac-role'
const POOL = 'e2e-ac-pool'
const GROUP = 'e2e-ac-group'
const REALM = 'e2e-ac-ldap'
const JOB = 'e2e-ac-job'

interface Acl {
  path: string
  type: 'user' | 'group' | 'token'
  ugid: string
  roleid: string
  propagate: number
}

/** Remove everything e2e-ac-* (also leftovers of crashed runs). */
async function sweep(pve: PveApi) {
  const acl = await pve.get<Acl[]>('/access/acl')
  for (const e of acl.filter((x) => x.ugid.startsWith(P) || x.roleid.startsWith(P) || x.path.startsWith(`/pool/${P}`))) {
    const key = e.type === 'group' ? 'groups' : e.type === 'token' ? 'tokens' : 'users'
    await pve.put('/access/acl', { delete: 1, path: e.path, roles: e.roleid, [key]: e.ugid }).catch(() => {})
  }
  const jobs = await pve.get<{ id: string; realm: string }[]>('/cluster/jobs/realm-sync').catch(() => [])
  for (const j of jobs.filter((x) => x.id.startsWith(P) || x.realm.startsWith(P))) await pve.del(`/cluster/jobs/realm-sync/${j.id}`).catch(() => {})
  const realms = await pve.get<{ realm: string }[]>('/access/domains')
  for (const r of realms.filter((x) => x.realm.startsWith(P))) await pve.del(`/access/domains/${r.realm}`).catch(() => {})
  const roles = await pve.get<{ roleid: string }[]>('/access/roles')
  for (const r of roles.filter((x) => x.roleid.startsWith(P))) await pve.del(`/access/roles/${r.roleid}`).catch(() => {})
  const pools = await pve.get<{ poolid: string }[]>('/pools')
  for (const p of pools.filter((x) => x.poolid.startsWith(P)).sort((a, b) => b.poolid.length - a.poolid.length)) {
    const [detail] = await pve.get<{ members?: { type: string; vmid?: number; storage?: string }[] }[]>('/pools', { poolid: p.poolid })
    const members = detail?.members ?? []
    const vms = members.filter((m) => m.vmid !== undefined).map((m) => m.vmid)
    const storage = [...new Set(members.filter((m) => m.type === 'storage').map((m) => m.storage))]
    if (vms.length || storage.length) {
      await pve.put('/pools', { poolid: p.poolid, delete: 1, vms: vms.join(',') || undefined, storage: storage.join(',') || undefined }).catch(() => {})
    }
    await pve.del('/pools', { poolid: p.poolid }).catch(() => {})
  }
  const groups = await pve.get<{ groupid: string }[]>('/access/groups')
  for (const g of groups.filter((x) => x.groupid.startsWith(P))) await pve.del(`/access/groups/${g.groupid}`).catch(() => {})
}

const aclOf = (pve: PveApi) => pve.get<Acl[]>('/access/acl').then((l) => l.filter((e) => e.ugid === GROUP))

async function typeToConfirm(page: Page, text: string) {
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('textbox').fill(text)
  await dialog.getByRole('button', { name: '删除' }).click()
  await expect(dialog).toBeHidden()
}

async function pick(page: Page, combobox: string, option: string | RegExp, scope = page.getByRole('dialog')) {
  await scope.getByRole('combobox', { name: combobox }).click()
  await page.getByRole('option', { name: option }).first().click()
}

test.describe('权限与认证', { tag: '@lab' }, () => {
  test('角色：创建、编辑、删除；内置角色只读', async ({ page, pve, cleanup }) => {
    await sweep(pve)
    cleanup.add(() => sweep(pve))
    await page.goto('/datacenter/permissions/roles')
    await expect(page.getByRole('heading', { name: '角色', exact: true })).toBeVisible()

    // Built-in: read-only.
    await page.getByRole('button', { name: '查看角色 PVEAuditor' }).click()
    const builtin = page.getByRole('dialog', { name: '内置角色 PVEAuditor' })
    await expect(builtin.getByText('Sys.Audit', { exact: true })).toBeVisible()
    await expect(builtin.getByRole('checkbox')).toHaveCount(0)
    await builtin.getByRole('button', { name: '关闭' }).last().click()

    // Create.
    await page.getByRole('button', { name: '创建', exact: true }).click()
    const create = page.getByRole('dialog', { name: '创建角色' })
    await create.getByRole('textbox', { name: '名称' }).fill('PVEnope')
    await expect(create.getByText('以 PVE 开头的名称留给内置角色')).toBeVisible()
    await create.getByRole('textbox', { name: '名称' }).fill(ROLE)
    await create.getByRole('checkbox', { name: '存储：全选' }).click()
    await create.getByRole('textbox', { name: '搜索权限' }).fill('VM.Audit')
    await create.getByRole('checkbox', { name: 'VM.Audit', exact: true }).click()
    await create.getByRole('button', { name: '创建', exact: true }).click()
    await expect(create).toBeHidden()
    const privs = async () => Object.keys(await pve.get<Record<string, number>>(`/access/roles/${ROLE}`)).sort()
    expect(await privs()).toEqual(['Datastore.Allocate', 'Datastore.AllocateSpace', 'Datastore.AllocateTemplate', 'Datastore.Audit', 'VM.Audit'])

    // Edit: drop the storage group, add Sys.Audit.
    await page.getByRole('button', { name: `编辑角色 ${ROLE}` }).click()
    const edit = page.getByRole('dialog', { name: `编辑角色 ${ROLE}` })
    await expect(edit.getByRole('checkbox', { name: 'VM.Audit', exact: true })).toBeChecked()
    await edit.getByRole('checkbox', { name: '存储：全选' }).click()
    await edit.getByRole('textbox', { name: '搜索权限' }).fill('sys.audit')
    await edit.getByRole('checkbox', { name: 'Sys.Audit', exact: true }).click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    await expect.poll(privs).toEqual(['Sys.Audit', 'VM.Audit'])
    await expect(page.locator(`li[data-role="${ROLE}"]`)).toContainText('2 项权限')

    // Delete (type to confirm).
    await page.getByRole('button', { name: `${ROLE} 的操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await typeToConfirm(page, ROLE)
    await expect(page.locator(`li[data-role="${ROLE}"]`)).toHaveCount(0)
    expect((await pve.get<{ roleid: string }[]>('/access/roles')).some((r) => r.roleid === ROLE)).toBe(false)
  })

  test('资源池与 ACL：创建、成员、权限、删除', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    await sweep(pve)
    cleanup.add(() => sweep(pve))
    await pve.post('/access/groups', { groupid: GROUP, comment: 'pve-web e2e (access-control)' })

    // Create the pool in the datacenter list.
    await page.goto('/datacenter/permissions/pools')
    await page.getByRole('button', { name: '创建', exact: true }).click()
    const create = page.getByRole('dialog', { name: '创建资源池' })
    await create.getByRole('textbox', { name: '名称' }).fill(POOL)
    await create.getByRole('textbox', { name: '说明' }).fill('e2e 资源池')
    await create.getByRole('button', { name: '创建', exact: true }).click()
    await expect(create).toBeHidden()
    await expect(page.locator(`li[data-pool="${POOL}"]`)).toContainText('e2e 资源池')

    // Datacenter ACL: group permission on the pool path, not propagating.
    await page.goto('/datacenter/permissions/acl')
    await page.getByRole('button', { name: '添加' }).click()
    await page.getByRole('menuitem', { name: '组权限' }).click()
    const add = page.getByRole('dialog', { name: '添加组权限' })
    await add.getByRole('textbox', { name: '路径' }).fill(`/pool/${POOL}`)
    await expect(add.getByText(`资源池 ${POOL}`)).toBeVisible()
    await pick(page, '组', GROUP, add)
    await pick(page, '角色', /^PVEPoolUser/, add)
    await add.getByRole('switch', { name: '传播' }).click()
    await add.getByRole('button', { name: '添加', exact: true }).click()
    await expect(add).toBeHidden()
    await expect.poll(() => aclOf(pve)).toEqual([{ path: `/pool/${POOL}`, type: 'group', ugid: GROUP, roleid: 'PVEPoolUser', propagate: 0 }])
    const row = page.locator(`li[data-testid="acl-row"][data-ugid="${GROUP}"]`)
    await expect(row).toContainText('不传播')

    // Pool page: members, its own permission list, comment, delete.
    await page.goto(`/pool/${POOL}`)
    await page.getByRole('button', { name: '添加成员' }).click()
    await page.getByRole('menuitem', { name: '存储' }).click()
    const addSt = page.getByRole('dialog', { name: `添加存储到 ${POOL}` })
    await addSt.getByRole('checkbox', { name: 'local', exact: true }).click()
    await addSt.getByRole('button', { name: '添加', exact: true }).click()
    await expect(addSt).toBeHidden()
    const members = async () => ((await pve.get<{ members?: { type: string; storage?: string }[] }[]>('/pools', { poolid: POOL }))[0]?.members ?? []).map((m) => `${m.type}:${m.storage ?? ''}`)
    await expect.poll(members).toContain('storage:local')
    await expect(page.getByRole('heading', { name: '存储', exact: true })).toBeVisible()

    const perms = page.getByRole('region', { name: '资源池权限' })
    await expect(perms.locator(`li[data-ugid="${GROUP}"]`)).toBeVisible()
    await perms.getByRole('button', { name: '添加' }).click()
    await page.getByRole('menuitem', { name: '组权限' }).click()
    const addFixed = page.getByRole('dialog', { name: '添加组权限' })
    await expect(addFixed.getByRole('switch', { name: '传播' })).toHaveCount(0)
    await pick(page, '组', GROUP, addFixed)
    await pick(page, '角色', /^PVEAuditor/, addFixed)
    await addFixed.getByRole('button', { name: '添加', exact: true }).click()
    await expect(addFixed).toBeHidden()
    await expect.poll(async () => (await aclOf(pve)).map((e) => `${e.roleid}:${e.propagate}`).sort()).toEqual(['PVEAuditor:1', 'PVEPoolUser:0'])
    await perms.getByRole('button', { name: `删除 ${GROUP} 在 /pool/${POOL} 的 PVEPoolUser` }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除' }).click()
    await expect.poll(async () => (await aclOf(pve)).map((e) => e.roleid)).toEqual(['PVEAuditor'])

    await page.getByRole('button', { name: '资源池操作' }).click()
    await page.getByRole('menuitem', { name: '编辑说明' }).click()
    const edit = page.getByRole('dialog', { name: `编辑资源池 ${POOL}` })
    await edit.getByRole('textbox', { name: '说明' }).fill('e2e 已修改')
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('e2e 已修改')).toBeVisible()

    // Not empty yet: delete explains why.
    await page.getByRole('button', { name: '资源池操作' }).click()
    await page.getByRole('menuitem', { name: '删除资源池' }).click()
    const blocked = page.getByRole('dialog', { name: `无法删除资源池 ${POOL}` })
    await expect(blocked).toContainText('1 个成员')
    await blocked.getByRole('button', { name: '知道了' }).click()

    await page.getByRole('button', { name: '资源池操作' }).click()
    await page.getByRole('menuitem', { name: '移除成员' }).click()
    const remove = page.getByRole('dialog', { name: `从 ${POOL} 移除成员` })
    await remove.getByRole('checkbox', { name: 'local', exact: true }).click()
    await remove.getByRole('button', { name: '移除 1 个' }).click()
    await expect(remove).toBeHidden()
    await expect.poll(members).toEqual([])

    await page.getByRole('button', { name: '资源池操作' }).click()
    await page.getByRole('menuitem', { name: '删除资源池' }).click()
    await typeToConfirm(page, POOL)
    await expect(page).toHaveURL(/\/datacenter\/permissions\/pools$/)
    expect((await pve.get<{ poolid: string }[]>('/pools')).some((p) => p.poolid === POOL)).toBe(false)
  })

  test('认证域：LDAP 增改删、同步预览（模拟）、同步任务；PVE 域只读打开', async ({ page, pve, cleanup }) => {
    test.setTimeout(150_000)
    await sweep(pve)
    cleanup.add(() => sweep(pve))
    await page.goto('/datacenter/permissions/realms')
    await expect(page.locator('li[data-realm="pam"]')).toBeVisible()

    // pve realm: open, look, cancel (never saved).
    await page.getByRole('button', { name: '编辑认证域 pve' }).click()
    const pveDialog = page.getByRole('dialog', { name: '编辑认证域 pve' })
    await expect(pveDialog.getByRole('combobox', { name: '要求两步验证' })).toBeVisible()
    await expect(pveDialog.getByRole('button', { name: '保存' })).toBeDisabled()
    await pveDialog.getByRole('button', { name: '取消' }).click()

    // Create an LDAP realm (no server in the lab: connection check off).
    await page.getByRole('button', { name: '添加' }).first().click()
    await page.getByRole('menuitem', { name: 'LDAP 服务器' }).click()
    const create = page.getByRole('dialog', { name: '添加 LDAP 认证域' })
    await create.getByRole('textbox', { name: '名称' }).fill(REALM)
    await create.getByRole('textbox', { name: 'Base DN' }).fill('dc=e2e,dc=example')
    await create.getByRole('textbox', { name: '用户属性' }).fill('uid')
    await create.getByRole('textbox', { name: '服务器', exact: true }).fill('127.0.0.1')
    await create.getByRole('button', { name: /高级选项/ }).click()
    await create.getByRole('switch', { name: '检查连接' }).click()
    await create.getByRole('tab', { name: '同步选项' }).click()
    await create.getByRole('textbox', { name: '绑定用户' }).fill('cn=reader,dc=e2e,dc=example')
    await create.getByRole('textbox', { name: '邮箱属性' }).fill('mail')
    await pick(page, '默认同步范围', '用户和组', create)
    await create.getByRole('checkbox', { name: 'ACL' }).click()
    await create.getByRole('button', { name: '添加', exact: true }).click()
    await expect(create).toBeHidden()
    const cfg = () => pve.get<Record<string, string>>(`/access/domains/${REALM}`)
    await expect.poll(async () => (await cfg()).base_dn).toBe('dc=e2e,dc=example')
    const c1 = await cfg()
    expect(c1).toMatchObject({ type: 'ldap', user_attr: 'uid', server1: '127.0.0.1', bind_dn: 'cn=reader,dc=e2e,dc=example', sync_attributes: 'email=mail' })
    expect(c1['sync-defaults-options']).toMatch(/scope=both/)
    expect(c1['sync-defaults-options']).toMatch(/remove-vanished=acl/)

    // Edit the comment (digest-aware PUT; again without the connection check).
    await page.getByRole('button', { name: `编辑认证域 ${REALM}` }).click()
    const edit = page.getByRole('dialog', { name: `编辑认证域 ${REALM}` })
    await expect(edit.getByRole('textbox', { name: '服务器', exact: true })).toHaveValue('127.0.0.1')
    await edit.getByRole('textbox', { name: '备注' }).fill('e2e 目录')
    await edit.getByRole('button', { name: /高级选项/ }).click()
    await edit.getByRole('switch', { name: '检查连接' }).click()
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(edit).toBeHidden()
    await expect.poll(async () => (await cfg()).comment).toBe('e2e 目录')

    // Sync preview against a mocked sync endpoint and task.
    const upid = `UPID:${pve.node}:0000E2E0:0000E2E1:6A000000:auth-realm-sync-test:${REALM}:root@pam:`
    const synced: URLSearchParams[] = []
    await page.route(`**/api2/json/access/domains/${REALM}/sync`, async (route: Route) => {
      synced.push(new URLSearchParams(route.request().postData() ?? ''))
      await route.fulfill({ json: { data: upid } })
    })
    await page.route((url) => url.pathname.includes('/tasks/UPID') && url.pathname.includes('0000E2E0'), (route) =>
      route.request().url().includes('/status')
        ? route.fulfill({ json: { data: { upid, node: pve.node, status: 'stopped', exitstatus: 'OK', type: 'auth-realm-sync-test', id: REALM, user: 'root@pam', starttime: 1, pid: 1 } } })
        : route.fulfill({ json: { data: [{ n: 1, t: 'NOTE: preview' }, { n: 2, t: 'TASK OK' }], total: 2 } }),
    )
    await page.getByRole('button', { name: `同步 ${REALM}` }).click()
    const sync = page.getByRole('dialog', { name: `同步认证域 ${REALM}` })
    await expect(sync.getByRole('combobox', { name: '同步范围' })).toContainText('用户和组')
    await expect(sync.getByRole('checkbox', { name: 'ACL' })).toBeChecked()
    await sync.getByRole('button', { name: '预览' }).click()
    await expect.poll(() => synced.length).toBe(1)
    expect(Object.fromEntries(synced[0]!)).toEqual({ scope: 'both', 'enable-new': '1', 'remove-vanished': 'acl', 'dry-run': '1' })
    await expect(page.getByText('NOTE: preview')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sync).toBeVisible()
    await sync.getByRole('button', { name: '取消' }).click()

    // Scheduled sync job: create (defaults come from the realm), delete.
    await page.getByRole('button', { name: '添加' }).nth(1).click()
    const job = page.getByRole('dialog', { name: '添加同步任务' })
    await pick(page, '认证域', REALM, job)
    await expect(job.getByRole('combobox', { name: '同步范围' })).toContainText('用户和组')
    await job.getByRole('textbox', { name: '任务 ID' }).fill(JOB)
    await job.getByRole('textbox', { name: '计划' }).fill('sun 03:00')
    await job.getByRole('button', { name: '添加', exact: true }).click()
    await expect(job).toBeHidden()
    await expect
      .poll(() => pve.get<Record<string, unknown>>(`/cluster/jobs/realm-sync/${JOB}`).catch(() => null))
      .toMatchObject({ realm: REALM, schedule: 'sun 03:00', scope: 'both', 'remove-vanished': 'acl' })
    await page.getByRole('button', { name: `${JOB} 的操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await typeToConfirm(page, JOB)
    await expect(page.locator(`li[data-job="${JOB}"]`)).toHaveCount(0)

    // Delete the realm.
    await page.getByRole('button', { name: `${REALM} 的操作` }).click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await typeToConfirm(page, REALM)
    await expect(page.locator(`li[data-realm="${REALM}"]`)).toHaveCount(0)
    expect((await pve.get<{ realm: string }[]>('/access/domains')).some((r) => r.realm === REALM)).toBe(false)
  })
})

test('AD 与 OpenID 认证域表单（模拟提交）', { tag: '@desktop' }, async ({ page }) => {
  const posted: URLSearchParams[] = []
  await page.route('**/api2/json/access/domains', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    posted.push(new URLSearchParams(route.request().postData() ?? ''))
    await route.fulfill({ json: { data: null } })
  })
  await page.goto('/datacenter/permissions/realms')

  await page.getByRole('button', { name: '添加' }).first().click()
  await page.getByRole('menuitem', { name: 'Active Directory 服务器' }).click()
  const ad = page.getByRole('dialog', { name: '添加 Active Directory 认证域' })
  await ad.getByRole('textbox', { name: '名称' }).fill('e2e-ac-ad')
  await ad.getByRole('textbox', { name: '域名' }).fill('corp.example')
  await ad.getByRole('textbox', { name: '服务器', exact: true }).fill('dc1.corp.example')
  await expect(ad.getByRole('switch', { name: '验证证书' })).toBeDisabled()
  await pick(page, '模式', 'LDAPS', ad)
  await ad.getByRole('switch', { name: '验证证书' }).click()
  await pick(page, '要求两步验证', 'OATH / TOTP', ad)
  await ad.getByRole('button', { name: '添加', exact: true }).click()
  await expect(ad).toBeHidden()
  expect(Object.fromEntries(posted[0]!)).toEqual({
    realm: 'e2e-ac-ad',
    type: 'ad',
    domain: 'corp.example',
    server1: 'dc1.corp.example',
    mode: 'ldaps',
    verify: '1',
    tfa: 'type=oath',
    'check-connection': '1',
  })

  await page.getByRole('button', { name: '添加' }).first().click()
  await page.getByRole('menuitem', { name: 'OpenID Connect 服务器' }).click()
  const oid = page.getByRole('dialog', { name: '添加 OpenID Connect 认证域' })
  await oid.getByRole('textbox', { name: '名称' }).fill('e2e-ac-sso')
  await oid.getByRole('textbox', { name: 'Issuer URL' }).fill('https://id.example.com/realms/pve')
  await oid.getByRole('textbox', { name: 'Client ID' }).fill('pve')
  await oid.getByRole('textbox', { name: '用户名声明' }).fill('email')
  await oid.getByRole('switch', { name: '自动创建用户' }).click()
  await expect(oid.getByRole('combobox', { name: '要求两步验证' })).toHaveCount(0)
  await oid.getByRole('button', { name: '添加', exact: true }).click()
  await expect(oid).toBeHidden()
  expect(Object.fromEntries(posted[1]!)).toEqual({
    realm: 'e2e-ac-sso',
    type: 'openid',
    'issuer-url': 'https://id.example.com/realms/pve',
    'client-id': 'pve',
    'username-claim': 'email',
    autocreate: '1',
  })
})

// ------------------------------------------------------------------ phones

const MOCK_ACL = [
  { path: '/', type: 'user', ugid: 'alice@pve', roleid: 'PVEAuditor', propagate: 1 },
  { path: '/pool/dev', type: 'group', ugid: 'developers', roleid: 'PVEVMAdmin', propagate: 1 },
  { path: '/vms/100', type: 'token', ugid: 'ci@pve!deploy', roleid: 'PVEVMUser', propagate: 0 },
]
const MOCK_REALMS = [
  { realm: 'pam', type: 'pam', comment: 'Linux PAM standard authentication' },
  { realm: 'pve', type: 'pve', comment: 'Proxmox VE authentication server', default: 1 },
  { realm: 'corp', type: 'ad', comment: '公司域', tfa: 'type=oath' },
]

test('手机：权限与认证页（模拟数据）', { tag: '@mobile' }, async ({ page }) => {
  await page.route('**/api2/json/access/acl', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: MOCK_ACL } }) : route.fallback()))
  await page.route('**/api2/json/access/domains', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: { data: MOCK_REALMS } }) : route.fallback()))
  await page.route('**/api2/json/access/domains/corp', (route) =>
    route.fulfill({ json: { data: { type: 'ad', domain: 'corp.example', server1: 'dc1', 'sync-defaults-options': 'scope=users', digest: 'x' } } }),
  )

  await page.goto('/datacenter/permissions')
  await expect(page).toHaveURL(/\/datacenter\/permissions\/acl$/)
  await expect(page.locator('li[data-testid="acl-row"]')).toHaveCount(3)
  await expect(page.locator('li[data-ugid="ci@pve!deploy"]')).toContainText('不传播')
  await page.getByRole('button', { name: '添加' }).click()
  await page.getByRole('menuitem', { name: '用户权限' }).click()
  const add = page.getByRole('dialog', { name: '添加用户权限' })
  await expect(add.getByRole('textbox', { name: '路径' })).toHaveValue('/')
  await add.getByRole('button', { name: '取消' }).click()
  await expect(add).toBeHidden()

  const nav = page.getByRole('navigation', { name: '权限与认证' })
  await nav.getByRole('link', { name: '角色' }).click()
  await page.getByRole('button', { name: '查看角色 PVEVMUser' }).click()
  await expect(page.getByRole('dialog', { name: '内置角色 PVEVMUser' }).getByText('VM.PowerMgmt', { exact: true })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭' }).last().click()

  await nav.getByRole('link', { name: '认证域' }).click()
  await expect(page.locator('li[data-realm="corp"]')).toContainText('OATH/TOTP')
  await page.getByRole('button', { name: '同步 corp' }).click()
  const sync = page.getByRole('dialog', { name: '同步认证域 corp' })
  await expect(sync.getByRole('combobox', { name: '同步范围' })).toContainText('用户')
  await sync.getByRole('button', { name: '取消' }).click()

  await nav.getByRole('link', { name: '资源池' }).click()
  await expect(page.locator('li[data-pool="lab-pool"]')).toBeVisible()
})

test('手机：客户机权限标签', { tag: '@mobile' }, async ({ page, pve }) => {
  await page.goto(`/guest/${pve.node}/qemu/100/permissions`)
  await expect(page.locator('li[data-testid="acl-row"][data-ugid="tester@pve"]')).toContainText('PVEVMUser')
})
