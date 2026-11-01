import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LxcConfigApi } from '@/features/lxc-config/shared'
import { useDialogConfig } from '@/features/lxc-config/shared'

import { useOpenSnapshot } from './useOpenSnapshot'

describe('useOpenSnapshot', () => {
  it('keeps the value from when the dialog opened until it opens again', () => {
    const { result, rerender } = renderHook(({ open, value }) => useOpenSnapshot(open, value), {
      initialProps: { open: false, value: 'a' },
    })
    expect(result.current).toBe('a')
    rerender({ open: true, value: 'b' })
    expect(result.current).toBe('b')
    // The 5 s poll brings a newer config: the dialog keeps its snapshot.
    rerender({ open: true, value: 'c' })
    expect(result.current).toBe('b')
    rerender({ open: false, value: 'c' })
    rerender({ open: true, value: 'd' })
    expect(result.current).toBe('d')
  })

  it('fills a snapshot taken before the data arrived', () => {
    const { result, rerender } = renderHook(({ value }) => useOpenSnapshot(true, value), {
      initialProps: { value: undefined as string | undefined },
    })
    expect(result.current).toBeUndefined()
    rerender({ value: 'x' })
    expect(result.current).toBe('x')
    rerender({ value: 'y' })
    expect(result.current).toBe('x')
  })
})

describe('useDialogConfig (lxc)', () => {
  const api = (digest: string, swap: string) => {
    const config = { digest, current: { swap }, effective: { memory: '512', swap }, changes: [] }
    return { config, cfg: config.effective, save: vi.fn().mockResolvedValue(true) } as unknown as LxcConfigApi
  }

  it('saves against the config and digest the dialog opened with', async () => {
    const first = api('d1', '512')
    const { result, rerender } = renderHook(({ open, live }) => useDialogConfig(live, open), {
      initialProps: { open: true, live: first },
    })
    // Someone else sets swap=0; the poll delivers it with a new digest.
    const second = api('d2', '0')
    rerender({ open: true, live: second })
    expect(result.current.cfg.swap).toBe('512')
    await result.current.save({ memory: 1024, swap: 512 }, 'mem')
    expect(second.save).toHaveBeenCalledWith({ memory: 1024, swap: 512 }, 'mem', {
      cfg: { memory: '512', swap: '512' },
      digest: 'd1',
    })
  })
})
