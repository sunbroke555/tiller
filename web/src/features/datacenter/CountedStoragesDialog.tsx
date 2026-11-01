import { useMemo } from 'react'

import { useClusterResources } from '@/api/queries'
import { CheckboxField } from '@/components/form'
import { LoadingRows } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { formatUsage } from '@/lib/format'

import { isCounted, storageChoices, toggleChoice, useCountedStorages } from './countedStorages'

/**
 * "计入总量的存储": pick the storages the datacenter storage total sums up
 * (official My Settings → Dashboard Storages). Changes apply immediately and
 * are kept on this device only.
 */
export function CountedStoragesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const resources = useClusterResources()
  const [counted, setCounted] = useCountedStorages()
  const choices = useMemo(() => storageChoices(resources.data ?? []), [resources.data])
  const checkedCount = choices.filter((c) => isCounted(counted, c)).length
  const all = counted.length === 0 || checkedCount === choices.length

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="计入总量的存储"
      description="数据中心概要里的存储用量只统计勾选的存储；共享存储只算一次。设置只保存在这台设备上。"
      footer={
        <>
          <Button variant="outline" disabled={all} onClick={() => setCounted([])}>
            全部计入
          </Button>
          <Button onClick={() => onOpenChange(false)}>完成</Button>
        </>
      }
    >
      {resources.isPending ? (
        <LoadingRows rows={3} />
      ) : choices.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有存储。</p>
      ) : (
        <div role="group" aria-label="存储" className="grid gap-0.5">
          {choices.map((c) => {
            const checked = isCounted(counted, c)
            return (
              <CheckboxField
                key={c.key}
                label={
                  <span className="inline-flex flex-wrap items-baseline gap-x-2">
                    {c.storage}
                    <span className="text-xs font-normal text-muted-foreground">{c.node ?? '共享'}</span>
                  </span>
                }
                description={[c.plugintype, c.available ? formatUsage(c.used, c.total) : '不可用'].filter(Boolean).join(' · ')}
                checked={checked}
                // The last counted storage stays checked: none would mean "all".
                disabled={checked && checkedCount === 1}
                onCheckedChange={(on) => setCounted(toggleChoice(counted, choices, c, on))}
              />
            )
          })}
        </div>
      )}
    </ResponsiveDialog>
  )
}
