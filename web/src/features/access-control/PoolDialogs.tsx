// Pool dialogs (PVE.dc.PoolEdit, PVE.pool.AddVM / AddStorage, member
// removal, delete): used by the datacenter pool list and the pool page.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'

import { createPool, deletePool, poolInvalidate, updatePool } from '@/api/access-control'
import { useClusterResources } from '@/api/queries'
import { usePool, usePools, type PoolMember } from '@/api/shell'
import { isGuest, isStorage, type GuestResource } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { ResourceIcon } from '@/components/ResourceIcon'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { StatusDot } from '@/components/StatusDot'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Notice } from '@/features/replication/ui'
import { guestName } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { childPools, poolCommentParams, poolCreateParams, poolIdError, poolMembersParams } from './logic'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ------------------------------------------------------------ create/edit

export function PoolEditDialog({ open, onOpenChange, poolid, comment: initialComment }: DialogProps & { poolid?: string; comment?: string }) {
  const isCreate = poolid === undefined
  const pools = usePools()
  const [id, setId] = useState('')
  const [comment, setComment] = useState('')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setId(poolid ?? '')
    setComment(initialComment ?? '')
    setTouched(false)
    // Reset when the dialog opens.
  }, [open])
  const idError = isCreate ? poolIdError(id, (pools.data ?? []).map((p) => p.poolid)) : null
  const changes = !isCreate ? poolCommentParams(poolid, initialComment, comment) : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isCreate ? '创建资源池' : `编辑资源池 ${poolid}`}
      description={isCreate ? '资源池把客户机和存储分组，便于统一授权。嵌套资源池用 / 分隔（最多 3 层）。' : undefined}
      submitLabel={isCreate ? '创建' : '保存'}
      submitDisabled={(touched && !!idError) || (!isCreate && !changes)}
      onSubmit={async () => {
        setTouched(true)
        if (idError) throw new Error(idError)
        if (isCreate) {
          await runTask(createPool(poolCreateParams(id, comment)), {
            title: `创建资源池 ${id.trim()}`,
            syncSuccessMessage: `已创建资源池 ${id.trim()}`,
            invalidate: poolInvalidate,
          })
        } else if (changes) {
          await runTask(updatePool(changes), { title: `修改资源池 ${poolid}`, syncSuccessMessage: `已保存资源池 ${poolid}`, invalidate: poolInvalidate })
        }
      }}
    >
      <FormField label="名称" name="poolid" required={isCreate} error={isCreate && (touched || id) ? (idError ?? undefined) : undefined} hint={isCreate ? '如 dev、dev/web' : undefined}>
        <FieldInput
          value={id}
          onChange={(e) => setId(e.target.value)}
          readOnly={!isCreate}
          className={!isCreate ? 'bg-transparent' : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={isCreate}
        />
      </FormField>
      <FormField label="说明" name="comment">
        <FieldInput value={comment} onChange={(e) => setComment(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}

// ----------------------------------------------------------------- delete

export function DeletePoolDialog({ open, onOpenChange, poolid, onDeleted }: DialogProps & { poolid: string; onDeleted?: () => void }) {
  const pool = usePool(open ? poolid : '')
  const pools = usePools()
  const members = pool.data?.members ?? []
  const children = childPools(poolid, (pools.data ?? []).map((p) => p.poolid))
  const blocked = members.length > 0 || children.length > 0

  if (open && (pool.isPending || pools.isPending)) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`删除资源池 ${poolid}？`}>
        <p className="py-6 text-center text-sm text-muted-foreground">正在检查成员…</p>
      </ResponsiveDialog>
    )
  }
  if (blocked) {
    return (
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title={`无法删除资源池 ${poolid}`}
        footer={<Button onClick={() => onOpenChange(false)}>知道了</Button>}
      >
        <div className="grid gap-3 pt-1 pb-2 text-sm">
          <p>只能删除空的资源池。请先移除：</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {members.length > 0 && <li>{members.length} 个成员（客户机或存储）</li>}
            {children.length > 0 && <li>下级资源池 {children.join('、')}</li>}
          </ul>
        </div>
      </ResponsiveDialog>
    )
  }
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={`删除资源池 ${poolid}？`}
      description="资源池是空的。设在这个资源池上的权限条目会失效。"
      confirmLabel="删除"
      typeToConfirm={poolid}
      onConfirm={async () => {
        await runTask(deletePool(poolid), { title: `删除资源池 ${poolid}`, syncSuccessMessage: `已删除资源池 ${poolid}`, invalidate: poolInvalidate })
        onDeleted?.()
      }}
    />
  )
}

