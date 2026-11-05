import { createRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FieldCodeTextarea, FormField } from '@/components/form/Field'

import { CodeTextarea } from './CodeTextarea'

describe('CodeTextarea', () => {
  it('numbers empty lines and updates after typing, pasting and clearing text', () => {
    function Editor() {
      const [value, setValue] = useState('')
      return <CodeTextarea aria-label="文件内容" value={value} onChange={(e) => setValue(e.target.value)} />
    }
    const { container } = render(<Editor />)
    const input = screen.getByRole('textbox', { name: '文件内容' })
    const numbers = () => container.querySelector('[data-slot="line-numbers"]')!.textContent
    expect(numbers()).toBe('1')
    fireEvent.change(input, { target: { value: '127.0.0.1 localhost\n\n::1 localhost\n' } })
    expect(numbers()).toBe('1\n2\n3\n4')
    fireEvent.change(input, { target: { value: '127.0.0.1 localhost' } })
    expect(numbers()).toBe('1')
    fireEvent.change(input, { target: { value: '' } })
    expect(numbers()).toBe('1')
  })

  it('accepts externally replaced text and keeps line numbers out of form data', () => {
    const ref = createRef<HTMLTextAreaElement>()
    const { container, rerender } = render(
      <form><CodeTextarea ref={ref} name="data" aria-label="配置" value="old" readOnly /></form>,
    )
    const text = '127.0.0.1 localhost\r\n\r\n::1 localhost\r\n'
    rerender(<form><CodeTextarea ref={ref} name="data" aria-label="配置" value={text} readOnly /></form>)
    expect(ref.current).toBe(screen.getByRole('textbox', { name: '配置' }))
    expect(container.querySelector('[data-slot="line-numbers"]')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('[data-slot="line-numbers"]')!.textContent).toBe('1\n2\n3\n4')
    expect(new FormData(container.querySelector('form')!).get('data')).toBe(text.replaceAll('\r\n', '\n'))
  })

  it('preserves the form label, validation description and disabled state', () => {
    render(
      <FormField label="文件内容" hint="每行一个条目" error="请检查格式" disabled>
        <FieldCodeTextarea value="invalid" readOnly />
      </FormField>,
    )
    const input = screen.getByRole('textbox', { name: '文件内容' })
    expect(input).toHaveAccessibleDescription('每行一个条目 请检查格式')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toBeDisabled()
  })

  it('distinguishes spaces and tabs without changing text, selection or submitted data', () => {
    const text = '127.0.0.1  localhost\talias \n# 中文\t说明'
    const { container, rerender } = render(<form><CodeTextarea name="data" aria-label="配置" value={text} readOnly /></form>)
    const input = screen.getByRole('textbox', { name: '配置' }) as HTMLTextAreaElement
    input.setSelectionRange(2, 8)
    expect(container.querySelector('[data-slot="whitespace-markers"]')).toBeNull()

    rerender(<form><CodeTextarea name="data" aria-label="配置" value={text} readOnly showWhitespace /></form>)
    const mirror = container.querySelector('[data-slot="whitespace-markers"]')!
    expect(mirror).toHaveAttribute('aria-hidden', 'true')
    expect(mirror.textContent).toBe(text)
    expect(mirror.querySelectorAll('[data-whitespace="space"]')).toHaveLength(4)
    expect(mirror.querySelectorAll('[data-whitespace="tab"]')).toHaveLength(2)
    expect(screen.getByRole('textbox', { name: '配置' })).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8])
    expect(new FormData(container.querySelector('form')!).get('data')).toBe(text)

    rerender(<form><CodeTextarea name="data" aria-label="配置" value={text} readOnly /></form>)
    expect(container.querySelector('[data-slot="whitespace-markers"]')).toBeNull()
    expect(input).toHaveValue(text)
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8])
  })

  it('updates whitespace markers on edits and normalizes only the mirrored line endings', () => {
    const { container, rerender } = render(<CodeTextarea aria-label="配置" value={'a \t\r\nb  \r'} readOnly showWhitespace />)
    const mirror = () => container.querySelector('[data-slot="whitespace-markers"]')!
    expect(mirror().textContent).toBe('a \t\nb  \n')
    rerender(<CodeTextarea aria-label="配置" value="no-spaces" readOnly showWhitespace />)
    expect(mirror().querySelectorAll('[data-whitespace]')).toHaveLength(0)
    rerender(<CodeTextarea aria-label="配置" value="" readOnly showWhitespace />)
    expect(mirror().textContent).toBe('')
  })
})
