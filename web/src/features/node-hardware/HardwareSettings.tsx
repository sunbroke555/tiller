import { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, CircleCheck, CircleAlert, Copy, FileText, LoaderCircle, Pause, PlugZap, Trash2 } from 'lucide-react'

import { HardwareRequestError, useHardwareAction, useNodeHardware, type HardwareDiagnostic, type HardwareProgress, type HardwareResult, type HardwareAction } from '@/api/node-hardware'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Section, SectionState } from '@/features/node-system/ui'
import { errorMessage } from '@/lib/errors'
import { copyText } from '@/features/node-summary/clipboard'

const logTime = (at: string) => new Date(at).toLocaleTimeString('zh-CN', { hour12: false })

function ConnectionDetails() {
  return (
    <dl className="space-y-2.5 text-xs leading-relaxed">
      <div><dt className="font-medium text-foreground">节点传感器 · node_exporter</dt><dd className="mt-0.5 text-muted-foreground">检测已有服务；需要时安装并配置加密采集服务，读取硬件支持的温度、CPU 功耗与风扇转速。</dd></div>
      <div><dt className="font-medium text-foreground">磁盘健康 · SMART</dt><dd className="mt-0.5 text-muted-foreground">按需安装 Python 3、smartmontools，并配置每 10 分钟运行的采集任务。跳过休眠盘，页面读取缓存。</dd></div>
      <div><dt className="font-medium text-foreground">电池与 UPS</dt><dd className="mt-0.5 text-muted-foreground">读取系统电池及节点已有的 NUT 服务；UPS 需已连接并配置。</dd></div>
    </dl>
  )
}

