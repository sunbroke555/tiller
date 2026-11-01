import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Markdown } from '@/components/Markdown'

import { externalHref, inlineText, parseInline, parseMarkdown, safeHref } from './markdown'

describe('markdown parser', () => {
  it('parses blocks', () => {
    const blocks = parseMarkdown(['# 标题', '', '段落 **粗体** 和 `code`', '', '- a', '- [x] b', '', '1. one', '2. two', '', '---', '> quote', '', '```sh', 'echo hi', '```'].join('\n'))
    expect(blocks.map((b) => b.t)).toEqual(['h', 'p', 'list', 'list', 'hr', 'quote', 'code'])
    const list = blocks[2] as Extract<(typeof blocks)[number], { t: 'list' }>
    expect(list.items.map((i) => i.checked)).toEqual([null, true])
    expect(blocks[6]).toEqual({ t: 'code', lang: 'sh', v: 'echo hi' })
  })

  it('parses tables', () => {
    const [t] = parseMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |')
    expect(t).toMatchObject({ t: 'table', align: ['left', 'right'] })
  })

  it('parses inline emphasis, links and autolinks', () => {
    const nodes = parseInline('see **bold _it_** and [doc](https://pve.proxmox.com) or https://x.io/a. snake_case_name')
    expect(nodes.map((n) => n.t)).toEqual(['text', 'strong', 'text', 'link', 'text', 'link', 'text'])
    expect(inlineText(nodes)).toBe('see bold it and doc or https://x.io/a. snake_case_name')
  })

  it('never links dangerous schemes', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('//evil.com')).toBeNull()
    expect(safeHref('/nodes')).toBe('/nodes')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    // The URL parser drops leading C0 controls and reads \ as /.
    expect(safeHref('\u0001javascript:alert(1)')).toBeNull()
    expect(safeHref('\tjavascript:alert(1)')).toBeNull()
    expect(safeHref('java\nscript:alert(1)')).toBeNull()
    expect(safeHref('/\\evil.com')).toBeNull()
    expect(safeHref('notes.html#x')).toBe('notes.html#x')
    expect(safeHref('#top')).toBe('#top')
    expect(externalHref('https://pve.proxmox.com/wiki')).toBe('https://pve.proxmox.com/wiki')
    expect(externalHref('javascript:alert(1)')).toBeNull()
    expect(externalHref('/local')).toBeNull()
    expect(externalHref(undefined)).toBeNull()
    expect(parseInline('[x](javascript:alert(1))').some((n) => n.t === 'link')).toBe(false)
  })
})

describe('<Markdown>', () => {
  it('renders HTML in notes as text, never as markup', () => {
    const { container } = render(<Markdown source={'<img src=x onerror="alert(1)"> **hi**\n\n<script>bad()</script>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">')
    expect(screen.getByText('hi').tagName).toBe('STRONG')
  })

  it('opens external links safely', () => {
    render(<Markdown source="[官网](https://www.proxmox.com)" />)
    const a = screen.getByRole('link', { name: '官网' })
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noreferrer noopener')
  })
})
