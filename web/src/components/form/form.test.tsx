import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PveApiError } from '@/api/client'

import { FieldInput, FormDialog, FormField, NumberInput, SizeInput, SwitchField } from './index'

// Desktop layout: ResponsiveDialog renders a Radix Dialog (vaul needs a real browser).
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('min-width: 1024px'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
})
afterEach(() => vi.unstubAllGlobals())

function NameDialog({ onSubmit, onOpenChange }: { onSubmit: () => Promise<unknown>; onOpenChange: (o: boolean) => void }) {
  const [name, setName] = useState('web')
  return (
    <FormDialog open onOpenChange={onOpenChange} title="重命名" onSubmit={onSubmit}>
      <FormField label="名称" name="name" hint="只能包含字母、数字和连字符">
        <FieldInput value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
    </FormDialog>
  )
}

describe('FormDialog', () => {
  it('shows API field errors under the matching field and stays open', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn().mockRejectedValue(
      new PveApiError({
        status: 400,
        message: 'Parameter verification failed.',
        errors: { name: 'invalid format - value does not look like a valid DNS name' },
        method: 'PUT',
        path: '/x',
      }),
    )
    render(<NameDialog onSubmit={onSubmit} onOpenChange={onOpenChange} />)
    const input = screen.getByLabelText('名称')
    expect(input).toHaveAccessibleDescription('只能包含字母、数字和连字符')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText(/does not look like a valid DNS name/)).toBeInTheDocument())
    expect(screen.getByText('Parameter verification failed.')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('submits with Enter and closes on success', async () => {
    const onOpenChange = vi.fn()
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<NameDialog onSubmit={onSubmit} onOpenChange={onOpenChange} />)
    fireEvent.submit(screen.getByLabelText('名称').closest('form')!)
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onSubmit).toHaveBeenCalledOnce()
  })
})

describe('NumberInput', () => {
  it('keeps typed text, reports numbers and clamps on blur', () => {
    const onChange = vi.fn()
    function Wrapper() {
      const [v, setV] = useState<number | undefined>(4)
      return (
        <NumberInput
          aria-label="核心"
          value={v}
          min={1}
          max={8}
          onChange={(n) => {
            onChange(n)
            setV(n)
          }}
        />
      )
    }
    render(<Wrapper />)
    const input = screen.getByLabelText('核心')
    fireEvent.change(input, { target: { value: '12' } })
    expect(onChange).toHaveBeenLastCalledWith(12)
    fireEvent.blur(input)
    expect(onChange).toHaveBeenLastCalledWith(8)
    expect(input).toHaveValue('8')
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(input).toHaveValue('8')
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

describe('SizeInput', () => {
  it('shows MiB values in the best unit and converts back', () => {
    const onChange = vi.fn()
    render(<SizeInput aria-label="内存" value={4096} onChange={onChange} />)
    const input = screen.getByLabelText('内存')
    expect(input).toHaveValue('4')
    expect(screen.getByRole('combobox', { name: '单位' })).toHaveTextContent('GiB')
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).toHaveBeenLastCalledWith(1536)
  })
})

describe('SwitchField', () => {
  it('toggles from anywhere on the row', () => {
    const onChange = vi.fn()
    render(<SwitchField label="开机自启" description="节点启动后自动启动" checked={false} onCheckedChange={onChange} />)
    fireEvent.click(screen.getByText('开机自启'))
    expect(onChange).toHaveBeenCalledWith(true)
    expect(screen.getByRole('switch', { name: '开机自启' })).toHaveAccessibleDescription('节点启动后自动启动')
  })
})
