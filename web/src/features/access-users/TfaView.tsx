import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, ShieldCheck } from 'lucide-react'

import { accessKeys, useAllTfa, useUsers } from '@/api/access-users'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { Button } from '@/components/ui/button'

import { TfaAddDialog } from './TfaDialogs'
import { TfaUserCard } from './TfaUserCard'
import { ListHeader } from './ui'
import { useAccess } from './useAccess'
import { useUserActions } from './useUserActions'

/** /datacenter/users/tfa — every user's second factors (Proxmox.panel.TfaView). */
export function TfaView() {
  const tfa = useAllTfa()
  const users = useUsers()
  const { self, userModify } = useAccess()
  const actions = useUserActions()
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState<{ open: boolean; user?: string }>({ open: false })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: accessKeys.all() })

  const list = [...(tfa.data ?? [])].filter((u) => u.entries.length > 0).sort((a, b) => a.userid.localeCompare(b.userid))
  const entryCount = list.reduce((n, u) => n + u.entries.length, 0)
  const targets = userModify ? (users.data ?? []).map((u) => u.userid).sort() : [self]
  const hasRecovery = (userid: string) => !!tfa.data?.find((u) => u.userid === userid)?.entries.some((e) => e.type === 'recovery')
  const canManage = (userid: string) => userModify || userid === self

  return (
    <div className="grid gap-3">
      <GlassCard flush className="overflow-hidden">
        <ListHeader
          title="两步验证"
          subtitle={tfa.isPending ? '正在读取…' : list.length ? `${list.length} 个用户 · ${entryCount} 个条目` : '还没有用户开启两步验证'}
          fetching={tfa.isFetching}
          onRefresh={() => void tfa.refetch()}
        >
          <Button onClick={() => setAdding({ open: true })}>
            <Plus />
            添加
          </Button>
        </ListHeader>
        {tfa.isError && !tfa.data ? (
          <ErrorState compact error={tfa.error} onRetry={() => void tfa.refetch()} />
        ) : tfa.isPending ? (
          <LoadingRows rows={2} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title="没有两步验证条目"
            description="给用户添加验证器 App、安全密钥或恢复码后，登录时除了密码还需要第二个因素。"
          />
        ) : null}
      </GlassCard>
      {list.map((u) => (
        <TfaUserCard
          key={u.userid}
          user={u}
          linkUser
          canManage={canManage(u.userid)}
          canUnlock={userModify}
          onAdd={() => setAdding({ open: true, user: u.userid })}
          onUnlock={() => actions.unlock(u.userid)}
          onChanged={refresh}
        />
      ))}
      <TfaAddDialog
        users={targets}
        fixedUser={adding.user}
        hasRecovery={hasRecovery}
        open={adding.open}
        onOpenChange={(open) => setAdding((s) => ({ ...s, open }))}
        onDone={refresh}
      />
      {actions.host}
    </div>
  )
}
