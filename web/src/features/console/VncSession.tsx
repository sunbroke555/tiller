// noVNC console (QEMU display; also LXC / node shell via vncterm). Lazily
// loaded: noVNC ships in this chunk only.
//
// Touch: noVNC's own gestures stay (tap = click, long press = right click,
// drag = mouse drag, two-finger drag = wheel). Pinch is taken over to zoom
// the view locally; while zoomed, two-finger drag pans instead of scrolling.
// Phone keyboards type into a hidden textarea whose input is replayed as
// key events.

import { useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import RFB from '@novnc/novnc'

import { startVncProxy, targetKey, vncPassword, vncWebsocketUrl } from '@/api/console'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme/ThemeProvider'

import {
  NO_MODIFIERS,
  charToVncKey,
  domKeyToSpecial,
  vncComboEvents,
  vncSpecialKey,
  vncTextEvents,
  type Modifiers,
  type VncKeyEvent,
} from './keys'
import { describeConsoleError, type ConsoleSessionProps } from './session'
import { VNC_BACKGROUND } from './termTheme'
import { clampZoom, VNC_ZOOM } from './viewers'

/** Keeps the hidden textarea non-empty so a Backspace still produces an input event. */
const SENTINEL = ' '.repeat(16)
const MAX_PASTE = 8192
const PINCH_HINT_KEY = 'pve-web:vnc-pinch-hint'

/** Show the "pinch to zoom" hint once per browser on touch devices. */
function takePinchHint(): boolean {
  try {
    if (localStorage.getItem(PINCH_HINT_KEY)) return false
    localStorage.setItem(PINCH_HINT_KEY, '1')
    return true
  } catch {
    return false
  }
}

interface GestureDetail {
  type: string
  clientX: number
  clientY: number
  magnitudeX: number
  magnitudeY: number
}

export default function VncSession({
  target,
  modifiers,
  onModifiersUsed,
  onStateChange,
  onRemoteClipboard,
  scaleMode = 'fit',
  ref,
  className,
}: ConsoleSessionProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const clipboardRef = useRef('')
  const zoomRef = useRef(1)
  const composingRef = useRef(false)
  const [zoom, setZoomState] = useState(1)
  const [hint, setHint] = useState(false)
  const coarse = useMediaQuery('(pointer: coarse)')
  const { resolved } = useTheme()

  const live = useRef({ modifiers, onModifiersUsed, onStateChange, onRemoteClipboard, coarse })
  useEffect(() => {
    live.current = { modifiers, onModifiersUsed, onStateChange, onRemoteClipboard, coarse }
  })

  const key = targetKey(target)
  useEffect(() => {
    const screen = screenRef.current
    const viewport = viewportRef.current
    if (!screen || !viewport) return
    let disposed = false
    let rfb: RFB | null = null
    const report = (s: Parameters<ConsoleSessionProps['onStateChange']>[0]) => {
      if (!disposed) live.current.onStateChange(s)
    }

    report({ phase: 'connecting' })
    void (async () => {
      try {
        const rect = viewport.getBoundingClientRect()
        const ticket = await startVncProxy(target, {
          width: Math.round(Math.min(2560, Math.max(640, rect.width))),
          height: Math.round(Math.min(1600, Math.max(400, rect.height))),
        })
        if (disposed) return
        const password = vncPassword(ticket)
        rfb = new RFB(screen, vncWebsocketUrl(target, ticket), { credentials: { password }, wsProtocols: ['binary'] })
        rfbRef.current = rfb
        rfb.scaleViewport = scaleMode === 'fit'
        rfb.clipViewport = false
        rfb.resizeSession = false
        rfb.background = 'transparent'
        // On phones a tap must not steal focus from the keyboard textarea.
        rfb.focusOnClick = !live.current.coarse
        rfb.qualityLevel = 6
        rfb.compressionLevel = 2
        rfb.addEventListener('connect', () => {
          report({ phase: 'connected' })
          if (!live.current.coarse) rfb?.focus()
          else if (takePinchHint()) {
            setHint(true)
            setTimeout(() => setHint(false), 4500)
          }
        })
        rfb.addEventListener('disconnect', (e) => {
          rfbRef.current = null
          report(
            e.detail.clean
              ? { phase: 'closed', message: '连接已关闭' }
              : { phase: 'failed', message: '连接中断，客户机可能已停止或迁移' },
          )
        })
        rfb.addEventListener('securityfailure', (e) => {
          report({ phase: 'failed', message: `认证失败${e.detail.reason ? `：${e.detail.reason}` : ''}` })
        })
        rfb.addEventListener('credentialsrequired', () => rfb?.sendCredentials({ password }))
        rfb.addEventListener('clipboard', (e) => {
          clipboardRef.current = e.detail.text
          live.current.onRemoteClipboard?.(e.detail.text)
        })
      } catch (e) {
        report({ phase: 'failed', message: describeConsoleError(e) })
      }
    })()

    return () => {
      disposed = true
      rfbRef.current = null
      try {
        rfb?.disconnect()
      } catch {
        // already closed
      }
    }
    // scaleMode is applied by the effect below; a reconnect remounts.
  }, [key])

  useEffect(() => {
    const rfb = rfbRef.current
    if (rfb) rfb.scaleViewport = scaleMode === 'fit'
    if (scaleMode === 'native') applyZoom(1)
  }, [scaleMode])

  /** Resize the noVNC target to zoom × viewport and keep (cx, cy) under the fingers. */
  function applyZoom(next: number, cx?: number, cy?: number) {
    const viewport = viewportRef.current
    const screen = screenRef.current
    if (!viewport || !screen) return
    const z = clampZoom(next)
    const prev = zoomRef.current
    if (Math.abs(z - prev) < 0.001) return
    const rect = viewport.getBoundingClientRect()
    const ox = (cx ?? rect.left + rect.width / 2) - rect.left
    const oy = (cy ?? rect.top + rect.height / 2) - rect.top
    const sx = viewport.scrollLeft
    const sy = viewport.scrollTop
    zoomRef.current = z
    screen.style.width = `${z * 100}%`
    screen.style.height = `${z * 100}%`
    viewport.scrollLeft = ((sx + ox) * z) / prev - ox
    viewport.scrollTop = ((sy + oy) * z) / prev - oy
    setZoomState(z)
  }

  // Pinch zoom and two-finger pan (capture phase: before noVNC sees them).
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let pinch: { mag: number; zoom: number } | null = null
    let pan: { x: number; y: number } | null = null
    const onGesture = (ev: Event) => {
      const d = (ev as CustomEvent<GestureDetail>).detail
      if (!d) return
      if (d.type === 'pinch') {
        ev.stopPropagation()
        const mag = Math.hypot(d.magnitudeX, d.magnitudeY)
        if (ev.type === 'gesturestart') pinch = { mag: Math.max(1, mag), zoom: zoomRef.current }
        else if (ev.type === 'gesturemove' && pinch) applyZoom(pinch.zoom * (mag / pinch.mag), d.clientX, d.clientY)
        else pinch = null
      } else if (d.type === 'twodrag' && zoomRef.current > 1.01) {
        ev.stopPropagation()
        if (ev.type === 'gesturestart') pan = { x: viewport.scrollLeft, y: viewport.scrollTop }
        else if (ev.type === 'gesturemove' && pan) {
          viewport.scrollLeft = pan.x - d.magnitudeX
          viewport.scrollTop = pan.y - d.magnitudeY
        } else pan = null
      }
    }
    for (const t of ['gesturestart', 'gesturemove', 'gestureend']) viewport.addEventListener(t, onGesture, true)
    return () => {
      for (const t of ['gesturestart', 'gesturemove', 'gestureend']) viewport.removeEventListener(t, onGesture, true)
    }
    // applyZoom only touches refs and state setters.
  }, [])

  function sendEvents(events: VncKeyEvent[]) {
    const rfb = rfbRef.current
    if (!rfb) return
    for (const e of events) rfb.sendKey(e.keysym, e.code ?? null, e.down)
  }

  /** Sticky key-bar modifiers for the next typed key (cleared after use). */
  function takeModifiers(): Modifiers {
    const mods = live.current.modifiers
    if (mods.ctrl || mods.alt || mods.shift) {
      live.current.onModifiersUsed()
      return mods
    }
    return NO_MODIFIERS
  }

  function resetInput() {
    const el = inputRef.current
    if (!el) return
    el.value = SENTINEL
    el.setSelectionRange(SENTINEL.length, SENTINEL.length)
  }

  function onInput(e: FormEvent<HTMLTextAreaElement>) {
    if (composingRef.current) return
    flushInput(e.currentTarget.value)
  }

  function flushInput(value: string) {
    let common = 0
    while (common < SENTINEL.length && common < value.length && value[common] === SENTINEL[common]) common++
    const deleted = SENTINEL.length - common
    const inserted = value.slice(common)
    const events: VncKeyEvent[] = []
    for (let i = 0; i < deleted; i++) events.push(...vncComboEvents(vncSpecialKey('Backspace')))
    if (inserted) {
      const mods = [...inserted].length === 1 ? takeModifiers() : NO_MODIFIERS
      events.push(...vncTextEvents(inserted, mods))
    }
    sendEvents(events)
    resetInput()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    const special = domKeyToSpecial(e.key)
    // Enter and Backspace arrive as input events (soft keyboards often send
    // keyCode 229); handle the rest, and hardware Ctrl/Alt combinations, here.
    if (special && special !== 'Enter' && special !== 'Backspace') {
      e.preventDefault()
      const sticky = takeModifiers()
      sendEvents(
        vncComboEvents(vncSpecialKey(special), {
          ctrl: e.ctrlKey || sticky.ctrl,
          alt: e.altKey || sticky.alt,
          shift: e.shiftKey || sticky.shift,
        }),
      )
    } else if ((e.ctrlKey || e.altKey || e.metaKey) && e.key.length === 1) {
      e.preventDefault()
      const k = charToVncKey(e.key.toLowerCase())
      sendEvents(vncComboEvents({ keysym: k.keysym, code: k.code }, { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey }))
    }
  }

  useImperativeHandle(
    ref,
    () => ({
      sendKey(k, mods) {
        sendEvents(vncComboEvents(vncSpecialKey(k), mods))
      },
      sendChar(ch, mods) {
        const k = charToVncKey(ch)
        sendEvents(vncComboEvents({ keysym: k.keysym, code: k.code }, { ...mods, shift: mods.shift || k.shift }))
      },
      sendText(text) {
        sendEvents(vncTextEvents(text.slice(0, MAX_PASTE)))
      },
      setRemoteClipboard(text) {
        rfbRef.current?.clipboardPasteFrom(text)
      },
      sendCtrlAltDel() {
        rfbRef.current?.sendCtrlAltDel()
      },
      toggleKeyboard() {
        if (!live.current.coarse) {
          rfbRef.current?.focus()
          return false
        }
        const el = inputRef.current
        if (!el) return false
        if (document.activeElement === el) {
          el.blur()
          return false
        }
        resetInput()
        el.focus({ preventScroll: true })
        return true
      },
      focus() {
        if (live.current.coarse) inputRef.current?.focus({ preventScroll: true })
        else rfbRef.current?.focus()
      },
      copyText() {
        return clipboardRef.current
      },
      zoom(step) {
        applyZoom(step === 0 ? 1 : zoomRef.current * (step > 0 ? 1.25 : 0.8))
      },
    }),
    [],
  )

  return (
    <div className={cn('relative size-full', className)} style={{ background: VNC_BACKGROUND[resolved] }} data-testid="vnc-console">
      <div
        ref={viewportRef}
        className={cn('size-full overscroll-contain', zoom > 1 ? 'overflow-auto' : 'overflow-hidden')}
      >
        <div ref={screenRef} className="size-full" />
      </div>
      <textarea
        ref={inputRef}
        aria-label="键盘输入"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        enterKeyHint="send"
        defaultValue={SENTINEL}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={(e) => {
          composingRef.current = false
          flushInput(e.currentTarget.value)
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-px w-px resize-none border-0 bg-transparent p-0 text-[16px] text-transparent caret-transparent opacity-0 outline-none"
      />
      {hint && zoom <= 1.01 && (
        <div className="surface-strong pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3.5 py-1.5 text-xs whitespace-nowrap text-muted-foreground">
          双指捏合放大 · 放大后双指拖动平移
        </div>
      )}
      {zoom > VNC_ZOOM.min + 0.01 && (
        <button
          type="button"
          onClick={() => applyZoom(1)}
          className="surface-strong absolute top-2 right-2 inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-medium text-foreground tabular pointer-coarse:h-10"
          aria-label="恢复适应窗口"
        >
          {Math.round(zoom * 100)}% · 复原
        </button>
      )}
    </div>
  )
}
