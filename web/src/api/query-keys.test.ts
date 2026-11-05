import { describe, expect, it } from 'vitest'

import { backupKeys } from './guest-backup'
import { guestCoreKeys } from './guest-core'
import { nodeKeys } from './node-summary'
import { queryKeys } from './queries'

describe('guest config query keys', () => {
  it('keeps the running config (current=1) apart from the pending-applied one', () => {
    const current = backupKeys.guestConfig('pve', 'qemu', 101)
    const pending = guestCoreKeys.config('pve', 'qemu', 101)
    expect(current).not.toEqual(pending)
    expect(current.slice(0, pending.length)).toEqual([...pending])
  })
})

it('shares node history between overview and detail without mixing aggregation or time ranges', () => {
  expect(queryKeys.nodeRrd('pve', 'hour')).toEqual(nodeKeys.rrd('pve', 'hour', 'AVERAGE'))
  expect(nodeKeys.rrd('pve', 'hour', 'MAX')).not.toEqual(queryKeys.nodeRrd('pve', 'hour'))
  expect(nodeKeys.rrd('pve', 'day', 'AVERAGE')).not.toEqual(queryKeys.nodeRrd('pve', 'hour'))
  expect(nodeKeys.rrd('other', 'hour', 'AVERAGE')).not.toEqual(queryKeys.nodeRrd('pve', 'hour'))
})
