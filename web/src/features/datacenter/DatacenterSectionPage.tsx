import { useParams } from 'react-router'

import { usePermissions } from '@/api/permissions'
import { PageHeader } from '@/components/PageHeader'
import { TabPanel } from '@/components/page/RegistryTabs'
import { NotFoundPage } from '@/features/NotFoundPage'

import { datacenterSections } from './registry'

/** /datacenter/:section/* — header plus the section's own component (see registry.ts). */
export default function DatacenterSectionPage() {
  const { section } = useParams()
  const perms = usePermissions()
  const def = datacenterSections.find((s) => s.id === section)

  if (!def || (def.permission && !perms.can(def.permission))) return <NotFoundPage />

  return (
    <>
      <PageHeader title={def.title} eyebrow="数据中心" backTo="/datacenter" />
      <TabPanel tab={def} props={{}} />
    </>
  )
}
