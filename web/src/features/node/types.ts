// Contracts for the node detail page; see registry.ts.

import type { NavigateFunction } from 'react-router'

import type { NodeResource } from '@/api/types'
import type { ActionDef, TabDef } from '@/components/page/registry'

/** Props every node tab component receives. */
export interface NodeTabProps {
  node: string
  /** Live entry from /cluster/resources (status, cpu, mem, uptime…). */
  resource: NodeResource
}

export interface NodeActionContext extends NodeTabProps {
  navigate: NavigateFunction
}

export type NodeTabDef = TabDef<NodeTabProps>
export type NodeActionDef = ActionDef<NodeActionContext>
