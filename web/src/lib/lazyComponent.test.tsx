import { Suspense, useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { lazyComponent, preloadOnIntent } from './lazyComponent'

it('shares an import without mounting the page, and renders synchronously after preloading', async () => {
  const mounted = vi.fn()
  const load = vi.fn(async () => ({ default: () => { useEffect(mounted, []); return <p>Ready</p> } }))
  const Page = lazyComponent(load)
  await Promise.all([Page.preload(), Page.preload()])
  expect(load).toHaveBeenCalledTimes(1)
  expect(mounted).not.toHaveBeenCalled()
  render(<Suspense fallback={<p>Loading</p>}><Page /></Suspense>)
  expect(screen.getByText('Ready')).toBeVisible()
  expect(screen.queryByText('Loading')).not.toBeInTheDocument()
  expect(mounted).toHaveBeenCalledTimes(1)
})

it('allows navigation to retry a failed speculative import', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ default: () => <p>Recovered</p> })
  const Page = lazyComponent(load)
  preloadOnIntent(Page)
  await act(async () => {})
  await Page.preload()
  render(<Page />)
  expect(screen.getByText('Recovered')).toBeVisible()
  expect(load).toHaveBeenCalledTimes(2)
})

it('keeps local state when an initially suspended page renders again after loading', async () => {
  function Counter({ label }: { label: string }) {
    const [count, setCount] = useState(0)
    return <button onClick={() => setCount(count + 1)}>{label}: {count}</button>
  }
  let resolve!: (module: { default: typeof Counter }) => void
  const Page = lazyComponent(() => new Promise<{ default: typeof Counter }>((done) => { resolve = done }))
  const { rerender } = render(<Suspense fallback={<p>Loading</p>}><Page label="First" /></Suspense>)
  expect(screen.getByText('Loading')).toBeVisible()
  await act(async () => { resolve({ default: Counter }) })
  fireEvent.click(screen.getByRole('button'))
  rerender(<Suspense fallback={<p>Loading</p>}><Page label="Second" /></Suspense>)
  expect(screen.getByRole('button')).toHaveTextContent('Second: 1')
})
