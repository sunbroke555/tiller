import { test, expect, type BrowserContext, type TestInfo } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, type AddressInfo } from 'node:net'

// Installation passwords must never be captured in Playwright traces.
test.use({ trace: 'off' })

async function laboratory(context: BrowserContext, info: TestInfo, usePassword = false) {
  const labURL = process.env.PVE_LAB_URL!
  const node = process.env.PVE_LAB_NODE!
  const host = new URL(labURL).hostname
  if (host !== '192.168.0.246' || node !== 'pvelab-c1') throw new Error('硬件安装测试仅允许 pvelab-c1 实验节点')
  const ssh = (command: string) => execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `root@${host}`, command], { encoding: 'utf8' })
  const tokenName = `e2e-hardware-${process.pid}-${info.workerIndex}`
  const token = JSON.parse(ssh(`pveum user token add root@pam ${tokenName} --privsep 0 --output-format json`)) as { value: string; 'full-tokenid': string }
  const dir = mkdtempSync(path.join(tmpdir(), 'tiller-hardware-e2e-'))
  const listener = createServer()
  await new Promise<void>((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const port = (listener.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  const base = `http://127.0.0.1:${process.env.HARDWARE_E2E_PORT ? Number(process.env.HARDWARE_E2E_PORT) + info.workerIndex : port}`
  let proc: ChildProcess | undefined
  const cleanup = async () => {
    if (proc?.pid && proc.exitCode === null) { const exit = once(proc, 'exit'); proc.kill('SIGTERM'); await exit }
    ssh(`pveum user token remove root@pam ${tokenName}`)
    rmSync(dir, { recursive: true, force: true })
  }
  try {
    proc = spawn(path.resolve('../server/tiller'), { env: { ...process.env, LISTEN: new URL(base).host, PVE_URL: '', TILLER_AUTH_FILE: path.join(dir, 'auth.json'), TILLER_INSTANCES_FILE: path.join(dir, 'instances.json') }, stdio: 'ignore' })
    await expect.poll(async () => { try { return (await context.request.get(base + '/healthz')).status() } catch { return 0 } }).toBe(200)
    const setup = await context.request.post(base + '/api/auth/setup', { data: { username: 'admin', password: 'e2e-hardware-admin-password' } })
    expect(setup.status()).toBe(200)
    const { session } = await setup.json() as { session: { csrfToken: string } }
    const headers = { CSRFPreventionToken: session.csrfToken }
    const credential = usePassword ? { authMode: 'password', username: 'root', realm: 'pam', password: process.env.PVE_LAB_PASSWORD } : { tokenId: token['full-tokenid'], tokenSecret: token.value }
    const created = await context.request.post(base + '/api2/tiller/instances', { headers, data: { name: '硬件测试', url: labURL, fingerprint: process.env.PVE_LAB_FINGERPRINT, ...credential } })
    expect(created.status()).toBe(201)
    const instance = await created.json() as { id: string; version: string }
    return { base, node, ssh, cleanup, headers, instance,
      app: `${base}/i/${instance.id}/${instance.version}/node/${node}`,
      api: `${base}/api/instances/${instance.id}/${instance.version}/api/hardware/${node}`,
    }
  } catch (error) { await cleanup(); throw error }
}

test('接入只在系统页，自动 SMART、休眠缓存、旧版升级与三种主题', async ({ page, context }, info) => {
  test.setTimeout(120_000)
  const lab = await laboratory(context, info)
  let enabled = false, paused = false, hasService = false, installCalls = 0, smartCalls = 0, connectCalls = 0, uninstallCalls = 0
  let releaseConnect: (() => void) | undefined
  const snapshot = {
    enabled: true, connected: true, managed: true, updatedAt: new Date().toISOString(), powerPending: false,
    cpuWatts: 28.4, frequencyGHz: 2.68,
    temperatures: [{ id: 'cpu', name: 'coretemp · Package id 0', value: 52, limit: 100 }, { id: 'nvme', name: 'nvme · Composite', value: 38 }],
    fans: [{ id: 'fan1', name: '主板 · CPU 风扇', value: 1240 }, { id: 'fan2', name: '主板 · 机箱风扇', value: 0 }], powers: [],
    batteries: [{ name: 'APC Back-UPS 650', source: 'nut', status: 'OL', charge: 96, runtime: 1620, load: 23, voltage: 230 }],
    smartAuto: true,
    disks: [{ device: '/dev/nvme0n1', model: 'Samsung SSD 980 PRO 1TB', temperature: 38, health: 'PASSED', life: 98, state: 'online', updatedAt: new Date().toISOString() }, { device: '/dev/sda', model: 'WDC WD40EFRX', temperature: 32, health: 'PASSED', state: 'sleeping', updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }], disksUpdatedAt: new Date().toISOString(),
  }
  try {
    await page.route(lab.api + '**', async (route) => {
      const action = new URL(route.request().url()).pathname.split('/').at(-1)
      const reply = (data: unknown, status = 200, messages = ['正在检测节点已有的采集服务']) => route.fulfill({
        contentType: 'application/x-ndjson',
        body: [...messages.map((message) => ({ type: 'log', at: new Date().toISOString(), message })), { type: 'result', status, data }].map((event) => JSON.stringify(event)).join('\n') + '\n',
      })
      if (route.request().method() === 'GET') return route.fulfill({ json: enabled ? snapshot : { enabled: false, managed: hasService, paused } })
      if (route.request().method() === 'DELETE') {
        if (!route.request().postData()) return reply({ needsAuthorization: true, operation: 'stop', message: '需要节点授权' }, 409)
        enabled = false; paused = true
        return reply({ enabled: false, managed: true, paused: true, smartAuto: true }, 200, ['Tiller 创建的采集任务已停止，开机自启已关闭'])
      }
      if (action === 'resume') { enabled = true; paused = false; return reply(snapshot, 200, ['采集已恢复，连接验证通过']) }
      if (action === 'uninstall') {
        if (uninstallCalls++ === 0) return reply({ message: '卸载会连带移除其他软件包，存在依赖冲突，已取消卸载；采集服务保持原状态' }, 502)
        enabled = false; paused = false; hasService = false
        return reply({ enabled: false, managed: false, notice: 'Tiller 采集服务已卸载' }, 200, ['服务已卸载'])
      }
      if (action === 'connect') {
        if (connectCalls++ === 0) {
          await new Promise<void>((resolve) => { releaseConnect = resolve })
          return reply({ message: '初始化节点 Shell 失败：10 秒内未收到 Shell 就绪响应。', diagnostic: {
            code: 'TERMINAL_TIMEOUT', stage: '初始化节点 Shell', reason: '10 秒内未收到 Shell 就绪响应，尚未确认具体原因。',
            suggestion: '打开 PVE → 节点 → Shell，检查是否卡在登录提示或启动脚本；确认可以输入命令后再重试。', state: '节点采集操作尚未执行。',
          } }, 502)
        }
        return reply({ needsInstall: true, message: '需要安装' }, 409)
      }
      if (action === 'upgrade') { snapshot.smartAuto = true; return reply(snapshot, 200, ['SMART 定时任务已启动，接入完成']) }
      if (action === 'install') {
        installCalls++
        if (installCalls === 1) return reply({ message: '节点授权失败，请检查 root@pam 密码或验证码' }, 403)
        if (installCalls === 2) return reply({ requiresTFA: true, challenge: 'PVE:!tfa!test:timestamp::signature' })
        enabled = true; hasService = true; return reply(snapshot, 200, ['正在安装 node_exporter 传感器采集工具', '正在启动采集服务与 SMART 定时任务', '采集服务连接成功，接入完成'])
      }
      if (action === 'disks') {
        smartCalls++
        return route.fulfill({ json: snapshot })
      }
      throw new Error('unexpected hardware action')
    })
    await page.goto(lab.app + '/summary')
    await expect(page.getByRole('heading', { name: lab.node, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '一键接入' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '硬件状态' })).toHaveCount(0)
    await page.goto(lab.app + '/system')
    const settings = page.getByRole('region', { name: '硬件监控', exact: true })
    await expect(settings).toContainText('smartmontools')
    await expect(settings).toContainText('节点已有的 NUT 服务')
    await settings.getByRole('button', { name: '一键接入' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: '接入硬件监控' })).toBeVisible()
    await dialog.getByRole('button', { name: '收起', exact: true }).click()
    await expect(dialog).toBeHidden()
    await settings.getByRole('button', { name: '操作日志', exact: true }).click()
    await expect.poll(() => Boolean(releaseConnect)).toBe(true)
    releaseConnect!()
    await expect(dialog.getByRole('alert')).toContainText('失败步骤：初始化节点 Shell')
    await expect(dialog.getByRole('alert')).toContainText('尚未确认具体原因')
    await expect(dialog.getByRole('alert')).toContainText('建议处理')
    await expect(dialog.getByRole('alert')).toContainText('节点采集操作尚未执行')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await dialog.getByRole('button', { name: '复制诊断信息', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('诊断代码：TERMINAL_TIMEOUT')
    await dialog.screenshot({ path: info.outputPath('hardware-shell-error.png'), animations: 'disabled' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await dialog.getByRole('button', { name: '重试接入', exact: true }).click()
    await dialog.getByLabel('PVE root@pam 密码').fill('invalid-test-password')
    await dialog.getByRole('button', { name: '授权并安装' }).click()
    await expect(dialog.getByRole('alert')).toContainText('授权失败')
    await expect(dialog.getByRole('log')).toContainText('接入未完成')
    await expect(dialog.getByRole('log')).not.toContainText('invalid-test-password')
    await dialog.getByLabel('PVE root@pam 密码').fill('valid-test-password')
    await dialog.getByRole('button', { name: '授权并安装' }).click()
    await expect(dialog.getByLabel('动态验证码')).toBeVisible()
    await dialog.getByLabel('动态验证码').fill('123456')
    await dialog.getByRole('button', { name: '验证并安装' }).click()
    await expect(dialog.getByRole('status')).toContainText('接入完成')
    await expect(dialog.getByRole('log')).toContainText('正在启动采集服务')
    for (const theme of ['dark', 'light', 'paper']) {
      await page.evaluate((mode) => {
        const next = JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' })
        localStorage.setItem('tiller:appearance', next)
        dispatchEvent(new StorageEvent('storage', { key: 'tiller:appearance', newValue: next }))
      }, theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await dialog.screenshot({ path: info.outputPath(`hardware-connect-${theme}.png`), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(settings).toContainText('已接入')
    await settings.getByRole('button', { name: '操作日志', exact: true }).click()
    await expect(dialog.getByRole('log')).toContainText('采集服务连接成功')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await page.goto(lab.app + '/summary')
    const hardware = page.getByRole('region', { name: '硬件状态', exact: true })
    await expect(hardware).toContainText('28.4')
    await expect(hardware).toContainText('市电供电')
    await expect(hardware).toContainText('Samsung SSD')
    await expect(hardware).toContainText('休眠中，已跳过')
    await expect(hardware).toContainText('上次健康')
    expect(smartCalls).toBe(0)
    await hardware.getByRole('button', { name: '刷新显示' }).click()
    expect(smartCalls).toBe(1)
    for (const theme of ['dark', 'light', 'paper']) {
      await page.evaluate((mode) => {
        const next = JSON.stringify({ mode, accent: 'indigo', glass: true, density: 'comfortable' })
        localStorage.setItem('tiller:appearance', next)
        dispatchEvent(new StorageEvent('storage', { key: 'tiller:appearance', newValue: next }))
      }, theme)
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await hardware.scrollIntoViewIfNeeded()
      await hardware.screenshot({ path: info.outputPath(`hardware-${theme}.png`), animations: 'disabled' })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    snapshot.disksUpdatedAt = new Date(Date.now() - 3600_000).toISOString()
    await page.reload()
    await expect(hardware).toContainText('SMART 后台采集已超过 30 分钟未更新')
    snapshot.smartAuto = false
    await page.goto(lab.app + '/system')
    await settings.getByRole('button', { name: '启用自动 SMART' }).click()
    await expect(dialog.getByRole('status')).toContainText('接入完成')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await expect(settings).toContainText('SMART 在节点后台每 10 分钟采集')
    await settings.getByRole('button', { name: '停止采集', exact: true }).click()
    await dialog.getByLabel('PVE root@pam 密码').fill('stop-test-password')
    await dialog.getByRole('button', { name: '授权并停止', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('采集已停止')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await expect(settings).toContainText('已停止采集')
    await page.reload()
    await settings.getByRole('button', { name: '恢复采集', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('采集已恢复')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await settings.getByRole('button', { name: '卸载服务', exact: true }).click()
    await expect(dialog).toContainText('依赖冲突')
    await dialog.getByRole('button', { name: '确认卸载', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('存在依赖冲突')
    expect(enabled).toBe(true)
    await dialog.screenshot({ path: info.outputPath('hardware-uninstall-conflict.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '重试卸载', exact: true }).click()
    await expect(dialog.getByRole('status')).toContainText('卸载完成')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await expect(settings.getByRole('button', { name: '一键接入' })).toBeVisible()
    await expect(settings.getByRole('button', { name: '卸载服务' })).toHaveCount(0)
    await page.goto(lab.app + '/summary')
    await expect(hardware).toHaveCount(0)
  } finally { await lab.cleanup() }
})

for (const usePassword of [false, true]) test(`实验节点真实一键安装、认证采集、暂停和重连（${usePassword ? '沿用管理员授权' : 'Token 单次授权'}） @lab`, async ({ page, context }, info) => {
  test.skip(process.env.HARDWARE_LAB_INSTALL !== '1', '设置 HARDWARE_LAB_INSTALL=1 才执行真实安装测试')
  test.setTimeout(360_000)
  const lab = await laboratory(context, info, usePassword)
  let installed = false
  const hadPackage = lab.ssh("dpkg-query -W -f='${Status}' prometheus-node-exporter 2>/dev/null || true").includes('install ok installed')
  try {
    if (lab.ssh('test ! -e /etc/tiller-node-exporter && echo clear').trim() !== 'clear') throw new Error('节点已有采集配置，拒绝覆盖')
    await page.goto(lab.app + '/system')
    const settings = page.getByRole('region', { name: '硬件监控', exact: true })
    installed = true
    const installation = page.waitForResponse((r) => r.url() === lab.api + (usePassword ? '/connect' : '/install'), { timeout: 270_000 })
    await settings.getByRole('button', { name: '一键接入' }).click()
    const dialog = page.getByRole('dialog')
    if (!usePassword) {
      await dialog.getByLabel('PVE root@pam 密码').fill(process.env.PVE_LAB_PASSWORD!)
      await dialog.getByRole('button', { name: '授权并安装' }).click()
    }
    const response = await installation
    expect(response.status(), await response.text()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/x-ndjson')
    await expect(dialog.getByRole('status')).toContainText('接入完成', { timeout: 270_000 })
    await expect(dialog.getByRole('log')).toContainText('正在检查 node_exporter、Python 3 与 smartmontools')
    await expect(dialog.getByRole('log')).toContainText('SMART 定时任务已启动')
    await expect(dialog.getByRole('log')).not.toContainText(process.env.PVE_LAB_PASSWORD!)
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(settings).toContainText('已接入')
    const state = await context.request.get(lab.api)
    expect(await state.json()).toMatchObject({ enabled: true, connected: true, managed: true, smartAuto: true })
    expect(lab.ssh('systemctl is-active tiller-node-exporter.service').trim()).toBe('active')
    expect(lab.ssh('systemctl is-active tiller-smart-collector.timer').trim()).toBe('active')
    await expect.poll(() => lab.ssh('test -s /run/tiller-node-exporter/smart.prom && echo ready || true').trim()).toBe('ready')
    const sampledAt = lab.ssh('stat -c %Y /run/tiller-node-exporter/smart.prom')
    for (let i = 0; i < 3; i++) {
      const refreshed = await context.request.post(lab.api + '/disks', { headers: lab.headers })
      const data = await refreshed.json()
      expect(data.smartAuto).toBe(true)
      expect(Date.parse(data.disksUpdatedAt)).toBeGreaterThan(Date.now() - 60_000)
    }
    expect(lab.ssh('stat -c %Y /run/tiller-node-exporter/smart.prom')).toBe(sampledAt)
    expect(lab.ssh("curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1:19100/metrics")).toBe('401')
    await page.goto(lab.app + '/summary')
    await expect(page.getByRole('region', { name: '硬件状态' })).toBeVisible()
    await page.getByRole('region', { name: '硬件状态' }).screenshot({ path: info.outputPath('real-lab-hardware.png') })
    const paused = await context.request.delete(lab.api, { headers: lab.headers, data: { password: process.env.PVE_LAB_PASSWORD } })
    expect(await paused.json()).toMatchObject({ enabled: false, paused: true })
    expect(lab.ssh('systemctl is-active tiller-node-exporter.service || true').trim()).toBe('inactive')
    expect(lab.ssh('systemctl is-enabled tiller-smart-collector.timer || true').trim()).toBe('disabled')
    expect(lab.ssh('systemctl is-active tiller-smart-collector.service || true').trim()).toBe('inactive')
    const resumed = await context.request.post(lab.api + '/connect', { headers: lab.headers, data: { password: process.env.PVE_LAB_PASSWORD } })
    expect(await resumed.json()).toMatchObject({ enabled: true, connected: true, managed: true })
  } finally {
    if (installed) {
      // Remove only this test's service; preserve any pre-existing exporter.
      lab.ssh(`if [ "$(cat /etc/tiller-node-exporter/owner 2>/dev/null)" = '${lab.instance.id}:${lab.node}' ]; then systemctl disable --now tiller-smart-collector.timer tiller-node-exporter.service; systemctl stop tiller-smart-collector.service; rm -f /etc/systemd/system/tiller-node-exporter.service /etc/systemd/system/tiller-smart-collector.service /etc/systemd/system/tiller-smart-collector.timer; rm -rf /etc/tiller-node-exporter /run/tiller-node-exporter; systemctl daemon-reload; fi`)
      if (!hadPackage) lab.ssh('DEBIAN_FRONTEND=noninteractive apt-get remove --purge -y prometheus-node-exporter >/dev/null')
    }
    await lab.cleanup()
  }
})
