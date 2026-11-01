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

export interface KeyboardBox {
  /** Pixels the on-screen keyboard covers at the bottom of the layout viewport (0 when closed). */
  inset: number
  /** Height of the visible area above the keyboard, null when unknown. */
  visible: number | null
  /** Top of the visible area in layout-viewport pixels (iOS pans the page). */
  top: number
}

/** Layout viewport height minus the visible part: what a fixed bottom element loses under the keyboard. */
export function keyboardBox(layoutHeight: number, vv: ViewportBox): KeyboardBox {
  if (vv.height === null) return { inset: 0, visible: null, top: 0 }
  const inset = Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop))
  // Small differences are browser chrome (URL bar) moving, not a keyboard.
  if (inset < 80) return { inset: 0, visible: null, top: 0 }
  return { inset, visible: vv.height, top: vv.offsetTop }
}

/**
 * Where the on-screen keyboard is, for fixed sheets and dialogs: iOS Safari
 * and Android Chrome shrink only the visual viewport, so a `bottom: 0` sheet
 * would stay under the keyboard.
 */
export function useKeyboardBox(enabled = true): KeyboardBox {
  const vv = useVisualViewport(enabled)
  if (!enabled || typeof window === 'undefined') return { inset: 0, visible: null, top: 0 }
  return keyboardBox(window.innerHeight, vv)
}
