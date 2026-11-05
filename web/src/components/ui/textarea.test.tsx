import { createRef, useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FieldTextarea, FormField } from '@/components/form/Field'

import { Textarea } from './textarea'

describe('shared multiline editor', () => {
  it('gives ordinary form textareas line numbers and a whitespace toggle', () => {
    const ref = createRef<HTMLTextAreaElement>()
    const { container } = render(
      <FormField label="备注" hint="支持 Markdown">
        <FieldTextarea ref={ref} value={'# 标题\n\n正文  内容\t'} readOnly />
      </FormField>,
    )
    const input = screen.getByRole('textbox', { name: '备注' })
    expect(ref.current).toBe(input)
    expect(input).toHaveAccessibleDescription('支持 Markdown')
    expect(input).toHaveAttribute('wrap', 'soft')
    expect(container.querySelector('[data-slot="line-numbers"]')!.textContent).toBe('1\n2\n3')
    const toggle = screen.getByRole('button', { name: '显示空白字符' })
    expect(toggle).toHaveAttribute('aria-controls', input.id)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('[data-slot="whitespace-markers"]')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(container.querySelectorAll('[data-whitespace="space"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-whitespace="tab"]')).toHaveLength(1)
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(container.querySelector('[data-slot="whitespace-markers"]')).toBeNull()
    expect(input).toHaveValue('# 标题\n\n正文  内容\t')
  })

  it('preserves controlled changes and ref-based template insertion', () => {
    const ref = createRef<HTMLTextAreaElement>()
    function Editor() {
      const [text, setText] = useState('prefix suffix')
      return <form><Textarea ref={ref} name="notes" aria-label="备份备注" value={text} onChange={(e) => setText(e.target.value)} /></form>
    }
    const { container } = render(<Editor />)
    const input = ref.current!
    input.setSelectionRange(7, 7)
    const updated = input.value.slice(0, input.selectionStart) + '{{guestname}}' + input.value.slice(input.selectionEnd)
    fireEvent.change(input, { target: { value: updated } })
    expect(input).toHaveValue('prefix {{guestname}}suffix')
    expect(new FormData(container.querySelector('form')!).get('notes')).toBe(updated)
  })

  it('supports uncontrolled input and preserves native textarea options', () => {
    const { container } = render(<Textarea aria-label="配置" defaultValue="one" wrap="off" spellCheck autoCapitalize="characters" rows={4} />)
    const input = screen.getByRole('textbox', { name: '配置' })
    expect(input).toHaveAttribute('wrap', 'off')
    expect(input).toHaveAttribute('spellcheck', 'true')
    expect(input).toHaveAttribute('autocapitalize', 'characters')
    expect(input).toHaveAttribute('rows', '4')
    fireEvent.change(input, { target: { value: 'one\ntwo\n' } })
    expect(input).toHaveValue('one\ntwo\n')
    expect(container.querySelector('[data-slot="line-numbers"]')!.textContent).toBe('1\n2\n3')
  })
})
