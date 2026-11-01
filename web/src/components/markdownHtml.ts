import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// Markdown → sanitised HTML string, the way the official UI renders notes
// (marked GFM with line breaks, DOMPurify, links in a new tab). The app's
// <Markdown> component (./Markdown.tsx) renders notes as a React tree and
// shows raw HTML as text instead; this string renderer is kept for places
// that need HTML output (e.g. a print/export view).

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
