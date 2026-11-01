// xterm.js console over termproxy (node shell, LXC console, QEMU serial
// port). Lazily loaded: xterm.js and its CSS ship in this chunk only.

import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

import { startTermProxy, targetKey, vncWebsocketUrl } from '@/api/console'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme/ThemeProvider'

import { applyTerminalModifiers, terminalKeySequence } from './keys'
import { describeConsoleError, type ConsoleSessionProps } from './session'
import {
  PING_INTERVAL_MS,
  PING_MESSAGE,
  authMessage,
  inputMessage,
  parseHandshake,
  resizeMessage,
} from './termproto'
import { TERM_PALETTES, xtermTheme } from './termTheme'
import { FONT_SIZE, clampFontSize, storeFontSize, storedFontSize } from './viewers'

const FONT_FAMILY =
  '"Geist Mono Variable", ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", "PingFang SC", monospace'

/** WebGL is faster, but software GL (headless, VMs) is slower and buggy. */
function canUseWebgl(): boolean {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false
  try {
    const canvas = document.createElement('canvas')
    return !!canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
  } catch {
    return false
  }
}

export default function XtermSession({
  target,
  serial,
  modifiers,
  onModifiersUsed,
  onStateChange,
  ref,
  className,
}: ConsoleSessionProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sendRef = useRef<(msg: string) => void>(() => {})
  const pastingRef = useRef(false)
  const coarse = useMediaQuery('(pointer: coarse)')
  const { resolved } = useTheme()
  const [fontSize, setFontSize] = useState(() => storedFontSize() ?? (coarse ? FONT_SIZE.mobile : FONT_SIZE.default))

  // Latest props for the long-lived terminal callbacks.
  const live = useRef({ modifiers, onModifiersUsed, onStateChange, coarse })
  useEffect(() => {
    live.current = { modifiers, onModifiersUsed, onStateChange, coarse }
  })

  const key = targetKey(target)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    let connected = false
    let ws: WebSocket | null = null
    let ping: ReturnType<typeof setInterval> | undefined
    const report = (s: Parameters<ConsoleSessionProps['onStateChange']>[0]) => {
      if (!disposed) live.current.onStateChange(s)
    }

    const term = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize,
      lineHeight: 1.12,
      cursorBlink: true,
      cursorInactiveStyle: 'outline',
      scrollback: 5000,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      theme: xtermTheme(resolved),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit
    if (canUseWebgl()) {
      import('@xterm/addon-webgl')
        .then(({ WebglAddon }) => {
          if (disposed) return
          const webgl = new WebglAddon()
          webgl.onContextLoss(() => webgl.dispose())
          term.loadAddon(webgl)
        })
        .catch(() => {
          // DOM renderer stays in place
        })
    }

    const send = (msg: string) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(msg)
    }
    sendRef.current = (data: string) => {
      if (connected) send(inputMessage(data))
    }

    const safeFit = () => {
      if (disposed || !host.isConnected || host.clientWidth < 20 || host.clientHeight < 20) return
      try {
        fit.fit()
      } catch {
        // not rendered yet
      }
    }
    safeFit()

    term.onData((data) => {
      if (!connected) return
      let out = data
      const { modifiers: mods, onModifiersUsed: used } = live.current
      if (!pastingRef.current && (mods.ctrl || mods.alt)) {
        out = applyTerminalModifiers(data, mods)
        used()
      }
      send(inputMessage(out))
    })
    term.onResize(({ cols, rows }) => {
      if (connected) send(resizeMessage(cols, rows))
    })

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(safeFit, 60)
    })
    ro.observe(host)

    report({ phase: 'connecting' })
    void (async () => {
      try {
        await document.fonts?.load?.(`${fontSize}px "Geist Mono Variable"`).catch(() => undefined)
        if (disposed) return
        // xterm measured the cell size with the fallback font at open(); a
        // changed fontFamily string makes it measure Geist Mono, so the column
        // count matches what is drawn.
        term.options.fontFamily = `${FONT_FAMILY}, monospace`
        safeFit()
        const ticket = await startTermProxy(target, { serial })
        if (disposed) return
        const socket = new WebSocket(vncWebsocketUrl(target, ticket), 'binary')
        ws = socket
        socket.binaryType = 'arraybuffer'
        socket.onopen = () => socket.send(authMessage(ticket.user, ticket.ticket))
        socket.onmessage = (ev: MessageEvent<ArrayBuffer | string>) => {
          const bytes = typeof ev.data === 'string' ? new TextEncoder().encode(ev.data) : new Uint8Array(ev.data)
          if (connected) {
            term.write(bytes)
            return
          }
          const rest = parseHandshake(bytes)
          if (!rest) {
            socket.close()
            report({ phase: 'failed', message: '终端认证失败' })
            return
          }
          connected = true
          term.write(rest)
          report({ phase: 'connected' })
          safeFit()
          send(resizeMessage(term.cols, term.rows))
          // Programmatic focus does not open phone keyboards anyway; on
          // desktop it lets the user type right away.
          if (!live.current.coarse) term.focus()
          ping = setInterval(() => send(PING_MESSAGE), PING_INTERVAL_MS)
        }
        socket.onclose = (ev) => {
          clearInterval(ping)
          const was = connected
          connected = false
          if (disposed) return
          if (was) report({ phase: 'closed', message: ev.reason || '会话已结束' })
          else report({ phase: 'failed', message: ev.reason || '服务器拒绝了连接，请重试' })
        }
      } catch (e) {
        report({ phase: 'failed', message: describeConsoleError(e) })
      }
    })()

    return () => {
      disposed = true
      connected = false
      clearInterval(ping)
      clearTimeout(resizeTimer)
      ro.disconnect()
      ws?.close()
      sendRef.current = () => {}
      termRef.current = null
      fitRef.current = null
      term.dispose()
    }
    // fontSize/resolved are applied by the effects below; a reconnect remounts.
  }, [key, serial])

  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = xtermTheme(resolved)
  }, [resolved])

  useEffect(() => {
    const term = termRef.current
    if (!term || term.options.fontSize === fontSize) return
    term.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
    } catch {
      // ignore
    }
    storeFontSize(fontSize)
  }, [fontSize])

  // Pinch to change the font size (two fingers); one finger scrolls (xterm).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let start: { dist: number; size: number } | null = null
    let frame = 0
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY)
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        start = { dist: dist(e.touches), size: termRef.current?.options.fontSize ?? FONT_SIZE.default }
        e.stopPropagation()
      }
    }
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return
      e.preventDefault()
      e.stopPropagation()
      const ratio = dist(e.touches) / Math.max(1, start.dist)
      const next = clampFontSize(start.size * ratio)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setFontSize(next))
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null
    }
    host.addEventListener('touchstart', onStart, { capture: true, passive: true })
    host.addEventListener('touchmove', onMove, { capture: true, passive: false })
    host.addEventListener('touchend', onEnd, { capture: true })
    host.addEventListener('touchcancel', onEnd, { capture: true })
    return () => {
      cancelAnimationFrame(frame)
      host.removeEventListener('touchstart', onStart, { capture: true })
      host.removeEventListener('touchmove', onMove, { capture: true })
      host.removeEventListener('touchend', onEnd, { capture: true })
      host.removeEventListener('touchcancel', onEnd, { capture: true })
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      sendKey(k, mods) {
        const term = termRef.current
        sendRef.current(terminalKeySequence(k, mods, term?.modes.applicationCursorKeysMode ?? false))
      },
      sendChar(ch, mods) {
        sendRef.current(applyTerminalModifiers(ch, mods))
      },
      sendText(text) {
        const term = termRef.current
        if (!term) return
        pastingRef.current = true
        try {
          term.paste(text)
        } finally {
          pastingRef.current = false
        }
      },
      toggleKeyboard() {
        const term = termRef.current
        if (!term) return false
        if (term.textarea && document.activeElement === term.textarea) {
          term.blur()
          return false
        }
        term.focus()
        return true
      },
      focus() {
        termRef.current?.focus()
      },
      copyText() {
        return termRef.current?.getSelection() ?? ''
      },
      zoom(step) {
        setFontSize((s) => (step === 0 ? (coarse ? FONT_SIZE.mobile : FONT_SIZE.default) : clampFontSize(s + step)))
      },
    }),
    [coarse],
  )

  return (
    <div
      className={cn('size-full overflow-hidden p-2 sm:p-3', className)}
      style={{ background: TERM_PALETTES[resolved].background }}
      data-testid="xterm-console"
    >
      <div ref={hostRef} className="size-full" />
    </div>
  )
}
