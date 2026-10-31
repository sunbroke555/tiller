import { useSyncExternalStore } from 'react'

function mql(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = mql(query)
      mq?.addEventListener('change', cb)
      return () => mq?.removeEventListener('change', cb)
    },
    () => mql(query)?.matches ?? false,
    () => false,
  )
}

/** Matches the desktop layout breakpoint (Tailwind lg). */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')
