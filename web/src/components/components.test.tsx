import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { filterGuests } from '@/features/overview/filter'

import { ConfirmDialog } from './ConfirmDialog'
import { buildPaths } from './Sparkline'
import { statusTone } from './StatusDot'
import { UsageBar, usageTone } from './UsageBar'

describe('ConfirmDialog', () => {
  it('requires typing the name before confirming', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="删除 VM 100"
        destructive
        confirmLabel="删除"
        typeToConfirm="100"
        onConfirm={onConfirm}
      />,
    )
    const button = screen.getByRole('button', { name: '删除' })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '10' } })
    expect(button).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '100' } })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce())
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('stays open when the action fails', async () => {
    const onOpenChange = vi.fn()
    render(
      <ConfirmDialog open onOpenChange={onOpenChange} title="停止" onConfirm={() => Promise.reject(new Error('boom'))} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '确认' })).toBeEnabled())
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })
})

describe('small helpers', () => {
  it('maps statuses to tones', () => {
    expect(statusTone('running')).toBe('ok')
    expect(statusTone('online')).toBe('ok')
    expect(statusTone('stopped')).toBe('off')
    expect(statusTone('paused')).toBe('warn')
    expect(statusTone('offline')).toBe('bad')
    expect(statusTone(undefined)).toBe('unknown')
  })

  it('colours usage by threshold', () => {
    expect(usageTone(0.5)).toBe('normal')
    expect(usageTone(0.8)).toBe('high')
    expect(usageTone(0.95)).toBe('critical')
  })

  it('renders an accessible meter', () => {
    render(<UsageBar label="内存" value={0.456} detail="1 / 2 GiB" />)
    const meter = screen.getByRole('meter', { name: '内存' })
    expect(meter).toHaveAttribute('aria-valuenow', '46')
    expect(screen.getByText(/46%/)).toBeInTheDocument()
  })

  it('builds sparkline paths with gaps', () => {
    expect(buildPaths([1], 0).line).toBe('')
    const { line, area } = buildPaths([0, 1, null, 0.5, 0.5], 0, 1)
    expect(line.match(/M/g)).toHaveLength(2)
    expect(area.match(/Z/g)).toHaveLength(2)
  })

  it('filters guests', () => {
    const guests = [{ status: 'running' }, { status: 'stopped' }, { status: 'paused' }]
    expect(filterGuests(guests, 'all')).toHaveLength(3)
    expect(filterGuests(guests, 'running')).toHaveLength(1)
    expect(filterGuests(guests, 'stopped')).toHaveLength(2)
  })
})
