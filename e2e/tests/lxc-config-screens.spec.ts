import { expect, test, type PveApi } from '../fixtures'

// Visual QA of the container config tabs: screenshots in every theme at
// phone and desktop size. Skipped unless LXC_SCREENS=1:
//   LXC_SCREENS=1 make e2e PORT=8106 SPEC=tests/lxc-config-screens.spec.ts
// Output: e2e/test-results/lxc-screens/<theme>-<project>-<screen>.png

const THEMES = ['dark', 'light', 'paper'] as const
const VMID = 3590

test.skip(!process.env.LXC_SCREENS, 'LXC_SCREENS=1 打开截图')
test.describe.configure({ timeout: 600_000 })

async function fixture(pve: PveApi): Promise<number> {
  await pve.destroyGuest(VMID)
  const list = await pve.get<{ volid: string }[]>(`/nodes/${pve.node}/storage/local/content`, { content: 'vztmpl' })
  const ostemplate = list.map((x) => x.volid).find((v) => /alpine.*amd64/.test(v))!
  await pve.run('POST', `/nodes/${pve.node}/lxc`, {
    vmid: VMID,
    hostname: 'e2e-lxc-screens',
    ostemplate,
    memory: 96,
    swap: 64,
    cores: 1,
    cpulimit: '0.5',
    rootfs: 'local-lvm:0.5,mountoptions=noatime',
    mp0: 'local-lvm:0.1,mp=/srv/data,backup=1',
    mp1: 'local-lvm:0.1,mp=/var/cache/app',
    unprivileged: 1,
    net0: 'name=eth0,bridge=vmbr0,ip=dhcp,ip6=auto,firewall=1',
    net1: 'name=eth1,bridge=vmbr0,ip=10.99.0.5/24,gw=10.99.0.1,tag=20,rate=12.5,mtu=1400',
    nameserver: '1.1.1.1 2606:4700:4700::1111',
    searchdomain: 'lab.example',
    onboot: 1,
    startup: 'order=2,up=10',
    features: 'nesting=1,keyctl=1',
    env: 'APP_MODE=production\0TZ=Asia/Shanghai',
    dev0: '/dev/null,gid=104,mode=0666',
  })
  // Detach mp1 → unused0, then start and leave one change pending.
  await pve.put(`/nodes/${pve.node}/lxc/${VMID}/config`, { delete: 'mp1' })
  await pve.run('POST', `/nodes/${pve.node}/lxc/${VMID}/status/start`)
  await pve.put(`/nodes/${pve.node}/lxc/${VMID}/config`, { features: 'nesting=1,keyctl=1,fuse=1' })
  await pve.waitForGuest(VMID, (g) => g.status === 'running' && g.name === 'e2e-lxc-screens')
  return VMID
}

test('screens', async ({ page, pve, cleanup }, info) => {
  const vmid = await fixture(pve)
  cleanup.guest(vmid)
  const base = `/guest/${pve.node}/lxc/${vmid}`
  const shot = (theme: string, name: string) =>
    page.screenshot({ path: `test-results/lxc-screens/${theme}-${info.project.name}-${name}.png`, fullPage: true })

  for (const theme of THEMES) {
    await page.addInitScript((mode) => {
      localStorage.setItem('pve-web:appearance', JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' }))
    }, theme)
    for (const tab of ['resources', 'network', 'dns', 'options']) {
      await page.goto(`${base}/${tab}`)
      await expect(page.getByRole('tabpanel')).toBeVisible()
      await page.waitForTimeout(1500)
      await shot(theme, tab)
    }
    // Dialogs.
    await page.goto(`${base}/resources`)
    await page.getByRole('button', { name: /^挂载点 mp0/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: '高级选项' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `test-results/lxc-screens/${theme}-${info.project.name}-dlg-mount.png` })
    await page.keyboard.press('Escape')
    await page.goto(`${base}/network`)
    await page.getByRole('button', { name: '编辑网卡 eth1' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: `test-results/lxc-screens/${theme}-${info.project.name}-dlg-net.png` })
    await page.keyboard.press('Escape')
    await page.goto(`${base}/resources`)
    await page.getByRole('button', { name: '更多操作：挂载点 mp0', exact: true }).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: `test-results/lxc-screens/${theme}-${info.project.name}-menu.png` })
    await page.keyboard.press('Escape')
  }
})
