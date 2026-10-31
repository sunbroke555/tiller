import { useSyncExternalStore } from 'react'

import { getSession, subscribeSession, type Session } from './session'

/** The current login session; re-renders on login, logout and renewal. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribeSession, getSession, () => null)
}
