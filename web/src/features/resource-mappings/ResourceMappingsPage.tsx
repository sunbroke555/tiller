import { Link, Navigate, Route, Routes, useParams } from 'react-router'

import { NotFoundPage } from '@/features/NotFoundPage'
import { cn } from '@/lib/utils'

import { CpuModelsView } from './CpuModelsView'
import { MappingsView } from './MappingsView'

export const MAPPINGS_BASE = '/datacenter/mappings'

const VIEWS = [
  { id: 'pci', label: 'PCI 设备' },
  { id: 'usb', label: 'USB 设备' },
  { id: 'dir', label: '目录' },
  { id: 'cpu', label: 'CPU 型号' },
] as const

type ViewId = (typeof VIEWS)[number]['id']

/** Datacenter section "资源映射" (/datacenter/mappings/{pci,usb,dir,cpu}). */
export default function ResourceMappingsPage() {
  return (
    <Routes>
      <Route index element={<Navigate to="pci" replace />} />
      <Route path=":view" element={<MappingsSection />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

function MappingsSection() {
  const view = useParams().view as ViewId
  if (!VIEWS.some((v) => v.id === view)) return <NotFoundPage />
  return (
    <div className="grid min-w-0 gap-(--section-gap)">
      <nav aria-label="资源映射" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
        <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <Link
                to={`${MAPPINGS_BASE}/${v.id}`}
                aria-current={v.id === view ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                  v.id === view && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
                )}
              >
                {v.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {view === 'cpu' ? <CpuModelsView /> : <MappingsView key={view} kind={view} />}
    </div>
  )
}
