import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

import { returnFocusIfLost } from './focus'

/** A row menu like the config rows: non-modal, its item saves in place. */
function RowMenu({ onSelect }: { onSelect: () => void }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger>更多操作</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onSelect}>断开链路</DropdownMenuItem>
        <DropdownMenuItem>删除</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const tick = () => act(() => new Promise((r) => setTimeout(r, 20)))

describe('returnFocusIfLost', () => {
  it('lets Radix return focus when it was lost with the overlay', () => {
    const event = new Event('focusScope.autoFocusOnUnmount', { cancelable: true })
    ;(document.activeElement as HTMLElement | null)?.blur()
    returnFocusIfLost()(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps focus that something else already took', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    const event = new Event('focusScope.autoFocusOnUnmount', { cancelable: true })
    const handler = vi.fn()
    returnFocusIfLost(handler)(event)
    expect(handler).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    input.remove()
  })

  it('a row menu reopened right after picking an item stays open', async () => {
    const onSelect = vi.fn()
    render(<RowMenu onSelect={onSelect} />)
    const trigger = screen.getByRole('button', { name: '更多操作' })

    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '断开链路' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()

    // Reopen before Radix's deferred "focus the trigger" of the first close ran.
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    await tick()
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument()

    // Closing normally still returns focus to the trigger.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await tick()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})
