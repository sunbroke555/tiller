import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './Markdown'

describe('renderMarkdown', () => {
  it('renders GFM with line breaks', () => {
    const html = renderMarkdown('# 机房\n\n- a\n- b\n\nline1\nline2')
    expect(html).toContain('<h1>机房</h1>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('line1<br>line2')
  })

  it('strips scripts and event handlers, opens links in a new tab', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)">\n\n[x](https://example.com) [j](javascript:alert(1)) <a href="javascript:alert(2)">k</a>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })
})
