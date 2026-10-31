// Guest lifecycle actions (area guest-lifecycle): migrate, clone, convert to
// template, delete, protection, HA. Order range 400–499.
// Node bulk actions (start/stop/suspend/migrate all) go in nodeBulkActions,
// order range 300–399 on the node page.
// Registered in features/guest/registry.ts and features/node/registry.ts.

import type { GuestActionDef } from '@/features/guest/types'
import type { NodeActionDef } from '@/features/node/types'

export const guestLifecycleActions: GuestActionDef[] = []

export const nodeBulkActions: NodeActionDef[] = []
