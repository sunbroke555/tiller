import { useMemo, useState } from 'react'
import { Copy, PackageSearch, Search } from 'lucide-react'

import { formatPackageVersions, packageRows, useAptVersions } from '@/api/node-summary'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorCard, LoadingRows } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { copyText } from '@/features/node-summary/clipboard'

/** Installed versions of the Proxmox VE packages (GET apt/versions), like the summary's "软件包版本". */
export function InstalledVersions({ node }: { node: string }) {
  const versions = useAptVersions(node)
  const [query, setQuery] = useState('')
  const rows = useMemo(() => packageRows(versions.data ?? []), [versions.data])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows
  }, [rows, query])

  if (versions.isError && !versions.data) {
    return <ErrorCard error={versions.error} onRetry={() => void versions.refetch()} title="无法读取软件包版本" />
  }

  return (
    <div className="grid gap-(--row-gap)">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选软件包"
            aria-label="筛选软件包"
            className="pl-9"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button
          variant="outline"
          disabled={!versions.data}
          onClick={() => void copyText(formatPackageVersions(versions.data ?? []), '已复制软件包版本')}
        >
          <Copy /> 复制全部
        </Button>
      </div>
      <GlassCard flush className="overflow-hidden">
        {versions.isPending ? (
          <LoadingRows rows={8} />
        ) : shown.length === 0 ? (
          <EmptyState icon={PackageSearch} title="没有匹配的软件包" />
        ) : (
          <ul className="divide-y divide-border/60 lg:grid lg:grid-cols-2 lg:divide-y-0" aria-label="软件包版本">
            {shown.map((r) => (
              <li
                key={r.key}
                className="flex min-h-12 items-center justify-between gap-3 px-(--card-p) py-2 lg:border-b lg:border-border/60 lg:odd:border-r"
              >
                <div className="min-w-0">
                  <div className="truncate font-mono text-[13px]">{r.name}</div>
                  {r.note && <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular">{r.note}</div>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={r.version ? 'font-mono text-xs tabular' : 'text-xs text-muted-foreground'}>{r.version ?? '未正确安装'}</span>
                  {r.candidate && (
                    <Badge variant="secondary" className="text-[10px] font-normal tabular">
                      可更新 {r.candidate}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  )
}
