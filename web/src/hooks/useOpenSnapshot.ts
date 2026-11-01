import { useState } from 'react'

/**
 * `value` as it was when `open` last turned true (or at mount while open).
 * Config editors diff against this snapshot and send its digest, like the
 * official UI: a change someone else saves while the dialog is open makes PVE
 * answer "checksum mismatch" instead of being silently undone by a 5 s poll.
 * A snapshot taken before the data arrived (undefined) is filled in once.
 */
export function useOpenSnapshot<T>(open: boolean, value: T): T {
  const [snap, setSnap] = useState(value)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSnap(value)
      return value
    }
  }
  if (open && snap === undefined && value !== undefined) {
    setSnap(value)
    return value
  }
  return open ? snap : value
}
