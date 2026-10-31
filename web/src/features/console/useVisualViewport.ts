import { useEffect, useState } from 'react'

export interface ViewportBox {
  height: number | null
  offsetTop: number
}

/**
 * Size of the visual viewport, which shrinks when a phone's on-screen
 * keyboard opens (iOS and Android Chrome do not resize the layout viewport).
 * A fixed full-screen layout sized to it keeps the key bar above the keyboard.
 */
export function useVisualViewport(enabled = true): ViewportBox {
  const [box, setBox] = useState<ViewportBox>({ height: null, offsetTop: 0 })
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || !vv) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Ignore pinch-zoom of the whole page: only track keyboard-induced changes.
        if (vv.scale > 1.01) return
        setBox({ height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) })
      })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      cancelAnimationFrame(frame)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [enabled])
  return box
}
