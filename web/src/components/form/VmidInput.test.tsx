import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { VmidInput } from './VmidInput'

let releaseSuggestion: () => void = () => {}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const vmid = new URL(url, 'http://x').searchParams.get('vmid')
      // The suggestion (no ?vmid) answers late; availability checks at once.
      if (!vmid) await new Promise<void>((r) => (releaseSuggestion = r))
      return new Response(JSON.stringify({ data: vmid ?? '102' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function Field({ onChange }: { onChange: (v: number | undefined) => void }) {
  const [value, setValue] = useState<number | undefined>()
  return (
    <label>
      VM ID
      <VmidInput
        value={value}
        onChange={(v) => {
          setValue(v)
          onChange(v)
        }}
      />
    </label>
  )
}

it('a late suggestion does not replace an id typed meanwhile', async () => {
  const onChange = vi.fn()
  render(<Field onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '3825' } })
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(3825))
  releaseSuggestion()
  await new Promise((r) => setTimeout(r, 20))
  expect(onChange).not.toHaveBeenCalledWith(102)
  expect(screen.getByRole('textbox')).toHaveValue('3825')
})

it('fills the suggestion into an empty field', async () => {
  const onChange = vi.fn()
  render(<Field onChange={onChange} />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  releaseSuggestion()
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(102))
})
