import { useMemo, useState } from 'react'
import { Copy, Loader2, Search } from 'lucide-react'

import { formatPackageVersions, packageRows, useAptVersions } from '@/api/node-summary'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/errors'

import { copyText } from './clipboard'

/** "软件包版本": Proxmox VE related packages (GET /nodes/{node}/apt/versions), copyable. */
export function PackageVersionsDialog({ node, open, onOpenChange }: { node: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const versions = useAptVersions(node, { enabled: open })
  const [query, setQuery] = useState('')
  const rows = useMemo(() => packageRows(versions.data ?? []), [versions.data])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows
  }, [rows, query])

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="软件包版本"
      description={`节点 ${node} 上与 Proxmox VE 相关的软件包。`}
      size="lg"
      bodyClassName="px-0 lg:px-0"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button disabled={!versions.data} onClick={() => void copyText(formatPackageVersions(versions.data ?? []), '已复制软件包版本')}>
            <Copy /> 复制全部
          </Button>
        </>
      }
    >
      <div className="px-5 pb-2 lg:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选软件包"
            aria-label="筛选软件包"
            className="pl-9"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      {versions.isPending ? (
        <div className="flex items-center gap-2 px-5 py-8 text-sm text-muted-foreground lg:px-6">
          <Loader2 className="size-4 animate-spin" /> 正在读取…
        </div>
      ) : versions.isError ? (
        <p className="px-5 py-8 text-sm text-destructive lg:px-6">{errorMessage(versions.error)}</p>
      ) : (
        <ul className="divide-y divide-border/60" aria-label="软件包">
          {shown.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-3 px-5 py-2.5 lg:px-6">
              <div className="min-w-0">
                <div className="truncate font-mono text-[13px]">{r.name}</div>
                {r.note && <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular">{r.note}</div>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className={r.version ? 'text-[13px] tabular' : 'text-xs text-muted-foreground'}>{r.version ?? '未正确安装'}</span>
                {r.candidate && (
                  <Badge variant="secondary" className="text-[10px] font-normal tabular">
                    可更新 {r.candidate}
                  </Badge>
                )}
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">没有匹配的软件包</li>}
        </ul>
      )}
    </ResponsiveDialog>
  )
}
