import type { ReactNode } from 'react'

import { ComingSoon } from '@/components/ComingSoon'

/**
 * Body of a pre-registered tab or page whose area has not landed yet.
 * Each area replaces its placeholder file with the real component.
 */
export function AreaPlaceholder({ area, children }: { area: string; children?: ReactNode }) {
  return (
    <ComingSoon title="开发中">
      {children}
      <span className="mt-1 block text-xs text-faint">{area}</span>
    </ComingSoon>
  )
}
