// The firewall of one scope: a view switcher (规则 / 安全组 / 别名 / IPSet /
// 选项 / 日志) and the selected view. Mounted by the datacenter section and
// the node and guest tabs (and usable for an SDN VNet).

import { Link } from 'react-router'
import { Lock, ShieldOff } from 'lucide-react'

import { useFirewallOptions, type FirewallScope } from '@/api/firewall'
import { cn } from '@/lib/utils'

import { useFirewallAccess } from './access'
import { AliasesView } from './AliasesView'
import { GroupsView } from './GroupsView'
import { IpsetsView } from './IpsetsView'
import { LogView } from './LogView'
import { VIEW_LABEL, optionValue, scopeFeatures, type FirewallView } from './model'
import type { FirewallNav } from './nav'
import { OptionsView } from './OptionsView'
import { RulesView } from './RulesView'

export interface FirewallPanelProps {
  scope: FirewallScope
  nav: FirewallNav
  /** Guest pool (permission check on /pool/<id>). */
  pool?: string | undefined
}

export function FirewallPanel({ scope, nav, pool }: FirewallPanelProps) {
  const access = useFirewallAccess(scope, pool)
  const features = scopeFeatures(scope)
  const views = features.views.filter((v) => v !== 'log' || access.canLog)
  const view: FirewallView = views.includes(nav.view) ? nav.view : 'rules'

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <div className="grid gap-3">
        <nav aria-label="防火墙" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
            {views.map((v) => (
              <li key={v}>
                <Link
                  to={nav.href(v)}
                  aria-current={v === view ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                    v === view && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
                  )}
                >
                  {VIEW_LABEL[v]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <StatusNote scope={scope} access={access} nav={nav} view={view} />
      </div>

      {view === 'rules' && <RulesView scope={scope} canEdit={access.canEdit} />}
      {view === 'groups' && <GroupsView canEdit={access.canEdit} nav={nav} />}
      {view === 'aliases' && <AliasesView scope={scope} canEdit={access.canEdit} />}
      {view === 'ipset' && <IpsetsView scope={scope} canEdit={access.canEdit} nav={nav} />}
      {view === 'options' && <OptionsView scope={scope} canEdit={access.canEdit} />}
      {view === 'log' && <LogView scope={scope} />}
    </div>
  )
}

const DC = { kind: 'dc' } as const

/** "防火墙未启用" for this scope or for the whole datacenter; read-only note. */
function StatusNote({
  scope,
  access,
  nav,
  view,
}: {
  scope: FirewallScope
  access: ReturnType<typeof useFirewallAccess>
  nav: FirewallNav
  view: FirewallView
}) {
  const own = useFirewallOptions(scope, { enabled: scope.kind !== 'group' })
  const dc = useFirewallOptions(DC, { enabled: scope.kind !== 'dc' && access.canAuditDc, retry: false })
  const ownDefault = scope.kind === 'node' ? '1' : '0'
  const ownOn = own.data ? (optionValue(own.data, 'enable') ?? ownDefault) !== '0' : true
  const dcOn = scope.kind === 'dc' ? ownOn : dc.data ? (optionValue(dc.data, 'enable') ?? '0') !== '0' : true

  const notes: { text: string; link?: boolean }[] = []
  if (!ownOn) {
    notes.push({
      text: scope.kind === 'dc' ? '数据中心防火墙未启用：所有规则都不生效。' : scope.kind === 'node' ? '节点防火墙已关闭。' : '这一层的防火墙未启用：规则不生效。',
      link: true,
    })
  }
  if (scope.kind !== 'dc' && !dcOn) notes.push({ text: '数据中心防火墙未启用，这里的规则暂不生效。' })

  return (
    <>
      {notes.map((n) => (
        <p
          key={n.text}
          role="status"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border/70 bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
        >
          <ShieldOff className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.link && view !== 'options' && (
            <Link to={nav.href('options')} className="text-brand-strong underline-offset-2 hover:underline">
              去选项启用
            </Link>
          )}
        </p>
      ))}
      {!access.canEdit && (
        <p role="note" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden />
          只读：你没有修改这里防火墙的权限。
        </p>
      )}
    </>
  )
}
