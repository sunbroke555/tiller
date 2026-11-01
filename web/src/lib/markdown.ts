// A small Markdown parser for notes (datacenter, node, guest, pool) and the
// login consent text. It produces a tree that components/Markdown.tsx renders
// as React elements, so no HTML from the notes ever reaches the DOM (the
// official UI sanitises HTML; we simply never interpret it).
//
// Supported: ATX headings, paragraphs with hard breaks, emphasis (* _ ** __
// ~~), inline code, fenced and indented code blocks, block quotes, ordered
// and unordered lists (nested by indentation, task boxes), horizontal rules,
// GFM tables, links and autolinks (http, https, mailto and relative only).

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' }

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: { checked: boolean | null; c: Block[] }[] }
  | { t: 'hr' }
  | { t: 'table'; align: ('left' | 'center' | 'right' | null)[]; head: Inline[][]; rows: Inline[][][] }

/** Only these URL schemes become links; everything else stays text. */
export function safeHref(href: string): string | null {
  const h = href.trim()
  if (h.startsWith('//')) return null // protocol-relative: another host
  if (/^(https?:|mailto:)/i.test(h)) return h
  if (/^[/#?]/.test(h) && !h.startsWith('//')) return h
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null // javascript:, data:, …
  return h ? h : null
}

// ---------------------------------------------------------------- inline

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', v: text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    const rest = src.slice(i)

    if (ch === '\\' && i + 1 < src.length) {
      if (src[i + 1] === '\n') {
        flush()
        out.push({ t: 'br' })
        i += 2
        continue
      }
      if (ESCAPABLE.test(src[i + 1]!)) {
        text += src[i + 1]
        i += 2
        continue
      }
    }
    if (ch === '\n') {
      // Two trailing spaces = hard break; otherwise a soft break (space).
      if (text.endsWith('  ')) {
        text = text.replace(/ +$/, '')
        flush()
        out.push({ t: 'br' })
      } else {
        text = text.replace(/ +$/, '') + ' '
      }
      i++
      continue
    }
    if (ch === '`') {
      const m = /^(`+)([\s\S]*?[^`])\1(?!`)/.exec(rest)
      if (m) {
        flush()
        out.push({ t: 'code', v: m[2]!.replace(/^ (.*) $/, '$1') })
        i += m[0].length
        continue
      }
    }
    if (ch === '<') {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest)
      if (m) {
        flush()
        out.push({ t: 'link', href: m[1]!, c: [{ t: 'text', v: m[1]!.replace(/^mailto:/i, '') }] })
        i += m[0].length
        continue
      }
    }
    if (ch === '[') {
      const m = /^\[((?:\\.|[^\]\\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(rest)
      if (m) {
        const href = safeHref(m[2]!)
        flush()
        const label = parseInline(m[1]!)
        if (href) out.push({ t: 'link', href, c: label })
        else out.push(...label)
        i += m[0].length
        continue
      }
    }
    if ((ch === 'h' || ch === 'w') && /[\s(]$|^$/.test(text.slice(-1))) {
      const m = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;"')\]!?*_~]/.exec(rest)
      if (m) {
        flush()
        const href = m[0].startsWith('www.') ? `https://${m[0]}` : m[0]
        out.push({ t: 'link', href, c: [{ t: 'text', v: m[0] }] })
        i += m[0].length
        continue
      }
    }
    if (ch === '~' && rest.startsWith('~~')) {
      const end = rest.indexOf('~~', 2)
      if (end > 2) {
        flush()
        out.push({ t: 'del', c: parseInline(rest.slice(2, end)) })
        i += end + 2
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      const double = rest.startsWith(ch + ch)
      const marker = double ? ch + ch : ch
      // Intra-word underscores (snake_case) are not emphasis.
      const prev = i > 0 ? src[i - 1]! : ' '
      const opensOk = !/\s/.test(rest[marker.length] ?? ' ') && !(ch === '_' && /\w/.test(prev))
      if (opensOk) {
        const end = findClose(rest, marker, ch)
        if (end > marker.length) {
          flush()
          out.push({ t: double ? 'strong' : 'em', c: parseInline(rest.slice(marker.length, end)) })
          i += end + marker.length
          continue
        }
      }
    }
    text += ch
    i++
  }
  flush()
  return out
}

function findClose(rest: string, marker: string, ch: string): number {
  let j = marker.length
  while (j < rest.length) {
    if (rest[j] === '\\') {
      j += 2
      continue
    }
    if (rest[j] === '`') {
      const close = rest.indexOf('`', j + 1)
      if (close > 0) {
        j = close + 1
        continue
      }
    }
    if (rest.startsWith(marker, j) && !/\s/.test(rest[j - 1]!)) {
      const after = rest[j + marker.length] ?? ' '
      // Single marker followed by another marker belongs to a longer run.
      if (marker.length === 1 && after === ch) {
        j += 2
        continue
      }
      if (ch === '_' && /\w/.test(after)) {
        j++
        continue
      }
      return j
    }
    j++
  }
  return -1
}

