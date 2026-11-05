import { BatteryCharging, Fan, Gauge, HardDrive, LoaderCircle, Thermometer, Zap, type LucideIcon } from 'lucide-react'

import { useHardwareAction, useNodeHardware, type HardwareBattery, type HardwareReading } from '@/api/node-hardware'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/errors'
import { METRIC_FILL, METRIC_TEXT, remainingTone, sensorTemperatureKind, temperatureHint, temperatureTone, usageTone, type MetricTone } from '@/lib/metric-status'

function number(value: number | undefined, digits = 0) {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}
function clock(value?: string) {
  return value && !value.startsWith('0001-') ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null
}
function Metric({ icon: Icon, label, value, unit, detail, tone = 'normal', hint, empty = '未提供' }: { icon: LucideIcon; label: string; value: string; unit: string; detail: string; tone?: MetricTone; hint?: string; empty?: string }) {
  const available = value !== '—'
  return <div className="min-w-0 px-(--card-p) py-4">
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-4" aria-hidden />{label}</p>
    <p title={hint} className={cn('mt-2 flex min-h-8 flex-wrap items-baseline gap-x-1.5 font-medium', available ? cn('text-2xl tracking-tight tabular', METRIC_TEXT[tone]) : 'items-center text-sm text-muted-foreground')}>
      {available ? value : empty}
      {available && <span className="text-xs font-normal tracking-normal opacity-70">{unit}</span>}
    </p>
    <p className="mt-1 text-xs leading-relaxed break-words text-muted-foreground">{detail}</p>
  </div>
}
function Reading({ reading, label = reading.name, unit }: { reading: HardwareReading; label?: string; unit: string }) {
  const kind = sensorTemperatureKind(reading)
  return <div className="flex min-w-0 items-baseline justify-between gap-3 py-1.5 text-sm">
    <dt title={reading.name} className="min-w-0 break-words text-muted-foreground">{label}</dt>
    <dd className={cn('shrink-0 text-xs tabular', unit === '°C' && METRIC_TEXT[temperatureTone(reading.value, reading.limit, kind, reading.warningLimit)])} title={unit === '°C' ? temperatureHint(reading.limit, kind, reading.warningLimit) : undefined}>
      {number(reading.value, unit === 'RPM' ? 0 : 1)} <span className="opacity-70">{unit}</span>
    </dd>
  </div>
}
function TemperatureReadings({ readings }: { readings: HardwareReading[] }) {
  const groups = new Map<string, { reading: HardwareReading; label: string }[]>()
  for (const reading of readings) {
    const separator = reading.name.indexOf(' · ')
    const group = separator > 0 ? reading.name.slice(0, separator) : '其他传感器'
    const label = separator > 0 ? reading.name.slice(separator + 3) : reading.name
    const entries = groups.get(group) ?? []
    entries.push({ reading, label })
    groups.set(group, entries)
  }
  return <section aria-label="温度传感器" className="@container min-w-0">
    <h3 className="flex items-baseline gap-2 text-sm font-medium">温度<span className="text-xs font-normal text-muted-foreground">{readings.length} 路传感器</span></h3>
    {readings.length ? <div className="mt-3 divide-y divide-border/60">
      {Array.from(groups, ([group, entries]) => <div key={group} className="py-3 first:pt-0 last:pb-0">
        <h4 className="mb-1 text-xs font-medium break-words text-foreground">{group}</h4>
        <dl className="grid gap-x-6 @min-[16rem]:grid-cols-2 @min-[28rem]:grid-cols-3 @min-[42rem]:grid-cols-4">
          {entries.map(({ reading, label }) => <Reading key={reading.id} reading={reading} label={label} unit="°C" />)}
        </dl>
      </div>)}
    </div> : <p className="mt-2 text-xs text-muted-foreground">没有可用的温度传感器</p>}
  </section>
}
function Readings({ title, readings, unit, empty }: { title: string; readings: HardwareReading[]; unit: string; empty: string }) {
  return <div className="min-w-0">
    <h3 className="mb-2 text-sm font-medium">{title}</h3>
    {readings.length ? <dl>{readings.map((reading) => <Reading key={reading.id} reading={reading} unit={unit} />)}</dl> : <p className="text-xs text-muted-foreground">{empty}</p>}
  </div>
}
function Battery({ data }: { data: HardwareBattery }) {
  const state = data.status?.split(' ') ?? []
  const tone = state.includes('LB') ? 'critical' : remainingTone(data.charge)
  const status = state.includes('OB') ? '电池供电' : state.includes('OL') ? '市电供电' : ({ Charging: '充电中', Discharging: '放电中', Full: '已充满', 'Not charging': '未充电' }[data.status ?? ''] || data.status || '状态未知')
  return <div className="space-y-2">
    <div className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{data.name}</span><span className={cn('shrink-0 text-xs', state.includes('LB') ? 'text-destructive' : state.includes('OB') ? 'text-warning-strong' : 'text-muted-foreground')}>{status}{state.includes('LB') ? ' · 电量低' : ''}</span></div>
    {data.charge !== undefined && <div className="flex items-center gap-3" title="剩余电量 ≤ 20% 为警告，≤ 10% 为严重"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" role="meter" aria-label={`${data.name} 电量`} aria-valuenow={Number.isFinite(data.charge) ? data.charge : undefined} aria-valuemin={0} aria-valuemax={100}><div className={cn('h-full rounded-full', METRIC_FILL[tone])} style={{ width: `${Number.isFinite(data.charge) ? Math.max(0, Math.min(100, data.charge)) : 0}%` }} /></div><span className={cn('font-mono text-xs tabular', METRIC_TEXT[tone])}>{number(data.charge)}%</span></div>}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {data.runtime !== undefined && <span>预计续航 {number(data.runtime / 60)} 分钟</span>}
      {data.load !== undefined && <span className={METRIC_TEXT[usageTone(data.load / 100)]}>负载 {number(data.load)}%</span>}
      {data.voltage !== undefined && <span>{data.source === 'nut' ? '输入' : '电池'} {number(data.voltage, 1)} V</span>}
    </div>
  </div>
}

export function HardwareOverview({ node }: { node: string }) {
  const query = useNodeHardware(node)
  const disks = useHardwareAction(node, 'disks')
  const data = query.data
  // Setup lives exclusively in System. Unconfigured nodes keep their existing
  // summary layout, with no installation prompt competing with status data.
  if (!data?.enabled) return null
  const temps = data.temperatures ?? []
  const fans = data.fans ?? []
  const hasPower = !!data.batteries?.length || !!data.powers?.length
  const hasAuxiliary = fans.length > 0 || hasPower
  const highest = temps.filter((r) => Number.isFinite(r.value)).reduce<HardwareReading | undefined>((max, r) => !max || r.value > max.value ? r : max, undefined)
  const highestKind = sensorTemperatureKind(highest)
  const fastest = fans.length ? Math.max(...fans.map((r) => r.value)) : undefined
  const updated = clock(data.updatedAt)
  const diskTime = clock(data.disksUpdatedAt)
  const smartStale = data.smartAuto && diskTime && Date.now() - Date.parse(data.disksUpdatedAt!) > 30 * 60_000
  const stale = !data.connected || query.isError
  const powerAge = data.powerUpdatedAt ? Date.now() - Date.parse(data.powerUpdatedAt) : 0
  const powerExpired = data.cpuWatts !== undefined && (!Number.isFinite(powerAge) || powerAge > 15_000 || powerAge < -1_000)
  const watts = powerExpired ? undefined : data.cpuWatts
  const powerError = powerExpired ? '功耗缓存已过期，正在重新采样' : data.powerError
  const powerWindow = number(data.powerSampleSeconds ?? 5, 1)
  return <GlassCard asChild flush>
    <section aria-labelledby="hardware-overview-heading" className="min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-(--card-p) py-4">
        <h2 id="hardware-overview-heading" className="text-sm font-semibold">硬件状态</h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground"><span className={cn('size-1.5 rounded-full', stale ? 'bg-warning' : 'bg-success')} aria-hidden />{stale ? '数据暂未更新' : '实时采集'}{updated && <span className="tabular">· {updated}</span>}</span>
      </header>
      {stale && <p role="status" className="border-b border-border/60 bg-warning/5 px-(--card-p) py-3 text-xs text-warning-strong">{data.error || '暂时无法刷新硬件状态。'}{updated && ' 下方保留最近一次数据。'}</p>}
      <div className="grid grid-cols-2 border-b border-border/60 lg:grid-cols-4">
        <Metric icon={Thermometer} label="最高温度" value={number(highest?.value, 1)} unit="°C" tone={temperatureTone(highest?.value, highest?.limit, highestKind, highest?.warningLimit)} hint={highest ? `${highest.name} · ${temperatureHint(highest.limit, highestKind, highest.warningLimit)}` : undefined} detail={highest?.name ?? '节点未提供温度读数'} />
        <Metric icon={Zap} label="CPU 功耗" value={number(watts, 1)} unit="W" empty={powerError ? '暂不可用' : data.powerPending ? '采样中' : '未提供'}
          hint={watts === undefined ? undefined : `最近约 ${powerWindow} 秒的 CPU 封装平均功耗${clock(data.powerUpdatedAt) ? ` · 采样于 ${clock(data.powerUpdatedAt)}` : ''}`}
          detail={powerError || (data.powerPending ? '暂无新鲜缓存，等待下次采样，约 5 秒' : watts === undefined ? '节点未提供能耗计数器' : `近 ${powerWindow} 秒平均 · 每 5 秒更新`)} />
        <Metric icon={Gauge} label="CPU 平均频率" value={number(data.frequencyGHz, 2)} unit="GHz" detail="各 CPU 核心的平均频率" />
        <Metric icon={Fan} label="风扇转速" value={number(fastest)} unit="RPM" detail={fans.length ? `${fans.length} 路风扇 · 最高转速` : '节点未提供风扇读数'} />
      </div>
      <div className={cn('grid items-start gap-6 p-(--card-p)', temps.length > 0 && hasAuxiliary && 'xl:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]')}>
        <TemperatureReadings readings={temps} />
        {hasAuxiliary && <div className="min-w-0 space-y-5">
          {fans.length > 0 && <Readings title="风扇" readings={fans} unit="RPM" empty="" />}
          {!!data.batteries?.length && <section aria-label="电源与 UPS" className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium"><BatteryCharging className="size-4 text-muted-foreground" aria-hidden />电源与 UPS</h3>
            <div className="space-y-5">{data.batteries.map((battery) => <Battery key={`${battery.source}:${battery.name}`} data={battery} />)}</div>
          </section>}
          {!!data.powers?.length && <Readings title="功率传感器" readings={data.powers} unit="W" empty="" />}
        </div>}
      </div>
      {!data.batteries?.length && <p className="flex items-start gap-2 border-t border-border/60 px-(--card-p) py-3 text-xs leading-relaxed text-muted-foreground"><BatteryCharging className="size-4 shrink-0" aria-hidden />未检测到电池或 UPS 读数</p>}
      {!!data.collectorErrors?.length && <p className="border-t border-border/60 bg-warning/5 px-(--card-p) py-3 text-xs leading-relaxed text-warning-strong">部分传感器读取失败：{data.collectorErrors.join('、')}</p>}
      <div className="border-t border-border/60 px-(--card-p) py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-medium"><HardDrive className="size-4 text-muted-foreground" aria-hidden />磁盘健康</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{data.smartAuto ? '后台每 10 分钟采集，跳过休眠盘。刷新页面只读取缓存。' : '当前采集服务尚未启用自动 SMART，手动读取可能唤醒硬盘。'}{diskTime && <span className="tabular">上次 {diskTime}</span>}</p>
          </div>
          <Button variant="outline" size="sm" disabled={disks.isPending} onClick={() => disks.mutate()}>{disks.isPending && <LoaderCircle className="animate-spin" />}{disks.isPending ? '读取中…' : data.smartAuto ? '刷新显示' : '读取 SMART'}</Button>
        </div>
        {disks.error && <p role="alert" className="mt-3 text-xs text-destructive">{errorMessage(disks.error)}</p>}
        {smartStale && <p role="status" className="mt-3 text-xs text-warning-strong">SMART 后台采集已超过 30 分钟未更新，下方保留最近一次结果。</p>}
        {data.disks?.length ? <ul className="mt-4 divide-y divide-border/60">{data.disks.map((disk) => {
          const good = /^(PASSED|OK)$/i.test(disk.health)
          const unknown = /^(UNKNOWN|N\/A)$/i.test(disk.health)
          const temperatureKind = disk.device.startsWith('/dev/nvme') ? 'nvme' : 'disk'
          return <li key={disk.device} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1 basis-40"><p className="break-words text-sm">{disk.model || disk.device}</p><p className="mt-0.5 font-mono text-xs text-faint">{disk.device}</p>
              {disk.state && disk.state !== 'online' && <p className="mt-1 text-xs text-muted-foreground">{{ sleeping: '休眠中，已跳过', unsupported: '无法安全判断休眠状态，已跳过自动读取', error: '本次读取失败' }[disk.state]}{clock(disk.updatedAt) && <span> · 上次读取 {new Date(disk.updatedAt!).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs"><span title={temperatureHint(disk.temperatureCritical, temperatureKind, disk.temperatureWarning)} className={cn('font-mono tabular', METRIC_TEXT[temperatureTone(disk.temperature, disk.temperatureCritical, temperatureKind, disk.temperatureWarning)])}>{number(disk.temperature)} °C</span>
              {disk.life !== undefined && <span title="剩余寿命 ≤ 20% 为警告，≤ 10% 为严重" className={cn('text-muted-foreground', METRIC_TEXT[remainingTone(disk.life)])}>剩余寿命 {number(disk.life)}%</span>}
              <span className={cn('rounded-md px-2 py-1', good ? 'bg-success/10 text-success' : unknown ? 'bg-muted text-muted-foreground' : 'bg-destructive/10 text-destructive')}>{good ? disk.state && disk.state !== 'online' ? '上次健康' : '健康' : unknown ? '暂无 SMART' : disk.health}</span>
            </div>
          </li>
        })}</ul> : <p className="mt-4 text-xs text-faint">{diskTime ? '节点未返回物理磁盘信息' : data.smartAuto ? '尚未收到首次 SMART 采集结果，稍后会自动显示' : '尚未读取磁盘 SMART'}</p>}
      </div>
    </section>
  </GlassCard>
}
