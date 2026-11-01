import { useState } from 'react'
import { Link } from 'react-router'
import { Ellipsis, KeyRound, Pencil, Plus, RotateCw, ShieldCheck, Trash2 } from 'lucide-react'

import { accessKeys, deleteToken, regenerateToken, useUsers, type TokenSecret } from '@/api/access-users'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Chip } from '@/features/guest-backup/ui'

import { canManageTokensOf, tokenRows, type TokenRow } from './model'
import { userPath } from './paths'
import { PermissionsDialog } from './PermissionsDialog'
import { TokenEditDialog, TokenSecretDialog } from './TokenDialogs'
import { ExpireChip, ListHeader, UserName } from './ui'
import { useAccess } from './useAccess'

/**
 * API tokens of every user (PVE.dc.TokenView), or of one user (`userid`, on
 * the user page). Add, edit, regenerate the secret, delete, show permissions.
 */
export function TokenList({ userid }: { userid?: string }) {
  const users = useUsers()
  const { self, userModify } = useAccess()
  const [editing, setEditing] = useState<{ open: boolean; token: TokenRow | null }>({ open: false, token: null })
  const [secret, setSecret] = useState<TokenSecret | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [regen, setRegen] = useState<TokenRow | null>(null)
  const [removing, setRemoving] = useState<TokenRow | null>(null)
  const [permsOf, setPermsOf] = useState<string | null>(null)

  const all = tokenRows(users.data ?? [])
  const list = userid ? all.filter((t) => t.userid === userid) : all
  const canAdd = userid ? canManageTokensOf(userid, self, userModify) : true
  const reveal = (s: TokenSecret) => {
    setSecret(s)
    setShowSecret(true)
  }

  return (
    <GlassCard flush className="overflow-hidden">
      <ListHeader
        title="API 令牌"
        subtitle={users.isPending ? '正在读取…' : list.length ? `${list.length} 个令牌` : '还没有令牌'}
        fetching={users.isFetching}
        onRefresh={userid ? undefined : () => void users.refetch()}
      >
        {canAdd && (
          <Button variant={userid ? 'outline' : 'default'} onClick={() => setEditing({ open: true, token: null })}>
            <Plus />
            新建令牌
          </Button>
        )}
      </ListHeader>
      {users.isError && !users.data ? (
        <ErrorState compact error={users.error} onRetry={() => void users.refetch()} />
      ) : users.isPending ? (
        <LoadingRows rows={2} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="没有 API 令牌"
          description="API 令牌让脚本和其他程序无需密码就能调用 PVE API，可以单独限制权限和有效期。"
        />
      ) : (
        <ul aria-label="API 令牌列表" className="divide-y divide-border/60">
          {list.map((t) => {
            const manage = canManageTokensOf(t.userid, self, userModify)
            return (
              <li key={t.id} data-testid="token-row" data-token={t.id} className="flex min-h-16 items-center gap-3 py-3 pr-2 pl-(--card-p) lg:pr-(--card-p)">
                <span
                  aria-hidden
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground paper:bg-secondary"
                >
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-mono text-sm font-medium">{t.tokenid}</span>
                    <Chip tone={t.privsep === 0 ? 'warning' : 'neutral'}>{t.privsep === 0 ? '完整用户权限' : '权限分离'}</Chip>
                    <ExpireChip expire={t.expire} />
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {!userid && (
                      <Link to={userPath(t.userid)} className="min-w-0 truncate hover:underline">
                        <UserName userid={t.userid} className="[&>span:first-child]:font-normal [&>span:first-child]:text-muted-foreground" />
                      </Link>
                    )}
                    {t.comment && (
                      <span className="min-w-0 truncate">
                        {!userid && '· '}
                        {t.comment}
                      </span>
                    )}
                  </div>
                </div>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={`令牌 ${t.id} 的操作`} className="shrink-0 text-muted-foreground pointer-coarse:size-11">
                      <Ellipsis />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    {manage && (
                      <DropdownMenuItem onSelect={() => setEditing({ open: true, token: t })} className="pointer-coarse:min-h-11">
                        <Pencil />
                        编辑…
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => setPermsOf(t.id)} className="pointer-coarse:min-h-11">
                      <ShieldCheck />
                      查看权限
                    </DropdownMenuItem>
                    {manage && (
                      <>
                        <DropdownMenuItem onSelect={() => setRegen(t)} className="pointer-coarse:min-h-11">
                          <RotateCw />
                          重新生成密钥…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(t)} className="pointer-coarse:min-h-11">
                          <Trash2 />
                          删除…
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

      <TokenEditDialog
        open={editing.open}
        token={editing.token}
        userid={userid}
        onOpenChange={(open) => setEditing((s) => ({ ...s, open }))}
        onSecret={reveal}
      />
      <TokenSecretDialog secret={secret} open={showSecret} onOpenChange={setShowSecret} />
      <PermissionsDialog userid={permsOf} open={!!permsOf} onOpenChange={(o) => !o && setPermsOf(null)} />
      <ConfirmDialog
        open={!!regen}
        onOpenChange={(o) => !o && setRegen(null)}
        title="重新生成令牌密钥？"
        description={regen && `${regen.id}：旧密钥立即失效，所有使用它的程序都会失去访问权限。`}
        confirmLabel="重新生成"
        destructive
        onConfirm={async () => {
          const t = regen!
          const res = await regenerateToken(t.userid, t.tokenid)
          reveal(res)
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="删除这个 API 令牌？"
        description={removing && `使用 ${removing.id} 的程序将无法再访问 API。`}
        confirmLabel="删除"
        destructive
        typeToConfirm={removing?.tokenid}
        onConfirm={() => {
          const t = removing!
          return runTask(deleteToken(t.userid, t.tokenid), { title: `删除令牌 ${t.id}`, syncSuccessMessage: `已删除令牌 ${t.id}`, invalidate: [accessKeys.all()] })
        }}
      />
    </GlassCard>
  )
}
