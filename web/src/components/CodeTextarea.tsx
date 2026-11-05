import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react'

import { cn } from '@/lib/utils'

type CodeTextareaProps = Omit<ComponentProps<'textarea'>, 'value' | 'defaultValue'> & {
  value: string
  showWhitespace?: boolean
}

/** Plain-text editor with one number per logical line, including when long lines wrap. */
export function CodeTextarea({ value, wrap = 'off', showWhitespace = false, className, ref, onScroll, disabled, ...props }: CodeTextareaProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const numbers = useRef<HTMLPreElement>(null)
  const whitespaceViewport = useRef<HTMLDivElement>(null)
  const whitespace = useRef<HTMLPreElement>(null)
  const lines = useMemo(() => value.replace(/\r\n?/g, '\n').split('\n'), [value])
  const lineCount = lines.length
  const wrapping = wrap !== 'off'
  // Keep the original whitespace in the mirror so native tab stops and Unicode
  // text retain their widths. Only the pseudo-elements draw visible markers.
  const markedLines = useMemo(() => lines.map((line, lineIndex) => (
    <span key={lineIndex} data-editor-line className="block min-h-lh">
      {showWhitespace ? line.split(/([ \t])/).map((part, i) => (
        part === ' ' || part === '\t' ? (
          <span
            key={i}
            data-whitespace={part === '\t' ? 'tab' : 'space'}
            className={cn(
              'relative after:absolute',
              part === '\t'
                ? "after:inset-x-0 after:top-1/2 after:-translate-y-1/2 after:text-center after:leading-none after:text-muted-foreground/70 after:content-['→']"
                : "after:inset-x-px after:bottom-[0.1em] after:h-px after:bg-muted-foreground/40 after:content-['']",
            )}
          >{part}</span>
        ) : part
      )) : line}
      {lineIndex < lines.length - 1 ? '\n' : !line ? <br /> : null}
    </span>
  )), [lines, showWhitespace])

  useImperativeHandle(ref, () => textarea.current!, [])

  const syncScroll = () => {
    const input = textarea.current
    if (!input) return
    if (numbers.current) numbers.current.style.transform = `translateY(${-input.scrollTop}px)`
    if (whitespace.current) {
      whitespace.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`
    }
  }
  const syncLayout = () => {
    const input = textarea.current
    const mirror = whitespace.current
    const viewport = whitespaceViewport.current
    if (!input || !mirror || !viewport) return
    // Match the text viewport, excluding native scrollbars. Logical lines can
    // occupy several visual rows; their numbers only appear on the first row.
    const width = input.clientWidth
    const height = input.clientHeight
    viewport.style.width = `${width}px`
    viewport.style.height = `${height}px`
    mirror.style.width = wrapping ? `${width}px` : 'max-content'
    if (numbers.current) {
      // Read every wrapped height before updating the gutter. Interleaving a
      // style write with the next measurement recalculates styles per line.
      // Unwrapped lines already share the CSS line height, so need no reads.
      const heights = wrapping ? Array.from(mirror.children, (line) => getComputedStyle(line).height) : []
      Array.from(numbers.current.children).forEach((number, i) => {
        const element = number as HTMLElement
        element.style.height = heights[i] ?? ''
      })
    }
    syncScroll()
  }
  // Replacing/deleting text can clamp scrollTop without a user scroll.
  useLayoutEffect(syncLayout, [value, showWhitespace, wrap])
  useLayoutEffect(() => {
    if (!textarea.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncLayout)
    observer.observe(textarea.current)
    if (whitespace.current) observer.observe(whitespace.current)
    return () => observer.disconnect()
  }, [wrap])

  return (
    <div
      data-slot="code-textarea"
      data-invalid={props['aria-invalid'] || undefined}
      className={cn(
        'grid min-h-24 min-w-0 grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-input bg-(--field) font-mono text-base leading-relaxed shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 md:text-[13px]',
        'data-[invalid=true]:border-destructive data-[invalid=true]:ring-destructive/20 dark:data-[invalid=true]:ring-destructive/40',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <div
        aria-hidden="true"
        data-slot="line-numbers"
        className="pointer-events-none relative overflow-hidden border-r border-border/60 bg-muted/40 text-right text-muted-foreground tabular-nums select-none"
        style={{ width: `calc(${Math.max(2, String(lineCount).length)}ch + 1rem)` }}
      >
        <pre ref={numbers} className="absolute inset-x-0 top-0 m-0 px-2 py-2 [font:inherit]">
          {lines.map((_, i) => <span key={i} className="block h-lh">{i + 1}{i < lineCount - 1 ? '\n' : ''}</span>)}
        </pre>
      </div>
      <div className="relative grid max-h-[inherit] min-h-[inherit] min-w-0">
        <textarea
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          {...props}
          ref={textarea}
          data-slot="textarea"
          value={value}
          disabled={disabled}
          wrap={wrap}
          className={cn(
            'block field-sizing-fixed max-h-[inherit] min-h-[inherit] w-full resize-y overflow-auto overscroll-contain bg-transparent px-3 py-2 [font:inherit] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed',
            className,
            '[font:inherit]!',
            wrapping ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
          )}
          onScroll={(event) => {
            syncScroll()
            onScroll?.(event)
          }}
        />
        <div ref={whitespaceViewport} aria-hidden="true" data-slot={showWhitespace ? 'whitespace-markers' : 'text-mirror'} className="pointer-events-none absolute top-0 left-0 overflow-hidden select-none">
          <pre ref={whitespace} className={cn('m-0 min-w-full px-3 py-2 [font:inherit] text-transparent', wrapping ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>{markedLines}</pre>
        </div>
      </div>
    </div>
  )
}
