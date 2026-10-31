import { useMemo } from 'react'

import { type ConsoleTarget } from '@/api/console'
import type { NodeTabProps } from '@/features/node/types'

import { ConsoleScreen } from './ConsoleScreen'

/** Node page "Shell" tab: embedded xterm.js shell (termproxy), noVNC or SPICE. */
export default function NodeShellTab({ node }: NodeTabProps) {
  const target = useMemo<ConsoleTarget>(() => ({ kind: 'node', node }), [node])
  return <ConsoleScreen key={node} target={target} variant="embedded" title={node} />
}
