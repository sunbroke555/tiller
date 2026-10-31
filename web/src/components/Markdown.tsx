import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'

import { cn } from '@/lib/utils'

// Notes (node, guest, pool, datacenter) are Markdown, rendered like the
// official UI: GFM with line breaks, HTML sanitised, links in a new tab.

const marked = new Marked({ gfm: true, breaks: true, async: false })

let hooked = false
function ensureHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

/** Markdown → sanitised HTML string. */
export function renderMarkdown(src: string): string {
  ensureHooks()
  const html = marked.parse(src) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button'] })
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(source), [source])
  return (
    <div
      className={cn(
        'min-w-0 text-sm leading-relaxed break-words text-foreground/90',
        '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-medium',
        '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_a]:text-brand [&_a]:underline-offset-2 hover:[&_a]:underline',
        '[&_code]:rounded [&_code]:bg-foreground/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] paper:[&_code]:bg-secondary',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-foreground/[0.05] [&_pre]:p-3 paper:[&_pre]:bg-secondary [&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_hr]:my-4 [&_hr]:border-border [&_img]:max-w-full [&_img]:rounded-md',
        '[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
