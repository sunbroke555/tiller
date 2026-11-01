import { useMemo, useState } from 'react'
import { Check, Download, ExternalLink, Loader2, PackageSearch, Search } from 'lucide-react'
import { toast } from 'sonner'

import { downloadTemplate, storageKeys, useAplInfo, useStorageContent, type AplInfoEntry } from '@/api/storage-browser'
import { EmptyState } from '@/components/EmptyState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { volumeName } from './volumes'

const SECTION_LABEL: Record<string, string> = {
  system: '系统',
  turnkeylinux: 'TurnKey',
  mail: '邮件',
}

export interface TemplateCatalogDialogProps {
  node: string
  storage: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Filter and sort the appliance catalog: system first, then by package. */
export function filterTemplates(list: readonly AplInfoEntry[], section: string, query: string): AplInfoEntry[] {
  const q = query.trim().toLowerCase()
  const rank = (s: string) => (s === 'system' ? 0 : s === 'turnkeylinux' ? 2 : 1)
  return list
    .filter((t) => section === 'all' || t.section === section)
    .filter(
      (t) =>
        !q ||
        [t.package, t.headline ?? '', t.os ?? '', t.template, t.version].some((s) => s.toLowerCase().includes(q)),
    )
    .sort(
      (a, b) =>
        rank(a.section) - rank(b.section) ||
        a.package.localeCompare(b.package, undefined, { numeric: true }) ||
        b.version.localeCompare(a.version, undefined, { numeric: true }),
    )
}

/** Official container template catalog (pveam): browse and download to this storage. */
export function TemplateCatalogDialog({ node, storage, open, onOpenChange }: TemplateCatalogDialogProps) {
  const catalog = useAplInfo(node, { enabled: open })
  const existing = useStorageContent(node, storage, 'vztmpl', { enabled: open })
  const [section, setSection] = useState('all')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<Record<string, 'starting' | 'started'>>({})

  const sections = useMemo(() => {
    const s = [...new Set((catalog.data ?? []).map((t) => t.section))]
    return s.sort((a, b) => (a === 'system' ? -1 : b === 'system' ? 1 : a.localeCompare(b)))
  }, [catalog.data])
  const list = useMemo(() => filterTemplates(catalog.data ?? [], section, query), [catalog.data, section, query])
  const have = useMemo(() => new Set((existing.data ?? []).map((v) => volumeName(v))), [existing.data])

  const download = async (t: AplInfoEntry) => {
    setBusy((b) => ({ ...b, [t.template]: 'starting' }))
    try {
      await runTask(downloadTemplate(node, storage, t.template), {
        title: `下载模板 ${t.package}`,
        invalidate: [storageKeys.contentAll(node, storage), storageKeys.status(node, storage)],
      })
      setBusy((b) => ({ ...b, [t.template]: 'started' }))
    } catch (e) {
      setBusy(({ [t.template]: _, ...rest }) => rest)
      toast.error(`下载 ${t.package} 失败`, { description: errorMessage(e) })
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title="容器模板"
      description={`官方模板目录，下载到 ${storage}`}
      bodyClassName="pb-4"
    >
      <div className="grid gap-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称、系统或描述"
            aria-label="搜索模板"
            className="pl-9"
            type="search"
          />
        </div>
        {sections.length > 1 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={section}
            onValueChange={(v) => v && setSection(v)}
            aria-label="分类"
            className="justify-start"
          >
            <ToggleGroupItem value="all" className="px-3 text-xs pointer-coarse:h-9">
              全部
            </ToggleGroupItem>
            {sections.map((s) => (
              <ToggleGroupItem key={s} value={s} className="px-3 text-xs pointer-coarse:h-9">
                {SECTION_LABEL[s] ?? s}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {catalog.isPending ? (
        <div className="grid gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : catalog.isError ? (
        <EmptyState
          icon={PackageSearch}
          title="无法加载模板目录"
          description={errorMessage(catalog.error)}
          action={
            <Button variant="outline" onClick={() => void catalog.refetch()}>
              重试
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title={catalog.data.length ? '没有匹配的模板' : '模板目录为空'}
          description={catalog.data.length ? undefined : '在节点上运行 pveam update 更新模板目录。'}
        />
      ) : (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70" aria-label="模板">
          {list.map((t) => {
            const state = busy[t.template]
            const present = have.has(t.template)
            return (
              <li key={t.template} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-foreground">{t.package}</span>
                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground tabular">
                      {t.version}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {[SECTION_LABEL[t.section] ?? t.section, t.os, t.headline].filter(Boolean).join(' · ')}
                    {t.infopage && (
                      <a
                        href={t.infopage}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-1.5 inline-flex items-center gap-0.5 text-brand underline-offset-2 hover:underline"
                      >
                        介绍 <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={present || state === 'started' ? 'ghost' : 'outline'}
                  disabled={!!state || present}
                  onClick={() => void download(t)}
                  aria-label={`下载 ${t.package} ${t.version}`}
                  className={cn('shrink-0 pointer-coarse:h-10', (present || state === 'started') && 'text-success')}
                >
                  {state === 'starting' ? (
                    <Loader2 className="animate-spin" />
                  ) : present || state === 'started' ? (
                    <Check />
                  ) : (
                    <Download />
                  )}
                  {present ? '已下载' : state === 'started' ? '下载中' : '下载'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </ResponsiveDialog>
  )
}
