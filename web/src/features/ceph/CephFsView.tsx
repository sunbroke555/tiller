// CephFS: file systems (create with PGs and storage, destroy with pools and
// storages) and their metadata servers (official PVE.NodeCephFSPanel,
// PVE.CephCreateFS).

import { useEffect, useState } from 'react'
import { Ellipsis, FolderTree, Plus, Trash2 } from 'lucide-react'

import { cephKeys, createCephFs, destroyCephFs, useCephFsList, useCephMds } from '@/api/ceph'
import { CheckboxField, FieldInput, FormDialog, FormField, NumberInput, SwitchField } from '@/components/form'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { CEPHFS_NAME_RE, cephFsCreateParams } from './model'
import { ServicesView } from './ServicesView'
import { Notice, RefreshButton, Section, useCephAccess } from './ui'

export function CephFsView({ apiNode }: { apiNode: string }) {
  const fs = useCephFsList(apiNode)
  const mds = useCephMds(apiNode)
  const access = useCephAccess()
  const [create, setCreate] = useState(false)
  const [destroy, setDestroy] = useState<string | null>(null)
  const [shownDestroy, setShownDestroy] = useState<string | null>(null)
  if (destroy && destroy !== shownDestroy) setShownDestroy(destroy)
  const list = fs.data ?? []
  const noMds = !!mds.data && mds.data.length === 0

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <Section
        title="CephFS"
        count={fs.data ? list.length : undefined}
        flush
        data-testid="cephfs-list"
        actions={
          <>
            <RefreshButton onClick={() => void fs.refetch()} busy={fs.isFetching} />
            {access.canModify && (
              <Button size="sm" onClick={() => setCreate(true)} disabled={noMds} title={noMds ? '先创建元数据服务器' : undefined} className="pointer-coarse:h-10">
                <Plus /> 创建 CephFS
              </Button>
            )}
          </>
        }
      >
        {fs.isPending ? (
          <LoadingRows rows={2} className="p-4" />
        ) : fs.error ? (
          <ErrorState error={fs.error} onRetry={() => void fs.refetch()} compact className="p-4" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title="还没有 CephFS"
            description={noMds ? '先在下面创建至少一个元数据服务器（MDS），再创建 CephFS。' : 'CephFS 是共享文件系统，可以存放 ISO、容器模板和备份。'}
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {list.map((f) => (
              <li key={f.name} className="flex min-h-14 items-center gap-3 px-4 py-2" data-cephfs={f.name}>
                <FolderTree className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    数据池 {f.data_pool} · 元数据池 {f.metadata_pool}
                  </div>
                </div>
                {access.canModify && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${f.name} 操作`} className="shrink-0 pointer-coarse:size-11">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onSelect={() => setDestroy(f.name)}>
                        <Trash2 /> 销毁
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ServicesView apiNode={apiNode} types={['mds']} />

      <CreateFsDialog apiNode={apiNode} existing={list.map((f) => f.name)} open={create} onOpenChange={setCreate} />
      <DestroyFsDialog apiNode={apiNode} name={shownDestroy} open={!!destroy} onOpenChange={(o) => !o && setDestroy(null)} />
    </div>
  )
}

function CreateFsDialog({ apiNode, existing, open, onOpenChange }: { apiNode: string; existing: string[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const access = useCephAccess()
  const [name, setName] = useState('cephfs')
  const [pgNum, setPgNum] = useState<number | null>(128)
  const [addStorage, setAddStorage] = useState(true)
  useEffect(() => {
    if (open) {
      setName(existing.includes('cephfs') ? '' : 'cephfs')
      setPgNum(128)
      setAddStorage(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  const n = name.trim()
  const error = !n ? null : !CEPHFS_NAME_RE.test(n) ? '只能包含字母、数字和 - _ .' : existing.includes(n) ? '已有同名 CephFS' : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="创建 CephFS"
      description={`同时创建数据池 ${n || '<名称>'}_data 和元数据池 ${n || '<名称>'}_metadata。`}
      submitLabel="创建"
      submitDisabled={!n || !!error || !pgNum}
      onSubmit={() =>
        runTask(createCephFs(apiNode, n, cephFsCreateParams({ pgNum: pgNum ?? 128, addStorage: addStorage && access.canAddStorage })), {
          title: `创建 CephFS ${n}`,
          invalidate: [cephKeys.all(), ['pve', 'cluster', 'resources']],
        })
      }
    >
      <FormField label="名称" name="name" required error={error ?? undefined}>
        <FieldInput value={name} onChange={(e) => setName(e.target.value)} autoCapitalize="off" spellCheck={false} />
      </FormField>
      <FormField label="PG 数" name="pg_num" hint="数据池的 PG 数；元数据池使用它的四分之一">
        <NumberInput value={pgNum} onChange={(v) => setPgNum(v ?? null)} min={8} max={32768} aria-label="PG 数" />
      </FormField>
      <SwitchField
        label="添加为存储"
        description={access.canAddStorage ? '同时添加同名的 CephFS 存储（ISO、模板、备份等）。' : '没有权限（需要 /storage 上的 Datastore.Allocate）。'}
        checked={addStorage && access.canAddStorage}
        onCheckedChange={setAddStorage}
        disabled={!access.canAddStorage}
      />
    </FormDialog>
  )
}

function DestroyFsDialog({ apiNode, name, open, onOpenChange }: { apiNode: string; name: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [removePools, setRemovePools] = useState(true)
  const [removeStorages, setRemoveStorages] = useState(true)
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) {
      setRemovePools(true)
      setRemoveStorages(true)
      setTyped('')
    }
  }, [open])
  if (!name) return null
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`销毁 CephFS ${name}`}
      description="文件系统中的所有数据都会丢失。仍在使用它的已启用存储会阻止销毁。"
      destructive
      submitLabel="销毁"
      submitDisabled={typed !== name}
      onSubmit={() =>
        runTask(destroyCephFs(apiNode, name, { 'remove-pools': removePools ? 1 : 0, 'remove-storages': removeStorages ? 1 : 0 }), {
          title: `销毁 CephFS ${name}`,
          invalidate: [cephKeys.all(), ['pve', 'cluster', 'resources']],
        })
      }
    >
      <CheckboxField label="删除存储" description="删除由 pveceph 管理、指向这个 CephFS 的存储配置。" checked={removeStorages} onCheckedChange={setRemoveStorages} />
      <CheckboxField label="删除存储池" description="同时删除数据池和元数据池。" checked={removePools} onCheckedChange={setRemovePools} />
      {!removeStorages && <Notice tone="warn">保留存储时，需要先在存储配置里停用它，否则无法销毁。</Notice>}
      <FormField label={`输入 ${name} 以确认`} required>
        <FieldInput value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="off" autoComplete="off" spellCheck={false} aria-label="确认名称" />
      </FormField>
    </FormDialog>
  )
}
