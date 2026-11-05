import { useLayoutEffect, useRef } from 'react'

/** Save each instance/view independently; restore after its async rows arrive. */
export function useResourceTreeScroll(key: string, pathname: string) {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const viewport = root.current?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const storageKey = `tiller:resource-scroll:${key}`
    let saved: { top: number; path: string } | undefined
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null')
      if (value && Number.isFinite(value.top) && value.top >= 0 && typeof value.path === 'string') saved = value
    } catch { /* Storage is optional. */ }
    let restored = false
    let revealed = saved?.path === pathname
    let frame = 0
    const save = () => {
      if (!restored) return
      try { sessionStorage.setItem(storageKey, JSON.stringify({ top: viewport.scrollTop, path: pathname })) } catch { /* Storage is optional. */ }
    }
    const restore = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (viewport.querySelector('[data-tree-loading]')) return
        if (!restored) { viewport.scrollTop = saved?.top ?? 0; restored = true }
        if (!revealed) {
          const selected = viewport.querySelector<HTMLElement>('a[aria-current="page"]')
          if (selected) {
            const row = selected.getBoundingClientRect(), view = viewport.getBoundingClientRect()
            if (row.top < view.top) viewport.scrollTop -= view.top - row.top
            else if (row.bottom > view.bottom) viewport.scrollTop += row.bottom - view.bottom
            revealed = true
          }
        }
        save()
      })
    }
    const observer = new MutationObserver(restore)
    observer.observe(viewport, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] })
    viewport.addEventListener('scroll', save, { passive: true })
    window.addEventListener('pagehide', save)
    restore()
    return () => {
      save(); observer.disconnect(); cancelAnimationFrame(frame)
      viewport.removeEventListener('scroll', save)
      window.removeEventListener('pagehide', save)
    }
  }, [key, pathname])
  return root
}
