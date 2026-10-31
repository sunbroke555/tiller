import { useMemo } from 'react'

import { targetKey, type ConsoleTarget } from '@/api/console'
import type { GuestTabProps } from '@/features/guest/types'
import { guestName } from '@/lib/resources'

import { ConsoleScreen } from './ConsoleScreen'

/** Guest page "控制台" tab: embedded noVNC / xterm.js console. */
export default function GuestConsoleTab({ node, type, vmid, guest }: GuestTabProps) {
  const target = useMemo<ConsoleTarget>(() => ({ kind: type, node, vmid }), [type, node, vmid])
  return <ConsoleScreen key={targetKey(target)} target={target} variant="embedded" title={guestName(guest)} />
}
