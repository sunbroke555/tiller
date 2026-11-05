import { useId } from 'react'
import { Link } from 'react-router'
import { Server } from 'lucide-react'

import { getInstanceScope } from '@/api/instance-scope'
import { switchInstance, useInstances } from '@/api/instances'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function InstanceSwitcher({ login = false }: { login?: boolean }) {
  const id = useId()
  const catalog = useInstances()
  const current = getInstanceScope()?.id
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs text-muted-foreground">PVE 实例</Label>
        <Link to="/instances" className="rounded text-xs text-brand-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">管理实例</Link>
      </div>
      <Select value={current} disabled={!catalog.data} onValueChange={(value) => {
        const instance = catalog.data?.instances.find((i) => i.id === value)
        if (instance && value !== current) switchInstance(instance)
      }}>
        <SelectTrigger id={id} className={`w-full min-w-0 *:data-[slot=select-value]:min-w-0 ${login ? 'rounded-xl data-[size=default]:h-12 pointer-coarse:data-[size=default]:h-12' : ''}`}>
          <Server aria-hidden className="size-4 shrink-0" />
          <SelectValue className="flex-1 text-left" placeholder={catalog.isError ? '实例列表加载失败' : '加载实例…'} />
        </SelectTrigger>
        <SelectContent position="popper" className="w-(--radix-select-trigger-width) max-w-[calc(100vw-2rem)]">
          {catalog.data?.instances.map((instance) => (
            <SelectItem key={instance.id} value={instance.id}><span className="truncate">{instance.name}</span></SelectItem>
          ))}
        </SelectContent>
      </Select>
      {catalog.isError && <button type="button" className="col-span-full text-left text-xs text-destructive underline" onClick={() => void catalog.refetch()}>无法读取实例列表，点击重试</button>}
    </div>
  )
}
