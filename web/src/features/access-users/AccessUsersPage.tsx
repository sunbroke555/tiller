import { Route, Routes } from 'react-router'

import { NotFoundPage } from '@/features/NotFoundPage'

import { GroupDetail } from './GroupDetail'
import { GroupsView } from './GroupsView'
import { TfaView } from './TfaView'
import { TokenList } from './TokenList'
import { SubNav } from './ui'
import { UserDetail } from './UserDetail'
import { UsersView } from './UsersView'

/** Datacenter section "用户与令牌" (/datacenter/users/*): users, groups, API tokens, TFA. */
export default function AccessUsersPage() {
  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <SubNav />
      <Routes>
        <Route index element={<UsersView />} />
        <Route path="user/:userid" element={<UserDetail />} />
        <Route path="groups" element={<GroupsView />} />
        <Route path="groups/:groupid" element={<GroupDetail />} />
        <Route path="tokens" element={<TokenList />} />
        <Route path="tfa" element={<TfaView />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  )
}
