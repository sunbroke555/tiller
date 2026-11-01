// Authentication realms (PVE.dc.AuthView) and their sync jobs.

import { useMemo, useState } from 'react'
import { BookUser, Building2, ChevronDown, Ellipsis, Globe, KeyRound, Pencil, Plus, RefreshCcw, Server, ShieldCheck, Star, Trash2 } from 'lucide-react'

import { deleteRealm, realmInvalidate, updateRealm, useRealms, type RealmInfo } from '@/api/access-control'
import { usePermissions } from '@/api/permissions'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/QueryState'
import { fireTask, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { ADDABLE_REALM_TYPES, realmIsAddable, realmSupportsSync, realmTypeLabel, tfaLabel } from './logic'
import { RealmDialog } from './RealmDialog'
import { SyncDialog } from './SyncDialog'
import { SyncJobsSection, useCanSyncRealm } from './SyncJobs'
import { ListCard, ListSkeleton, Pill } from './ui'

type Dialog =
  | { kind: 'create'; type: string }
  | { kind: 'edit' | 'sync' | 'delete'; realm: RealmInfo }
  | null

const TYPE_ICON: Record<string, typeof Server> = {
  pam: Server,
  pve: ShieldCheck,
  ldap: BookUser,
  ad: Building2,
  openid: Globe,
}

export function RealmsView() {
  const realms = useRealms()
  const perms = usePermissions()
  const canEdit = perms.can({ privs: 'Realm.Allocate', path: '/access/realm' })
  const canSync = useCanSyncRealm()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [last, setLast] = useState<Dialog>(null)
  if (dialog && dialog !== last) setLast(dialog)
  const close = (o: boolean) => {
    if (!o) setDialog((d) => (d === last ? null : d))
  }

  const list = useMemo(() => [...(realms.data ?? [])].sort((a, b) => a.realm.localeCompare(b.realm)), [realms.data])

  return (
    <div className="grid gap-(--section-gap)">
      <ListCard
        title="认证域"
        summary={realms.isPending ? '正在读取…' : `${list.length} 个认证域`}
        onRefresh={() => void realms.refetch()}
        refreshing={realms.isFetching}
        actions={
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button disabled={!canEdit} title={canEdit ? undefined : '需要 /access/realm 上的 Realm.Allocate'}>
                <Plus />
                添加
                <ChevronDown className="opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {ADDABLE_REALM_TYPES.map((t) => {
                const Icon = TYPE_ICON[t] ?? KeyRound
                return (
                  <DropdownMenuItem key={t} onSelect={() => setDialog({ kind: 'create', type: t })}>
                    <Icon />
                    {t === 'ad' ? 'Active Directory 服务器' : t === 'ldap' ? 'LDAP 服务器' : 'OpenID Connect 服务器'}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {realms.isPending ? (
          <ListSkeleton />
        ) : realms.isError ? (
          <ErrorState error={realms.error} onRetry={() => void realms.refetch()} compact />
        ) : list.length === 0 ? (
          <EmptyState icon={KeyRound} title="没有认证域" />
        ) : (
          <ul className="divide-y divide-border/60" aria-label="认证域列表">
            {list.map((r) => {
              const Icon = TYPE_ICON[r.type] ?? KeyRound
              const tfa = tfaLabel(r.tfa)
              const syncable = realmSupportsSync(r.type)
              const allowedSync = syncable && canSync(r.realm)
              return (
                <li
                  key={r.realm}
                  className="flex items-center gap-1 pr-2 transition-colors hover:bg-foreground/[0.03] lg:pr-(--card-p) paper:hover:bg-secondary/50"
                  data-testid="realm-row"
                  data-realm={r.realm}
                >
                  <button
                    type="button"
                    onClick={() => setDialog({ kind: 'edit', realm: r })}
                    disabled={!canEdit}
                    aria-label={`编辑认证域 ${r.realm}`}
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-(--card-p) text-left disabled:cursor-default"
                  >
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-foreground">{r.realm}</span>
                        <span className="text-xs text-muted-foreground">{realmTypeLabel(r.type)}</span>
                        {r.default ? (
                          <Pill tone="brand">
                            <Star />
                            默认
                          </Pill>
                        ) : null}
                        {tfa && (
                          <Pill tone="info" title="要求两步验证">
                            <KeyRound />
                            {tfa}
                          </Pill>
                        )}
                      </span>
                      {r.comment && <span className="truncate text-xs text-muted-foreground">{r.comment}</span>}
                    </span>
                  </button>
                  {syncable && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn('shrink-0 text-muted-foreground max-sm:size-11 max-sm:px-0')}
                      disabled={!allowedSync}
                      onClick={() => setDialog({ kind: 'sync', realm: r })}
                      aria-label={`同步 ${r.realm}`}
                      title="立即同步"
                    >
                      <RefreshCcw />
                      <span className="max-sm:sr-only">同步</span>
                    </Button>
                  )}
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`${r.realm} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem disabled={!canEdit} onSelect={() => setDialog({ kind: 'edit', realm: r })}>
                        <Pencil />
                        编辑
                      </DropdownMenuItem>
                      {syncable && (
                        <DropdownMenuItem disabled={!allowedSync} onSelect={() => setDialog({ kind: 'sync', realm: r })}>
                          <RefreshCcw />
                          立即同步
                        </DropdownMenuItem>
                      )}
                      {!r.default && (
                        <DropdownMenuItem
                          disabled={!canEdit}
                          onSelect={() =>
                            fireTask(updateRealm(r.realm, { default: 1 }), {
                              title: `设 ${r.realm} 为默认认证域`,
                              syncSuccessMessage: `${r.realm} 已设为默认认证域`,
                              invalidate: realmInvalidate,
                            })
                          }
                        >
                          <Star />
                          设为默认
                        </DropdownMenuItem>
                      )}
                      {realmIsAddable(r.type) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" disabled={!canEdit} onSelect={() => setDialog({ kind: 'delete', realm: r })}>
                            <Trash2 />
                            删除
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
      </ListCard>

      <SyncJobsSection />

      {last?.kind === 'create' && <RealmDialog open={dialog === last} onOpenChange={close} type={last.type} />}
      {last?.kind === 'edit' && <RealmDialog open={dialog === last} onOpenChange={close} type={last.realm.type} realm={last.realm.realm} />}
      {last?.kind === 'sync' && <SyncDialog open={dialog === last} onOpenChange={close} realm={last.realm.realm} />}
      {last?.kind === 'delete' && (
        <ConfirmDialog
          open={dialog === last}
          onOpenChange={close}
          destructive
          title={`删除认证域 ${last.realm.realm}？`}
          description="这个认证域的用户将无法登录。用户条目和它们的权限保留，需要时手动删除。"
          confirmLabel="删除"
          typeToConfirm={last.realm.realm}
          onConfirm={() =>
            runTask(deleteRealm(last.realm.realm), {
              title: `删除认证域 ${last.realm.realm}`,
              syncSuccessMessage: `已删除认证域 ${last.realm.realm}`,
              invalidate: realmInvalidate,
            })
          }
        />
      )}
    </div>
  )
}