// ------------------------------------------------------------ add members

function matches(q: string, ...fields: (string | number | undefined)[]): boolean {
  const s = q.trim().toLowerCase()
  return !s || fields.some((f) => f !== undefined && String(f).toLowerCase().includes(s))
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 pl-8" />
    </div>
  )
}

function CheckRow({ checked, onChange, children, label }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; label: string }) {
  return (
    <li>
      <label className={cn('flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-foreground/[0.04]', checked && 'bg-brand/[0.06] paper:bg-secondary/60')}>
        <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} aria-label={label} />
        {children}
      </label>
    </li>
  )
}

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((x) => x !== item)
}

/** Add guests (PVE.pool.AddVM): guests of other pools are moved (allow-move). */
export function AddGuestsDialog({ open, onOpenChange, poolid }: DialogProps & { poolid: string }) {
  const guests = useClusterResources({ select: (all) => all.filter(isGuest).sort((a, b) => a.vmid - b.vmid) })
  const [picked, setPicked] = useState<number[]>([])
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (open) {
      setPicked([])
      setQuery('')
    }
  }, [open])
  const candidates = (guests.data ?? []).filter((g) => g.pool !== poolid)
  const shown = candidates.filter((g) => matches(query, g.vmid, g.name, g.node, g.pool))
  const moving = candidates.filter((g) => picked.includes(g.vmid) && g.pool)

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`添加客户机到 ${poolid}`}
      description="已属于其他资源池的客户机会先从原资源池移出。"
      submitLabel={picked.length ? `添加 ${picked.length} 台` : '添加'}
      submitDisabled={picked.length === 0}
      onSubmit={() =>
        runTask(updatePool(poolMembersParams(poolid, { vms: picked }, 'add')), {
          title: `添加 ${picked.length} 台客户机到资源池 ${poolid}`,
          syncSuccessMessage: `已添加到资源池 ${poolid}`,
          invalidate: poolInvalidate,
        })
      }
    >
      <SearchBox value={query} onChange={setQuery} placeholder="搜索名称、VMID、节点" />
      <div className="overflow-hidden rounded-xl border border-input bg-(--field)">
        {candidates.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{guests.isPending ? '正在读取…' : '所有客户机都已在这个资源池里'}</p>
        ) : (
          <ul className="max-h-[min(24rem,45dvh)] divide-y divide-border/50 overflow-y-auto" aria-label="可添加的客户机">
            {shown.map((g) => (
              <GuestCheckRow key={g.vmid} guest={g} checked={picked.includes(g.vmid)} onChange={(v) => setPicked((p) => toggle(p, g.vmid, v))} />
            ))}
            {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">没有匹配的客户机</li>}
          </ul>
        )}
      </div>
      {moving.length > 0 && <Notice tone="warning">{moving.map((g) => `${g.vmid}（${g.pool}）`).join('、')} 会从原资源池移到 {poolid}。</Notice>}
    </FormDialog>
  )
}

function GuestCheckRow({ guest: g, checked, onChange }: { guest: GuestResource; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <CheckRow checked={checked} onChange={onChange} label={`${g.vmid} ${guestName(g)}`}>
      <StatusDot status={g.status} pulse={false} />
      <ResourceIcon type={g.type} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm">
          <span className="mr-1.5 font-mono text-muted-foreground tabular">{g.vmid}</span>
          {guestName(g)}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {g.node}
          {g.pool ? ` · 当前在 ${g.pool}` : ''}
        </span>
      </span>
    </CheckRow>
  )
}

