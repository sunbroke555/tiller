import { Route, Routes } from 'react-router'

import { NotFoundPage } from '@/features/NotFoundPage'

import { JobDetail } from './JobDetail'
import { JobList } from './JobList'

/** Datacenter section "备份计划" (/datacenter/backup/*): job list and job detail. */
export default function BackupJobsPage() {
  return (
    <Routes>
      <Route index element={<JobList />} />
      <Route path=":id" element={<JobDetail />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
