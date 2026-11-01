import { describe, expect, it } from 'vitest'

import { backupKeys } from './guest-backup'
import { guestCoreKeys } from './guest-core'

describe('guest config query keys', () => {
  it('keeps the running config (current=1) apart from the pending-applied one', () => {
    const current = backupKeys.guestConfig('pve', 'qemu', 101)
    const pending = guestCoreKeys.config('pve', 'qemu', 101)
    expect(current).not.toEqual(pending)
    expect(current.slice(0, pending.length)).toEqual([...pending])
  })
})