// ---------------------------------------------------------------- blocks

const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)/
const BULLET = /^( {0,3})([-*+])(\s+)(.*)$/
const ORDERED = /^( {0,3})(\d{1,9})([.)])(\s+)(.*)$/
const QUOTE = /^ {0,3}> ?(.*)$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

function isBlockStart(line: string): boolean {
  return HR.test(line) || HEADING.test(line) || FENCE.test(line) || BULLET.test(line) || ORDERED.test(line) || QUOTE.test(line)
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')
  return parseBlocks(lines)
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    let m: RegExpExecArray | null

    if ((m = FENCE.exec(line))) {
      const fence = m[1]!
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence)) body.push(lines[i++]!)
      i++ // closing fence (or EOF)
      out.push({ t: 'code', lang: m[2] ?? '', v: body.join('\n') })
      continue
    }
    if (/^ {4}/.test(line)) {
      const body: string[] = []
      while (i < lines.length && (/^ {4}/.test(lines[i]!) || !lines[i]!.trim())) body.push(lines[i++]!.slice(4))
      while (body.length && !body[body.length - 1]!.trim()) body.pop()
      out.push({ t: 'code', lang: '', v: body.join('\n') })
      continue
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if ((m = HEADING.exec(line))) {
      out.push({ t: 'h', level: m[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline(m[2] ?? '') })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && lines[i]!.trim() && (QUOTE.test(lines[i]!) || !isBlockStart(lines[i]!))) {
        const q = QUOTE.exec(lines[i]!)
        body.push(q ? q[1]! : lines[i]!)
        i++
      }
      out.push({ t: 'quote', c: parseBlocks(body) })
      continue
    }
    if (BULLET.test(line) || ORDERED.test(line)) {
      const [block, next] = parseList(lines, i)
      out.push(block)
      i = next
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!) && lines[i + 1]!.includes('-')) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]!).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null,
      )
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) {
        const cells = splitRow(lines[i]!)
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')))
        i++
      }
      out.push({ t: 'table', align, head: head.map(parseInline), rows })
      continue
    }
    // Paragraph (setext headings become headings).
    const body: string[] = []
    while (i < lines.length && lines[i]!.trim() && !(body.length && isBlockStart(lines[i]!))) {
      if (body.length && /^ {0,3}(=+|-+)\s*$/.test(lines[i]!)) {
        const level = lines[i]!.trim().startsWith('=') ? 1 : 2
        out.push({ t: 'h', level, c: parseInline(body.join('\n')) })
        body.length = 0
        i++
        break
      }
      body.push(lines[i]!.replace(/^ {0,3}/, ''))
      i++
    }
    if (body.length) out.push({ t: 'p', c: parseInline(body.join('\n')) })
  }
  return out
}

function parseList(lines: string[], start: number): [Block, number] {
  const first = lines[start]!
  const ordered = ORDERED.test(first)
  const startNo = ordered ? Number(ORDERED.exec(first)![2]) : 1
  const items: { checked: boolean | null; c: Block[] }[] = []
  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    const m = ordered ? ORDERED.exec(line) : BULLET.exec(line)
    if (!m) break
    const indent = m[1]!.length
    const markerWidth = ordered ? m[2]!.length + 1 : 1
    const content = ordered ? m[5]! : m[4]!
    const contentIndent = indent + markerWidth + (ordered ? m[4]! : m[3]!).length
    const body: string[] = [content]
    i++
    let sawBlank = false
    while (i < lines.length) {
      const l = lines[i]!
      if (!l.trim()) {
        sawBlank = true
        body.push('')
        i++
        continue
      }
      const lead = l.length - l.trimStart().length
      if (lead >= Math.min(contentIndent, indent + 2)) {
        body.push(l.slice(Math.min(lead, contentIndent)))
        sawBlank = false
        i++
        continue
      }
      // Lazy continuation of the paragraph.
      if (!sawBlank && !isBlockStart(l)) {
        body.push(l.trim())
        i++
        continue
      }
      break
    }
    while (body.length && !body[body.length - 1]!.trim()) body.pop()
    let checked: boolean | null = null
    const task = /^\[([ xX])\]\s+/.exec(body[0] ?? '')
    if (task) {
      checked = task[1] !== ' '
      body[0] = body[0]!.slice(task[0].length)
    }
    items.push({ checked, c: parseBlocks(body) })
    // A blank line followed by something that is not the next item ends the list.
    if (i < lines.length && !(ordered ? ORDERED : BULLET).test(lines[i]!)) break
  }
  return [{ t: 'list', ordered, start: startNo, items }, i]
}

/** Plain text of inline nodes (for titles, aria labels and tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes.map((n) => (n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? '\n' : inlineText(n.c))).join('')
}
