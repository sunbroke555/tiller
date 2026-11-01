import { Link, useParams } from 'react-router'

import { useHaGroups } from '@/api/ha'
import { cn } from '@/lib/utils'

import { GroupsView } from './GroupsView'
import { RulesView } from './RulesView'
import { StatusView } from './StatusView'

type View = 'status' | 'rules' | 'groups'

const LABEL: Record<View, string> = { status: '状态与资源', rules: '亲和规则', groups: '旧 HA 组' }

export const haHref = (view: View) => (view === 'status' ? '/datacenter/ha' : `/datacenter/ha/${view}`)

/** /datacenter/ha/* — status and resources, affinity rules, legacy groups (only while they exist). */
export default function HaPage() {
  const first = (useParams()['*'] ?? '').split('/').filter(Boolean)[0]
  const groups = useHaGroups()
  const hasGroups = !!groups.data && !groups.data.migrated && groups.data.groups.length > 0
  const views: View[] = hasGroups || first === 'groups' ? ['status', 'rules', 'groups'] : ['status', 'rules']
  const view: View = views.includes(first as View) ? (first as View) : 'status'

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <nav aria-label="高可用" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
          {views.map((v) => (
            <li key={v}>
              <Link
                to={haHref(v)}
                aria-current={v === view ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                  v === view && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
                )}
              >
                {LABEL[v]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {view === 'status' && <StatusView />}
      {view === 'rules' && <RulesView />}
      {view === 'groups' && <GroupsView query={groups} />}
    </div>
  )
}
