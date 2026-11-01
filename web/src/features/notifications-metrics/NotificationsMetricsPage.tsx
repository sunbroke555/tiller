// /datacenter/notifications/* — notification targets, matchers and external
// metric servers (one sub-page each: targets, matchers, metrics).

import { Navigate, useParams } from 'react-router'

import { MatchersView } from './MatchersView'
import { MetricsView } from './MetricsView'
import { TargetsView } from './TargetsView'
import { NM_VIEWS, SubNav, nmHref, type NmView } from './ui'

export default function NotificationsMetricsPage() {
  const first = (useParams()['*'] ?? '').split('/').filter(Boolean)[0]
  if (!first || !NM_VIEWS.includes(first as NmView)) return <Navigate to={nmHref('targets')} replace />
  const view = first as NmView

  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <SubNav view={view} />
      {view === 'targets' && <TargetsView />}
      {view === 'matchers' && <MatchersView />}
      {view === 'metrics' && <MetricsView />}
    </div>
  )
}
