// Privilege multi-select of the role editor, grouped by prefix (VM.*,
// Datastore.*, Sys.*, …). Read-only mode lists a built-in role's privileges.

import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { PRIV_HINT, groupPrivileges } from './logic'

export interface PrivilegePickerProps {
  /** Every known privilege. */
  all: readonly string[]
  value: readonly string[]
  onChange?: (privs: string[]) => void
  readOnly?: boolean
  invalid?: boolean
}

export function PrivilegePicker({ all, value, onChange, readOnly, invalid }: PrivilegePickerProps) {
  const [query, setQuery] = useState('')
  const selected = useMemo(() => new Set(value), [value])
  // Privileges of the role that PVE no longer knows stay visible (and removable).
  const universe = useMemo(() => [...new Set([...all, ...value])], [all, value])
  const groups = useMemo(() => groupPrivileges(readOnly ? [...value] : universe), [readOnly, value, universe])
  // Groups start open when they hold selected privileges; a search opens all.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readOnly || groups.length <= 2 ? groups.map((g) => g.id) : groupPrivileges([...value]).map((g) => g.id)))
  const q = query.trim().toLowerCase()
  const match = (p: string) => !q || p.toLowerCase().includes(q) || (PRIV_HINT[p] ?? '').includes(q)

  const setMany = (privs: readonly string[], on: boolean) => {
    const next = new Set(selected)
    for (const p of privs) {
      if (on) next.add(p)
      else next.delete(p)
    }
    onChange?.([...next].sort())
  }

  return (
    <div className={cn('overflow-hidden rounded-xl border border-input bg-(--field)', invalid && 'border-destructive/60')} data-testid="privilege-picker">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          {readOnly ? `${value.length} 项权限` : `已选 ${value.length} / ${universe.length}`}
        </span>
        <div className="relative w-full sm:w-52">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索权限" aria-label="搜索权限" className="h-9 pl-8" />
        </div>
      </div>
      <div className="max-h-[min(26rem,50dvh)] divide-y divide-border/50 overflow-y-auto">
        {groups.map((g) => {
          const visible = g.privs.filter(match)
          if (!visible.length) return null
          const on = g.privs.filter((p) => selected.has(p)).length
          const state = on === 0 ? false : on === g.privs.length ? true : 'indeterminate'
          return (
            <Collapsible
              key={g.id}
              open={!!q || expanded.has(g.id)}
              onOpenChange={(o) =>
                setExpanded((prev) => {
                  const next = new Set(prev)
                  if (o) next.add(g.id)
                  else next.delete(g.id)
                  return next
                })
              }
            >
              <div className="flex items-center gap-3 px-3 py-2">
                {!readOnly && (
                  <Checkbox
                    checked={state}
                    onCheckedChange={(c) => setMany(g.privs, c === true)}
                    aria-label={`${g.label}：全选`}
                  />
                )}
                <CollapsibleTrigger className="group flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground">
                  <span className="truncate">{g.label}</span>
                  <span className="font-mono text-[11px] font-normal text-muted-foreground">{g.id}.*</span>
                  <span className="ml-auto text-xs font-normal text-muted-foreground tabular">
                    {readOnly ? g.privs.length : `${on}/${g.privs.length}`}
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <ul className="grid gap-0.5 px-3 pb-2 sm:grid-cols-2" aria-label={g.label}>
                  {visible.map((p) => (
                    <li key={p}>
                      {readOnly ? (
                        <div className="flex min-h-9 items-start gap-2 rounded-lg px-2 py-1.5">
                          <PrivText priv={p} />
                        </div>
                      ) : (
                        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.04]">
                          <Checkbox className="mt-0.5" checked={selected.has(p)} onCheckedChange={(c) => setMany([p], c === true)} aria-label={p} />
                          <PrivText priv={p} />
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )
        })}
        {groups.every((g) => !g.privs.some(match)) && <p className="px-3 py-6 text-center text-sm text-muted-foreground">{readOnly && !value.length ? '没有任何权限' : '没有匹配的权限'}</p>}
      </div>
    </div>
  )
}

function PrivText({ priv }: { priv: string }) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="truncate font-mono text-[12.5px] text-foreground">{priv}</span>
      {PRIV_HINT[priv] && <span className="truncate text-[11px] text-muted-foreground">{PRIV_HINT[priv]}</span>}
    </span>
  )
}
