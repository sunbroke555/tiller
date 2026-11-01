import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown, parseBlocks, safeHref } from './markdown'

describe('parseBlocks', () => {
  it('splits headings, lists, code, quotes and paragraphs', () => {
    const blocks = parseBlocks('# Title\n\nline one\nline two\n\n- a\n- b\n1. x\n\n> quote\n\n```\ncode\n```\n---')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'quote', 'code', 'rule'])
    expect(blocks[1]).toEqual({ kind: 'paragraph', text: 'line one\nline two' })
    expect(blocks[2]).toEqual({ kind: 'list', ordered: false, items: ['a', 'b'] })
    expect(blocks[3]).toEqual({ kind: 'list', ordered: true, items: ['x'] })
  })
})

describe('safeHref', () => {
  it('allows only http(s) and mailto', () => {
    expect(safeHref('https://pve.example')).toBe('https://pve.example')
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeHref('javascript:alert(1)')).toBeNull()
  })
})

describe('Markdown', () => {
  it('renders emphasis, code and safe links, and shows HTML as text', () => {
    render(<Markdown source={'**bold** and *em* `code` [docs](https://pve.proxmox.com) [x](javascript:alert(1)) <b>raw</b>'} />)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    expect(screen.getByText('em').tagName).toBe('EM')
    expect(screen.getByText('code').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://pve.proxmox.com')
    expect(screen.queryByRole('link', { name: 'x' })).toBeNull()
    expect(screen.getByText(/<b>raw<\/b>/)).toBeInTheDocument()
  })
})
