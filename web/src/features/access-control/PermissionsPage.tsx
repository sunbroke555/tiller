import { Link, Navigate, Route, Routes, useParams } from 'react-router'

import { NotFoundPage } from '@/features/NotFoundPage'
import { cn } from '@/lib/utils'

import { AclView } from './AclView'
import { PoolsAdminView } from './PoolsAdminView'
import { RealmsView } from './RealmsView'
import { RolesView } from './RolesView'

const BASE = '/datacenter/permissions'

const VIEWS = [
  { id: 'acl', label: '权限' },
  { id: 'roles', label: '角色' },
  { id: 'realms', label: '认证域' },
  { id: 'pools', label: '资源池' },
] as const

export function permissionsPath(view: (typeof VIEWS)[number]['id']): string {
  return `${BASE}/${view}`
}

/** /datacenter/permissions/{acl,roles,realms,pools}: access control of the datacenter. */
export default function PermissionsPage() {
  return (
    <Routes>
      <Route index element={<Navigate to="acl" replace />} />
      <Route path=":view/*" element={<ViewSwitch />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function ViewSwitch() {
  const { view } = useParams()
  const current = VIEWS.find((v) => v.id === view)
  if (!current) return <NotFoundPage />
  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <nav aria-label="权限与认证" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <Link
                to={permissionsPath(v.id)}
                aria-current={v.id === current.id ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                  v.id === current.id && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
                )}
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {current.id === 'acl' && <AclView />}
      {current.id === 'roles' && <RolesView />}
      {current.id === 'realms' && <RealmsView />}
      {current.id === 'pools' && <PoolsAdminView />}
    </div>
  )
}
