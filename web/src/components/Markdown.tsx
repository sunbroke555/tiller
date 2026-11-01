import { Fragment, useMemo, type ReactNode } from 'react'

import { parseMarkdown, type Block, type Inline } from '@/lib/markdown'
import { cn } from '@/lib/utils'

/**
 * Renders notes / consent Markdown safely: the text is parsed into a tree
 * and rendered as React elements, so raw HTML in it is shown as text.
 * External links open in a new tab without referrer.
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  return <div className={cn('markdown text-sm leading-relaxed text-foreground/90', className)}>{renderBlocks(blocks)}</div>
}

function renderBlocks(blocks: Block[]): ReactNode {
  return blocks.map((b, i) => <Fragment key={i}>{renderBlock(b)}</Fragment>)
}

const HEADING_CLASS: Record<number, string> = {
  1: 'heading mt-5 mb-2 text-xl font-semibold first:mt-0',
  2: 'heading mt-5 mb-2 text-lg font-semibold first:mt-0',
  3: 'heading mt-4 mb-1.5 text-base font-semibold first:mt-0',
  4: 'mt-4 mb-1 text-sm font-semibold first:mt-0',
  5: 'mt-3 mb-1 text-sm font-medium first:mt-0',
  6: 'mt-3 mb-1 text-xs font-medium text-muted-foreground uppercase first:mt-0',
}

function renderBlock(b: Block): ReactNode {
  switch (b.t) {
    case 'h': {
      const Tag = `h${Math.min(b.level + 1, 6)}` as 'h2'
      return <Tag className={HEADING_CLASS[b.level]}>{renderInline(b.c)}</Tag>
    }
    case 'p':
      return <p className="my-2 first:mt-0 last:mb-0">{renderInline(b.c)}</p>
    case 'code':
      return (
        <pre className="my-3 overflow-x-auto rounded-xl bg-foreground/[0.05] px-3.5 py-3 font-mono text-[12.5px] leading-relaxed ring-1 ring-border ring-inset paper:bg-secondary">
          <code>{b.v}</code>
        </pre>
      )
    case 'quote':
      return <blockquote className="my-3 border-l-2 border-brand/50 pl-3.5 text-muted-foreground">{renderBlocks(b.c)}</blockquote>
    case 'hr':
      return <hr className="my-4 border-border" />
    case 'list': {
      const items = b.items.map((item, i) => (
        <li key={i} className={cn('pl-1', item.checked !== null && 'list-none -ml-5 flex gap-2')}>
          {item.checked !== null && (
            <input type="checkbox" checked={item.checked} readOnly disabled className="mt-1 size-3.5 accent-(--brand)" aria-label={item.checked ? '已完成' : '未完成'} />
          )}
          <div className="min-w-0 [&>p]:my-0.5">{renderBlocks(item.c)}</div>
        </li>
      ))
      return b.ordered ? (
        <ol start={b.start} className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
          {items}
        </ol>
      ) : (
        <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{items}</ul>
      )
    }
    case 'table':
      return (
        <div className="my-3 overflow-x-auto rounded-xl ring-1 ring-border ring-inset">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-foreground/[0.03] paper:bg-secondary/60">
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} className="px-3 py-2 font-medium" style={{ textAlign: b.align[i] ?? undefined }}>
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {b.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i} className="px-3 py-2 align-top" style={{ textAlign: b.align[i] ?? undefined }}>
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>
      case 'br':
        return <br key={i} />
      case 'code':
        return (
          <code key={i} className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 font-mono text-[0.9em] paper:bg-secondary">
            {n.v}
          </code>
        )
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-foreground">
            {renderInline(n.c)}
          </strong>
        )
      case 'em':
        return <em key={i}>{renderInline(n.c)}</em>
      case 'del':
        return (
          <del key={i} className="text-muted-foreground">
            {renderInline(n.c)}
          </del>
        )
      case 'link': {
        const external = /^(https?:|mailto:)/i.test(n.href)
        return (
          <a
            key={i}
            href={n.href}
            className="text-brand-strong underline decoration-brand/40 underline-offset-2 hover:decoration-brand"
            {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
          >
            {renderInline(n.c)}
          </a>
        )
      }
    }
  })
}
