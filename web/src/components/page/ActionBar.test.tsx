import { fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it, vi } from 'vitest'

import { ActionBar } from './ActionBar'
import type { ActionDef } from './registry'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }))

const actions: ActionDef<null>[] = [
  { id: 'start', label: '启动', order: 1, placement: 'primary', disabled: () => '已锁定（backup）' },
  { id: 'console', label: '控制台', order: 2, placement: 'primary' },
]

describe('ActionBar dock', () => {
  it('explains a disabled action on tap instead of ignoring it', () => {
    const trigger = vi.fn()
    render(<ActionBar actions={actions} ctx={null} trigger={trigger} variant="dock" />)
    const start = screen.getByRole('button', { name: '启动' })
    expect(start).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(start)
    expect(trigger).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalledWith('暂时不能启动', { description: '已锁定（backup）' })
    fireEvent.click(screen.getByRole('button', { name: '控制台' }))
    expect(trigger).toHaveBeenCalledWith(actions[1])
  })
})
