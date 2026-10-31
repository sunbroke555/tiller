import { useNodeRrdData, type NodeRrdSample } from '@/api/node-summary'
import { SectionHeader } from '@/components/PageHeader'
import { RrdChart, RrdRangePicker, useRrdRange, type RrdSeries } from '@/components/charts/RrdChart'
import { errorMessage } from '@/lib/errors'

type S = RrdSeries<NodeRrdSample>

const CPU: S[] = [
  { key: 'cpu', label: 'CPU', scale: 100, color: 'var(--chart-1)' },
  { key: 'iowait', label: 'IO 延迟', scale: 100, color: 'var(--chart-4)' },
]
const LOAD: S[] = [{ key: 'loadavg', label: '负载', color: 'var(--chart-2)' }]
const MEMORY: S[] = [
  { key: 'memused', label: '已用', color: 'var(--chart-1)' },
  { key: 'arcsize', label: 'ZFS ARC', color: 'var(--chart-3)', value: (s) => (s.arcsize !== undefined && s.arcsize > 1024 * 1024 ? s.arcsize : null) },
  { key: 'memavailable', label: '可用', color: 'var(--chart-2)', kind: 'line' },
  { key: 'memtotal', label: '总量', color: 'var(--muted-foreground)', kind: 'line', dashed: true },
]
const SWAP_ROOT: S[] = [
  { key: 'swapused', label: '交换已用', color: 'var(--chart-5)' },
  { key: 'swaptotal', label: '交换总量', color: 'var(--muted-foreground)', kind: 'line', dashed: true },
]
const NET: S[] = [
  { key: 'netin', label: '接收', color: 'var(--chart-1)' },
  { key: 'netout', label: '发送', color: 'var(--chart-2)' },
]
const PSI_CPU: S[] = [{ key: 'pressurecpusome', label: 'Some', color: 'var(--chart-4)' }]
const PSI_IO: S[] = [
  { key: 'pressureiosome', label: 'Some', color: 'var(--chart-4)' },
  { key: 'pressureiofull', label: 'Full', color: 'var(--destructive)' },
]
const PSI_MEM: S[] = [
  { key: 'pressurememorysome', label: 'Some', color: 'var(--chart-4)' },
  { key: 'pressurememoryfull', label: 'Full', color: 'var(--destructive)' },
]

/** History charts of the node summary: CPU, load, memory, network, pressure stall. */
export function NodeCharts({ node }: { node: string }) {
  const range = useRrdRange()
  const rrd = useNodeRrdData(node, range.timeframe, range.cf)
  const common = {
    data: rrd.data,
    timeframe: range.timeframe,
    loading: rrd.isPending,
    error: rrd.isError && !rrd.data ? `无法加载图表：${errorMessage(rrd.error)}` : undefined,
  }
  const hasSwap = rrd.data?.some((p) => (p.swapused ?? 0) > 0)

  return (
    <section aria-labelledby="node-charts-heading">
      <SectionHeader title={<span id="node-charts-heading">历史</span>}>
        <RrdRangePicker value={range} onChange={range.set} />
      </SectionHeader>
      <div className="grid gap-(--row-gap) lg:grid-cols-2 lg:[&>*:last-child:nth-child(odd)]:col-span-2">
        <RrdChart title="CPU 使用率" unit="percent" series={CPU} {...common} />
        <RrdChart title="服务器负载" unit="number" series={LOAD} {...common} />
        <RrdChart title="内存" unit="bytes" series={MEMORY} {...common} />
        <RrdChart title="网络流量" unit="bytesPerSecond" series={NET} {...common} />
        {hasSwap && <RrdChart title="交换分区" unit="bytes" series={SWAP_ROOT} {...common} />}
        <RrdChart title="CPU 压力（PSI）" unit="percent" series={PSI_CPU} {...common} />
        <RrdChart title="IO 压力（PSI）" unit="percent" series={PSI_IO} {...common} />
        <RrdChart title="内存压力（PSI）" unit="percent" series={PSI_MEM} {...common} />
      </div>
    </section>
  )
}