export function HardwareSettings({ node }: { node: string }) {
  const query = useNodeHardware(node)
  const [logs, setLogs] = useState<HardwareProgress[]>([])
  const appendLog = useCallback((entry: HardwareProgress) => setLogs((items) => [...items.slice(-199), entry]), [])
  const connect = useHardwareAction(node, 'connect', appendLog)
  const upgrade = useHardwareAction(node, 'upgrade', appendLog)
  const disconnect = useHardwareAction(node, 'disconnect', appendLog)
  const resume = useHardwareAction(node, 'resume', appendLog)
  const uninstall = useHardwareAction(node, 'uninstall', appendLog)
  const install = useHardwareAction(node, 'install', appendLog)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<'running' | 'authorize' | 'success' | 'error' | 'confirm'>('running')
  const [failure, setFailure] = useState('')
  const [diagnostic, setDiagnostic] = useState<HardwareDiagnostic>()
  type Operation = Exclude<HardwareAction, 'disks'>
  const [operation, setOperation] = useState<Operation>('connect')
  const [authorization, setAuthorization] = useState<Operation>('install')
  const [password, setPassword] = useState('')
  const [challenge, setChallenge] = useState('')
  const [code, setCode] = useState('')
  const logBox = useRef<HTMLDivElement>(null)
  const actions = { connect, upgrade, install, disconnect, resume, uninstall }
  const installing = Object.values(actions).some((action) => action.isPending)
  const busy = installing
  const verb = operation === 'disconnect' ? '停止' : operation === 'resume' ? '恢复' : operation === 'uninstall' ? '卸载' : operation === 'upgrade' ? '更新' : '接入'
  const authVerb = authorization === 'disconnect' ? '停止' : authorization === 'resume' ? '恢复' : authorization === 'uninstall' ? '卸载' : authorization === 'upgrade' ? '更新' : '安装'
  const data = query.data
  const needsCollectorUpdate = data?.enabled && data.connected && data.managed && data.smartAuto && ((data.smartCollectorVersion ?? 1) < 2 || (data.powerCollectorVersion ?? 0) > 0)
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
  }, [logs, open])
  const changeOpen = (value: boolean) => {
    setOpen(value)
    if (!value) { setPassword(''); setCode('') }
  }
  const failed = (error: unknown, authorization = false, action = operation) => {
    const message = errorMessage(error)
    setFailure(message)
    const detail = error instanceof HardwareRequestError ? error.diagnostic : undefined
    setDiagnostic(detail)
    const failedVerb = action === 'disconnect' ? '停止' : action === 'resume' ? '恢复' : action === 'uninstall' ? '卸载' : action === 'upgrade' ? '更新' : '接入'
    appendLog({ at: new Date().toISOString(), message: `${failedVerb}未完成：${message}` })
    const needsCredential = authorization && (!(error instanceof HardwareRequestError) || error.status === 401 || error.status === 403)
    setPhase(needsCredential ? 'authorize' : 'error')
  }
  const handleResult = (result: HardwareResult) => {
    if ('needsInstall' in result) { setAuthorization('install'); setPhase('authorize') }
    else if ('needsAuthorization' in result) { setAuthorization(result.operation === 'stop' ? 'disconnect' : result.operation); setPhase('authorize') }
    else if ('requiresTFA' in result) { setChallenge(result.challenge); setPhase('authorize') }
    else { setPhase('success'); setChallenge('') }
  }
  const run = async (action: Operation) => {
    Object.values(actions).forEach((mutation) => mutation.reset())
    setOperation(action); setAuthorization(action)
    setLogs([]); setFailure(''); setDiagnostic(undefined); setPassword(''); setChallenge(''); setCode('')
    setPhase('running'); setOpen(true)
    try { handleResult(await actions[action].mutateAsync()) }
    catch (error) { failed(error, false, action) }
  }
  const onConnect = (update = false) => run(update ? 'upgrade' : data?.paused ? 'resume' : 'connect')
  const onInstall = async () => {
    const input = challenge ? { challenge, code } : { password }
    setPassword(''); setCode(''); setFailure(''); setDiagnostic(undefined); setPhase('running')
    try { handleResult(await actions[authorization].mutateAsync(input)) }
    catch (error) { failed(error, true) }
    finally { actions[authorization].reset() }
  }
  const askUninstall = () => {
    setOperation('uninstall'); setLogs([]); setFailure(''); setDiagnostic(undefined); setPassword(''); setChallenge(''); setCode('')
    setPhase('confirm'); setOpen(true)
  }
  const status = phase === 'confirm' ? '确认卸载范围' : phase === 'success' ? operation === 'disconnect' ? '采集已停止' : operation === 'resume' ? '采集已恢复' : `${verb}完成` : phase === 'error' ? `${verb}未完成` : phase === 'authorize' ? challenge ? '等待动态验证码' : '等待节点授权' : `正在${verb}`
  const copyDiagnostic = () => copyText([
    `节点：${node}`, `操作：${verb}硬件监控`,
    ...(diagnostic ? [`失败步骤：${diagnostic.stage}`, `原因：${diagnostic.reason}`, `建议处理：${diagnostic.suggestion}`, `执行状态：${diagnostic.state}`, `诊断代码：${diagnostic.code}`] : [failure]),
    '', '操作日志', ...logs.map((entry) => `${entry.at} ${entry.message}`),
  ].join('\n'), '已复制诊断信息')

  return (
    <>
      <Section id="node-hardware" title="硬件监控" description="在节点概要中查看温度、功耗、风扇、磁盘与电源状态。">
        {query.isPending || (!data && query.isError) ? <SectionState query={query} rows={1} title="无法读取硬件监控设置" /> : (
          <>
            <div className="flex flex-col gap-4 px-(--card-p) py-5 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                {installing ? <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-primary" aria-hidden /> : data?.enabled && data.connected ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <Activity className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{installing ? `正在${verb}` : data?.paused ? '已停止采集' : data?.enabled ? data.connected ? '已接入' : '采集服务暂时不可用' : '尚未接入'}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {installing ? logs.at(-1)?.message || '正在连接节点…' : data?.paused ? '节点采集服务与 SMART 任务已停止，开机自启已关闭。保留配置，恢复时无需重装。' : data?.enabled ? data.smartAuto ? '硬件状态每 5 秒刷新，功耗显示最近采样间隔的平均值；SMART 每 10 分钟采集，休眠盘跳过。' : '传感器已接入。启用自动 SMART 后，磁盘状态会定期更新。' : '自动检测或安装下方采集组件，沿用已有节点管理员授权。无需填写采集地址和端口。'}
                  </p>
                  {data?.enabled && <p className="mt-1 text-xs text-muted-foreground">{data.managed ? '停止采集会暂停 Tiller 创建的全部任务，系统原有 SMART 监控保持不变。' : '复用现有采集服务；断开仅停止 Tiller 读取，不管理外部服务。'}</p>}
                  {needsCollectorUpdate && <p className="mt-1 text-xs text-muted-foreground">更新采集脚本，移除旧版独立功耗任务，并支持 NVMe 温度阈值。无需新增软件包。</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {(logs.length > 0 || installing || phase === 'authorize' || phase === 'success' || phase === 'error') && <Button variant="outline" size="sm" onClick={() => setOpen(true)}><FileText />操作日志</Button>}
                {(data?.enabled || (data?.managed && !data.paused)) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run('disconnect')}><Pause />{data?.managed ? '停止采集' : '断开接入'}</Button>}
                {data?.managed && <Button variant="outline" size="sm" disabled={busy} onClick={askUninstall}><Trash2 />卸载服务</Button>}
                {data?.enabled && (!data.smartAuto || needsCollectorUpdate) && <Button size="sm" disabled={busy} onClick={() => void onConnect(true)}>{upgrade.isPending ? <LoaderCircle className="animate-spin" /> : <PlugZap />}{upgrade.isPending ? '正在更新…' : data.smartAuto ? '更新采集服务' : '启用自动 SMART'}</Button>}
                {(!data?.enabled || !data.connected) && <Button size="sm" disabled={busy} onClick={() => void onConnect()}>
                  {connect.isPending ? <LoaderCircle className="animate-spin" /> : <PlugZap />}{connect.isPending ? '正在接入…' : data?.paused ? '恢复采集' : '一键接入'}
                </Button>}
              </div>
            </div>
            {!data?.enabled && <div className="border-t border-border/50 px-(--card-p) py-4"><ConnectionDetails /></div>}
          </>
        )}
        {(failure || disconnect.error || data?.error) && <p role="alert" className="px-(--card-p) py-3 text-sm text-destructive">{failure || errorMessage(disconnect.error || data?.error)}</p>}
      </Section>
      <ResponsiveDialog open={open} onOpenChange={changeOpen} title={operation === 'disconnect' ? '停止硬件采集' : operation === 'resume' ? '恢复硬件采集' : operation === 'uninstall' ? '卸载硬件监控' : operation === 'upgrade' ? '更新硬件监控' : '接入硬件监控'} size="lg"
        description={`${node} · ${operation === 'disconnect' ? '停止采集并保留配置' : operation === 'resume' ? '恢复已有服务与定时任务' : operation === 'uninstall' ? '检查依赖后移除服务与本次安装的软件' : operation === 'upgrade' ? '更新并验证已有采集服务' : '检测、安装并验证采集服务'}`}
        wrap={(children) => <form className="contents" onSubmit={(e) => { e.preventDefault(); if (phase === 'authorize') void onInstall() }}>{children}</form>}
        footer={<>
          <Button type="button" variant="outline" onClick={() => changeOpen(false)}>{installing ? '收起' : phase === 'success' ? '完成' : '关闭'}</Button>
          {phase === 'error' && <Button type="button" onClick={() => void run(operation)}>重试{verb}</Button>}
          {phase === 'confirm' && <Button type="button" variant="destructive" onClick={() => void run('uninstall')}>确认卸载</Button>}
          {phase === 'authorize' && <Button type="submit" disabled={!(challenge ? code : password)}>{challenge ? `验证并${authVerb}` : `授权并${authVerb}`}</Button>}
        </>}
      >
        <div className="space-y-4 pb-4">
          <details className="rounded-lg border border-border/60 px-3.5 py-2.5 text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground">采集内容与安装组件</summary>
            <div className="pt-3"><ConnectionDetails /></div>
          </details>
          {failure && <div role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 p-3.5 text-sm leading-relaxed">
            <div className="flex items-start gap-2 text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /><p className="font-medium">{diagnostic ? `失败步骤：${diagnostic.stage}` : failure}</p></div>
            {diagnostic && <dl className="mt-3 space-y-2.5 text-xs">
              <div><dt className="font-medium text-foreground">原因</dt><dd className="mt-0.5 text-muted-foreground">{diagnostic.reason}</dd></div>
              <div><dt className="font-medium text-foreground">建议处理</dt><dd className="mt-0.5 text-muted-foreground">{diagnostic.suggestion}</dd></div>
              <div><dt className="font-medium text-foreground">执行状态</dt><dd className="mt-0.5 text-muted-foreground">{diagnostic.state}</dd></div>
            </dl>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-destructive/10 pt-2">
              {diagnostic && <span className="break-all font-mono text-[11px] text-muted-foreground">{diagnostic.code}</span>}
              <Button type="button" variant="ghost" size="sm" className="ml-auto h-8 text-xs" onClick={() => void copyDiagnostic()}><Copy />复制诊断信息</Button>
            </div>
          </div>}
          {phase === 'confirm' ? <div className="space-y-3 rounded-xl border border-border/70 p-4 text-sm leading-relaxed"><p>移除 Tiller 创建的采集服务、SMART 定时任务、配置和缓存，并卸载安装记录中由本次接入新增的软件包。</p><p className="text-muted-foreground">若卸载会连带删除其他软件，将提示依赖冲突并取消整个卸载。系统已有的软件会保留；旧版缺少安装记录的软件包也会保留。</p></div> : <div className="rounded-xl border border-border/70 bg-muted/25">
            <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-3 text-sm font-medium" role="status">
              {installing ? <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden /> : phase === 'success' ? <CircleCheck className="size-4 text-success" aria-hidden /> : phase === 'error' || failure ? <CircleAlert className="size-4 text-destructive" aria-hidden /> : <Activity className="size-4 text-muted-foreground" aria-hidden />}
              {status}<span className="ml-auto text-xs font-normal text-muted-foreground">操作日志</span>
            </div>
            <div ref={logBox} role="log" aria-label="硬件监控接入日志" aria-live="polite" aria-relevant="additions" tabIndex={0} className={`overflow-y-auto overscroll-contain px-3.5 py-3 text-xs leading-relaxed ${failure ? 'h-28 sm:h-32' : 'h-44 sm:h-52'}`}>
              {logs.length === 0 ? <p className="text-muted-foreground">等待节点返回进度…</p> : logs.map((entry, index) => <div key={index} className="flex gap-3 py-1">
                <time dateTime={entry.at} className="shrink-0 font-mono tabular-nums text-muted-foreground">{logTime(entry.at)}</time>
                <span className="min-w-0 break-words">{entry.message}</span>
              </div>)}
            </div>
          </div>}
          {phase === 'authorize' && <div className="space-y-2">
            <Label htmlFor="hardware-credential">{challenge ? '动态验证码' : 'PVE root@pam 密码'}</Label>
            {challenge ? <Input id="hardware-credential" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} required />
              : <Input id="hardware-credential" type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required />}
            <p className="text-xs leading-relaxed text-muted-foreground">{challenge ? '输入 PVE 账户的 TOTP 验证码。' : '仅用于此次节点操作，Tiller 不保存此密码。'}</p>
          </div>}
          {installing && <p className="text-xs leading-relaxed text-muted-foreground">节点操作进行中。首次安装或卸载可能需要 1–3 分钟，可以收起窗口，请保持当前页面打开。</p>}
          {phase === 'success' && <p className="text-xs leading-relaxed text-muted-foreground">{operation === 'disconnect' ? data?.paused ? '本次接入创建的采集任务已全部停止，节点重启后也不会自行恢复。' : 'Tiller 已停止读取，外部采集服务保持原状态。' : operation === 'uninstall' ? data?.notice || 'Tiller 采集服务已卸载。' : `可在节点概要查看硬件状态。${data?.smartAuto ? '首次 SMART 结果可能稍后显示。' : '现有服务尚未启用自动 SMART，可在此页面继续启用。'}`}</p>}
        </div>
      </ResponsiveDialog>
    </>
  )
}
