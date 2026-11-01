// A small, safe Markdown renderer for guest notes: builds React elements (no
// innerHTML), so raw HTML in notes is shown as text. Covers what notes use:
// headings, paragraphs, lists, block quotes, code, rules, emphasis, links.

import type { ReactNode } from 'react'

import { safeHref as sharedSafeHref } from '@/lib/markdown'

export type MdBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }

/** Split Markdown into blocks. */
export function parseBlocks(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: MdBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'paragraph', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*```/.test(line)) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!)
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      out.push({ kind: 'heading', level: h[1]!.length, text: h[2]! })
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush()
      out.push({ kind: 'rule' })
      continue
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const ordered = /\d/.test(li[1]!)
      const items = [li[2]!]
      while (i + 1 < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i + 1]!)
        if (!next || /\d/.test(next[1]!) !== ordered) break
        items.push(next[2]!)
        i++
      }
      out.push({ kind: 'list', ordered, items })
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const quote = [line.replace(/^\s*>\s?/, '')]
      while (i + 1 < lines.length && /^\s*>/.test(lines[i + 1]!)) quote.push(lines[++i]!.replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', text: quote.join('\n') })
      continue
    }
    para.push(line)
  }
  flush()
  return out
}

/** Only absolute http(s) and mailto links are rendered as links (checked by the shared URL-parser test). */
export function safeHref(url: string): string | null {
  const u = sharedSafeHref(url)
  return u && /^(https?:\/\/|mailto:)/i.test(u) ? u : null
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+)/g

/** Inline Markdown → React nodes. */
export function renderInline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let k = 0
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0
    if (idx > last) out.push(...withBreaks(text.slice(last, idx), `${keyBase}-t${k}`))
    const key = `${keyBase}-${k++}`
    const [token, code, strong, em, link, auto] = m
    if (code) {
      out.push(
        <code key={key} className="rounded bg-foreground/[0.07] px-1 py-0.5 font-mono text-[0.85em] paper:bg-secondary">
          {code.slice(1, -1)}
        </code>,
      )
    } else if (strong) {
      out.push(<strong key={key}>{renderInline(strong.slice(2, -2), key)}</strong>)
    } else if (em) {
      out.push(<em key={key}>{renderInline(em.slice(1, -1), key)}</em>)
    } else if (link) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(link)!
      const href = safeHref(lm[2]!)
      out.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-brand-strong underline-offset-2 hover:underline">
            {lm[1]}
          </a>
        ) : (
          <span key={key}>{lm[1]}</span>
        ),
      )
    } else if (auto) {
      out.push(
        <a key={key} href={auto} target="_blank" rel="noopener noreferrer" className="break-all text-brand-strong underline-offset-2 hover:underline">
          {auto}
        </a>,
      )
    } else {
      out.push(token)
    }
    last = idx + token.length
  }
  if (last < text.length) out.push(...withBreaks(text.slice(last), `${keyBase}-end`))
  return out
}

function withBreaks(text: string, key: string): ReactNode[] {
  const parts = text.split('\n')
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<br key={`${key}-br${i}`} />, p]))
}

const HEADING_CLASS = ['text-lg font-semibold', 'text-base font-semibold', 'text-sm font-semibold']

/** Rendered notes. */
export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source)
  return (
    <div className="grid gap-2.5 text-sm leading-relaxed break-words text-foreground/90">
      {blocks.map((b, i) => {
        const key = `b${i}`
        switch (b.kind) {
          case 'heading': {
            const Tag = `h${Math.min(b.level + 2, 6)}` as 'h3'
            return (
              <Tag key={key} className={`${HEADING_CLASS[Math.min(b.level, 3) - 1]} text-foreground paper:font-heading`}>
                {renderInline(b.text, key)}
              </Tag>
            )
          }
          case 'paragraph':
            return <p key={key}>{renderInline(b.text, key)}</p>
          case 'list': {
            const List = b.ordered ? 'ol' : 'ul'
            return (
              <List key={key} className={`grid gap-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-muted-foreground`}>
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it, `${key}-${j}`)}</li>
                ))}
              </List>
            )
          }
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-border pl-3 text-muted-foreground">
                {renderInline(b.text, key)}
              </blockquote>
            )
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto rounded-xl bg-foreground/[0.05] p-3 font-mono text-xs leading-relaxed paper:bg-secondary">
                {b.text}
              </pre>
            )
          case 'rule':
            return <hr key={key} className="border-border" />
        }
      })}
    </div>
  )
}
