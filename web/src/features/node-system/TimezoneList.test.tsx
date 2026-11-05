import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { TimezoneList } from './TimezoneList'
import { TIMEZONES } from './timezones'

function Picker({ zones = TIMEZONES }: { zones?: readonly string[] }) {
  const [value, setValue] = useState('Asia/Shanghai')
  return <TimezoneList zones={zones} value={value} onValueChange={setValue} />
}

describe('windowed timezone choices', () => {
  it('shows the current timezone without mounting the entire list', () => {
    render(<Picker />)
    expect(screen.getByRole('radio', { name: 'Asia/Shanghai' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Asia/Shanghai' })).toHaveTextContent('UTC+08:00')
    expect(screen.getAllByRole('radio').length).toBeLessThan(20)
  })
  it('keeps keyboard navigation and focus working across unmounted rows', () => {
    render(<Picker />)
    const current = screen.getByRole('radio', { name: 'Asia/Shanghai' })
    current.focus()
    fireEvent.keyDown(current, { key: 'End' })
    const last = screen.getByRole('radio', { name: TIMEZONES.at(-1)! })
    expect(last).toHaveFocus()
    expect(last).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(last, { key: 'ArrowDown' })
    const first = screen.getByRole('radio', { name: TIMEZONES[0]! })
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-checked', 'true')
  })
  it('resets scrolling when search narrows the choices and restores selection when cleared', () => {
    const { rerender } = render(<Picker />)
    rerender(<Picker zones={['Asia/Tokyo']} />)
    expect(screen.getAllByRole('radio')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'Asia/Tokyo' })).toHaveAttribute('tabindex', '0')
    fireEvent.click(screen.getByRole('radio', { name: 'Asia/Tokyo' }))
    rerender(<Picker />)
    expect(screen.getByRole('radio', { name: 'Asia/Tokyo' })).toHaveAttribute('aria-checked', 'true')
  })
  it('preserves access to the end of the list and an empty search result', () => {
    const { rerender } = render(<Picker />)
    fireEvent.scroll(screen.getByRole('radiogroup'), { target: { scrollTop: (TIMEZONES.length - 4) * 56 } })
    expect(screen.getByRole('radio', { name: TIMEZONES.at(-1)! })).toBeVisible()
    rerender(<Picker zones={[]} />)
    expect(screen.getByText('没有匹配的时区')).toBeVisible()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })
})