/** Add storages (PVE.pool.AddStorage). */
export function AddStorageDialog({ open, onOpenChange, poolid, members }: DialogProps & { poolid: string; members: readonly PoolMember[] }) {
  const storages = useClusterResources({ select: (all) => all.filter(isStorage) })
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (open) setPicked([])
  }, [open])
  const inPool = useMemo(() => new Set(members.filter((m) => m.type === 'storage').map((m) => (m as { storage: string }).storage)), [members])
  const ids = useMemo(() => {
    const map = new Map<string, { storage: string; plugintype?: string; nodes: string[] }>()
    for (const s of storages.data ?? []) {
      const e = map.get(s.storage) ?? { storage: s.storage, plugintype: s.plugintype, nodes: [] }
      e.nodes.push(s.node)
      map.set(s.storage, e)
    }
    return [...map.values()].filter((s) => !inPool.has(s.storage)).sort((a, b) => a.storage.localeCompare(b.storage))
  }, [storages.data, inPool])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`添加存储到 ${poolid}`}
      description="资源池里的存储可以按资源池统一授权。"
      submitLabel="添加"
      submitDisabled={picked.length === 0}
      onSubmit={() =>
        runTask(updatePool(poolMembersParams(poolid, { storage: picked }, 'add')), {
          title: `添加存储 ${picked.join('、')} 到资源池 ${poolid}`,
          syncSuccessMessage: `已添加到资源池 ${poolid}`,
          invalidate: poolInvalidate,
        })
      }
    >
      <div className="overflow-hidden rounded-xl border border-input bg-(--field)">
        {ids.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">{storages.isPending ? '正在读取…' : '没有可添加的存储'}</p>
        ) : (
          <ul className="max-h-[min(24rem,45dvh)] divide-y divide-border/50 overflow-y-auto" aria-label="可添加的存储">
            {ids.map((s) => (
              <CheckRow key={s.storage} checked={picked.includes(s.storage)} onChange={(v) => setPicked((p) => toggle(p, s.storage, v))} label={s.storage}>
                <ResourceIcon type="storage" />
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-sm">{s.storage}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {s.plugintype ?? '存储'} · {s.nodes.sort().join('、')}
                  </span>
                </span>
              </CheckRow>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  )
}

// --------------------------------------------------------- remove members

export function RemoveMembersDialog({ open, onOpenChange, poolid, members }: DialogProps & { poolid: string; members: readonly PoolMember[] }) {
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (open) setPicked([])
  }, [open])
  const guests = members.filter((m): m is GuestResource & { type: 'qemu' | 'lxc' } => m.type === 'qemu' || m.type === 'lxc').sort((a, b) => a.vmid - b.vmid)
  const storages = [...new Set(members.filter((m) => m.type === 'storage').map((m) => (m as { storage: string }).storage))].sort()
  const vms = guests.filter((g) => picked.includes(`vm:${g.vmid}`)).map((g) => g.vmid)
  const stores = storages.filter((s) => picked.includes(`st:${s}`))

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`从 ${poolid} 移除成员`}
      description="只移出资源池，客户机和存储本身不受影响；通过资源池获得的权限随之失效。"
      submitLabel={picked.length ? `移除 ${picked.length} 个` : '移除'}
      destructive
      submitDisabled={picked.length === 0}
      onSubmit={() =>
        runTask(updatePool(poolMembersParams(poolid, { vms, storage: stores }, 'remove')), {
          title: `从资源池 ${poolid} 移除 ${picked.length} 个成员`,
          syncSuccessMessage: `已从资源池 ${poolid} 移除`,
          invalidate: poolInvalidate,
        })
      }
    >
      <div className="overflow-hidden rounded-xl border border-input bg-(--field)">
        {members.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">资源池是空的</p>
        ) : (
          <ul className="max-h-[min(24rem,45dvh)] divide-y divide-border/50 overflow-y-auto" aria-label="资源池成员">
            {guests.map((g) => (
              <GuestCheckRow key={g.vmid} guest={g} checked={picked.includes(`vm:${g.vmid}`)} onChange={(v) => setPicked((p) => toggle(p, `vm:${g.vmid}`, v))} />
            ))}
            {storages.map((s) => (
              <CheckRow key={s} checked={picked.includes(`st:${s}`)} onChange={(v) => setPicked((p) => toggle(p, `st:${s}`, v))} label={s}>
                <ResourceIcon type="storage" />
                <span className="truncate text-sm">{s}</span>
              </CheckRow>
            ))}
          </ul>
        )}
      </div>
    </FormDialog>
  )
}
