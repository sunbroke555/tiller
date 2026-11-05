import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { RrdChart } from './RrdChart'

beforeEach(() => {
  // jsdom has no layout; give the real chart a measurable container.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 320, 176))
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

const props = {
  title: '内存压力（PSI）',
  unit: 'percent' as const,
  timeframe: 'hour' as const,
  series: [
    { key: 'pressurememorysome', label: 'Some' },
    { key: 'pressurememoryfull', label: 'Full' },
  ],
  emptyMessage: '所选时间范围内没有 PSI 采样',
  zeroMessage: '采样值均为 0%，未记录到内存压力',
}

const zeroSamples = [
  { time: 1793473440, pressurememorysome: 0, pressurememoryfull: 0 },
  { time: 1793473500, pressurememorysome: 0, pressurememoryfull: 0 },
]

it('shows zero pressure as recorded data, retaining both readouts and the graph', () => {
  const { container } = render(<RrdChart {...props} data={zeroSamples} />)
  expect(screen.getByText(props.zeroMessage)).toBeVisible()
  expect(within(screen.getByRole('list', { name: '图例' })).getAllByText('0%')).toHaveLength(2)
  expect(container.querySelector('.recharts-surface')).toBeInTheDocument()
  expect(screen.queryByText(props.emptyMessage)).not.toBeInTheDocument()
})

it('explains missing PSI samples without treating them as zero pressure', () => {
  render(<RrdChart {...props} data={[{ time: 1793473440 }]} />)
  expect(screen.getByText(props.emptyMessage)).toBeVisible()
  expect(screen.queryByText(props.zeroMessage)).not.toBeInTheDocument()
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
})

it('keeps a nonzero history visible even when the latest sample is zero', () => {
  const { container } = render(<RrdChart {...props} data={[
    { ...zeroSamples[0]!, pressurememorysome: 0.5 },
    zeroSamples[1]!,
  ]} />)
  expect(container.querySelector('.recharts-surface')).toBeInTheDocument()
  expect(screen.queryByText(props.zeroMessage)).not.toBeInTheDocument()
  expect(screen.queryByText(props.emptyMessage)).not.toBeInTheDocument()
})

it('shows request errors instead of a zero-pressure annotation over stale data', () => {
  render(<RrdChart {...props} data={zeroSamples} error="无法加载图表" />)
  expect(screen.getByText('无法加载图表')).toBeVisible()
  expect(screen.queryByText(props.zeroMessage)).not.toBeInTheDocument()
})
