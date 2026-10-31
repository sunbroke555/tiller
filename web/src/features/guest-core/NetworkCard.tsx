import { useMemo, useState } from 'react'
import { Copy, Network, PlugZap, PowerOff } from 'lucide-react'
import { toast } from 'sonner'

import type { AgentOsInfo, AgentNetworkInterface, LxcInterface } from '@/api/guest-core'
import type { GuestType } from '@/api/types'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { fromAgent, fromLxc, visibleInterfaces, type GuestAddress } from './ips'
import { CardNote, CardTitle } from './parts'

interface NetworkCardProps {
  type: GuestType
  running: boolean
  /** QEMU: agent enabled in the config. */
  agentEnabled: boolean
  data: AgentNetworkInterface[] | LxcInterface[] | undefined
  loading: boolean
  error: boolean
  osInfo?: AgentOsInfo | null
  hostname?: string | null
}

/** IP addresses of the guest (guest agent for VMs, /interfaces for CTs). */
export function NetworkCard({ type, running, agentEnabled, data, loading, error, osInfo, hostname }: NetworkCardProps) {
  const [all, setAll] = useState(false)
  const list = useMemo(
    () => (data ? (type === 'qemu' ? fromAgent(data as AgentNetworkInterface[]) : fromLxc(data as LxcInterface[])) : []),
    [data, type],
  )
  const shown = visibleInterfaces(list, all)
  const hidden = visibleInterfaces(list, true).reduce((n, i) => n + i.addresses.length, 0) - shown.reduce((n, i) => n + i.addresses.length, 0)

  let body
  if (!running) {
    body = <CardNote icon={PowerOff} title={type === 'qemu' ? '虚拟机未运行' : '容器未运行'}>运行后可在这里看到 IP 地址。</CardNote>
  } else if (type === 'qemu' && !agentEnabled) {
    body = (
      <CardNote icon={PlugZap} title="未启用 QEMU Guest Agent">
        在“选项”中启用 Guest Agent，并在系统内安装 qemu-guest-agent 后即可显示 IP 地址。
      </CardNote>
    )
  } else if (loading) {
    body = (
      <div className="grid gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-56" />
      </div>
    )
  } else if (error) {
    body = (
      <CardNote icon={PlugZap} title={type === 'qemu' ? 'Guest Agent 未运行' : '无法读取网卡信息'}>
        {type === 'qemu' ? '确认系统内已安装并启动 qemu-guest-agent。' : '稍后会自动重试。'}
      </CardNote>
    )
  } else if (shown.length === 0) {
    body = <CardNote icon={Network} title="没有可显示的 IP 地址">{hidden > 0 ? '只有本地回环或链路本地地址。' : undefined}</CardNote>
  } else {
    body = (
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {shown.map((i) => (
          <li key={i.name} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-mono font-medium text-foreground/90">{i.name}</span>
              {i.mac && <span className="truncate font-mono text-muted-foreground">{i.mac.toUpperCase()}</span>}
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {i.addresses.map((a) => (
                <AddressChip key={`${a.address}/${a.prefix ?? ''}`} address={a} />
              ))}
            </div>
          </li>
        ))}
      </ul>
    )
  }

  const os = osInfo?.['pretty-name'] ?? osInfo?.name
  return (
    <GlassCard>
      <CardTitle
        title="网络"
        icon={Network}
        action={
          running && (hidden > 0 || all) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAll((v) => !v)}
              className="-mr-2 h-8 px-2.5 text-xs text-muted-foreground pointer-coarse:h-11"
            >
              {all ? '只看主要地址' : `显示全部${hidden > 0 ? `（+${hidden}）` : ''}`}
            </Button>
          ) : null
        }
      />
      {(hostname || os) && running && (
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          {hostname && (
            <>
              <dt className="text-muted-foreground">主机名</dt>
              <dd className="truncate text-right font-mono">{hostname}</dd>
            </>
          )}
          {os && (
            <>
              <dt className="text-muted-foreground">系统</dt>
              <dd className="truncate text-right">
                {os}
                {osInfo?.['kernel-release'] && <span className="text-muted-foreground"> · {osInfo['kernel-release']}</span>}
              </dd>
            </>
          )}
        </dl>
      )}
      {body}
    </GlassCard>
  )
}

function AddressChip({ address: a }: { address: GuestAddress }) {
  const text = a.prefix !== undefined ? `${a.address}/${a.prefix}` : a.address
  const copy = () => {
    void navigator.clipboard?.writeText(a.address).then(
      () => toast.success(`已复制 ${a.address}`),
      () => toast.error('无法复制'),
    )
  }
  return (
    <button
      type="button"
      onClick={copy}
      title="复制地址"
      className={cn(
        'group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg bg-foreground/[0.05] px-2.5 font-mono text-[13px] text-foreground transition-colors hover:bg-foreground/[0.09] pointer-coarse:min-h-10 paper:bg-secondary',
        a.minor && 'text-muted-foreground',
      )}
    >
      <span className="text-[10px] font-sans font-medium text-muted-foreground">{a.family === 4 ? 'IPv4' : 'IPv6'}</span>
      <span className="min-w-0 truncate">{text}</span>
      <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 pointer-coarse:opacity-40" aria-hidden />
    </button>
  )
}
