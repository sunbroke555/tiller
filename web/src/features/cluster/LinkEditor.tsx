// Corosync link editor (PVE.form.CorosyncLinkEditor): one row per link with
// the link number, this node's address on it (suggested from the node's
// interfaces) and, when creating a cluster, the knet priority.

import { Plus, Trash2 } from 'lucide-react'

import { SelectField } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { MAX_LINKS, nextFreeAddress, nextFreeLinkNumber, type LinkRow } from './logic'

/** Address suggestions shown per row (a node rarely has more useful ones). */
const MAX_CANDIDATES = 6

export interface LinkEditorProps {
  rows: LinkRow[]
  onChange: (rows: LinkRow[]) => void
  /** Addresses of this node to pick from. */
  candidates: readonly { address: string; iface: string }[]
  /** Create: numbers editable, rows can be added/removed, priority column. Join: fixed by the cluster. */
  editable: boolean
  /** knet priority column (create only; ignored by PVE on join). Default: editable. */
  priority?: boolean
  /** Index → error text. */
  errors?: Record<number, string>
  /** Show errors (after the first submit attempt). */
  showErrors?: boolean
}

export function LinkEditor({ rows, onChange, candidates, editable, priority = editable, errors = {}, showErrors = false }: LinkEditorProps) {
  const update = (i: number, patch: Partial<LinkRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => {
    const number = nextFreeLinkNumber(rows)
    if (number === null) return
    onChange([...rows, { number, address: nextFreeAddress(rows, candidates.map((c) => c.address)), priority: '' }])
  }
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i))

  return (
    <div className="grid gap-2" role="group" aria-label="Corosync 链路">
      {rows.map((row, i) => {
        const error = showErrors ? errors[i] : undefined
        const numberOptions = Array.from({ length: MAX_LINKS }, (_, n) => ({
          value: String(n),
          label: `链路 ${n}`,
          disabled: n !== row.number && rows.some((r) => r.number === n),
        }))
        return (
          <div
            key={i}
            data-testid="link-row"
            data-link={row.number}
            className="grid gap-2 rounded-xl bg-foreground/[0.03] p-2.5 ring-1 ring-border/60 ring-inset paper:bg-secondary/50"
          >
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              {editable ? (
                <SelectField
                  aria-label={`链路号（第 ${i + 1} 行）`}
                  value={String(row.number)}
                  onValueChange={(v) => v !== undefined && update(i, { number: Number(v) })}
                  options={numberOptions}
                  className="w-[6.5rem] shrink-0"
                />
              ) : (
                <span className="inline-flex h-9 w-16 shrink-0 items-center text-sm font-medium tabular pointer-coarse:h-11">链路 {row.number}</span>
              )}
              <Input
                aria-label={`链路 ${row.number} 地址`}
                aria-invalid={error ? true : undefined}
                value={row.address}
                onChange={(e) => update(i, { address: e.target.value })}
                placeholder={row.optional ? '留空：按本节点主机名解析' : 'IP 地址或主机名'}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                inputMode="url"
                className="min-w-0 flex-1 basis-48 font-mono text-[13px]"
              />
              {priority && (
                <Input
                    aria-label={`链路 ${row.number} 优先级`}
                    value={row.priority}
                    onChange={(e) => update(i, { priority: e.target.value.replace(/[^\d]/g, '') })}
                    placeholder="优先级"
                    inputMode="numeric"
                    title="knet 优先级 0–255，留空为 0"
                    className="w-[5.5rem] shrink-0 tabular max-sm:flex-1"
                  />
              )}
              {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`删除链路 ${row.number}`}
                    disabled={rows.length <= 1}
                    onClick={() => remove(i)}
                  >
                    <Trash2 />
                  </Button>
              )}
            </div>
            {candidates.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`链路 ${row.number} 可选地址`}>
                <span className="text-xs text-muted-foreground">本节点：</span>
                {candidates.slice(0, MAX_CANDIDATES).map((c) => {
                  const active = row.address.trim() === c.address
                  return (
                    <button
                      key={c.address}
                      type="button"
                      aria-pressed={active}
                      aria-label={`链路 ${row.number} 使用 ${c.address}`}
                      title={c.iface}
                      onClick={() => update(i, { address: c.address })}
                      className={cn(
                        'inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2.5 font-mono text-[12px] ring-1 transition-colors ring-inset pointer-coarse:h-9',
                        active
                          ? 'bg-brand/14 text-brand-strong ring-brand/40 paper:bg-secondary paper:text-foreground paper:ring-foreground/30'
                          : 'text-foreground/80 ring-border hover:bg-foreground/[0.05]',
                      )}
                    >
                      <span className="truncate">{c.address}</span>
                      <span className="font-sans text-[11px] text-muted-foreground">{c.iface}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {row.peer && <p className="text-xs text-muted-foreground">对端在这条链路上的地址：<span className="font-mono">{row.peer}</span></p>}
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        )
      })}
      {editable && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={rows.length >= MAX_LINKS}>
            <Plus />
            添加链路
          </Button>
          <span className="text-xs text-muted-foreground">
            多条链路互为备份；{priority ? '优先级数值大的先用，相同时' : ''}链路号小的先用。
          </span>
        </div>
      )}
    </div>
  )
}
