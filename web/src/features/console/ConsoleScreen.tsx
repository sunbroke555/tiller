// The console UI shared by the full-screen page (/console/…), the guest
// "控制台" tab, the node "Shell" tab and the /shell page: viewer switch,
// connection status, menus, key bar and the lazily loaded session.

import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ChevronLeft,
  ClipboardCopy,
  ClipboardPaste,
  Ellipsis,
  Expand,
  ExternalLink,
  Keyboard,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MonitorDown,
  Play,
  Power,
  RefreshCw,
  ScreenShare,
  Smartphone,
  TriangleAlert,
  Unplug,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { toast } from 'sonner'

import { isPveApiError } from '@/api/client'
import {
  resumeGuest,
  startGuest,
  targetKey,
  targetLabel,
  useGuestConsoleConfig,
  useGuestConsoleStatus,
  type ConsoleTarget,
  type ConsoleViewer,
} from '@/api/console'
import { queryKeys } from '@/api/queries'
import { useClusterOptions } from '@/api/shell'
import { AmbientBackground } from '@/components/AmbientBackground'
import { GlassCard } from '@/components/GlassCard'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { errorMessage } from '@/lib/errors'
import { useVisualViewport } from '@/hooks/useVisualViewport'
import { consolePath, nodeShellPath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { KeyBar } from './KeyBar'
import { NO_MODIFIERS, type Modifiers, type SpecialKey } from './keys'
import { PasteDialog } from './PasteDialog'
import { SendKeyDialog } from './SendKeyDialog'
import { PHASE_LABEL, type ConsoleSessionHandle, type ConsoleState, type VncScaleMode } from './session'
import { SpiceDialog } from './SpiceDialog'
import { chooseViewer, consoleCapabilities, opensSpiceByDefault, rememberViewer, rememberedViewer } from './viewers'

// Each viewer is its own chunk: xterm.js or noVNC load only when used.
const XtermSession = lazy(() => import('./XtermSession'))
const VncSession = lazy(() => import('./VncSession'))

export interface ConsoleScreenProps {
  target: ConsoleTarget
  /** 'page': full-screen route. 'embedded': inside a tab or page. */
  variant: 'page' | 'embedded'
  /** Guest name or node name. */
  title: string
  /** Back link of the full-screen page. */
  backTo?: string
  /** Viewer asked for in the URL (?viewer=xterm|novnc). */
  requestedViewer?: string | null
  onViewerChange?: (viewer: ConsoleViewer) => void
  className?: string
}

/** Label of a viewer for this kind of target. */
export function viewerName(target: ConsoleTarget, v: ConsoleViewer): string {
  if (target.kind === 'qemu') return v === 'novnc' ? '图形' : '串口'
  return v === 'xterm' ? '终端' : 'VNC'
}

function fullPath(target: ConsoleTarget): string {
  if (target.kind === 'node') return nodeShellPath(target.node) + (target.cmd ? `?cmd=${target.cmd}` : '')
  return consolePath({ node: target.node, type: target.kind, vmid: target.vmid })
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Plain HTTP or no permission: the legacy way still works on most browsers.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.append(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    return ok
  }
}

type DialogKind = 'paste' | 'sendkey' | 'spice' | null

export function ConsoleScreen({ target, variant, title, backTo, requestedViewer, onViewerChange, className }: ConsoleScreenProps) {
  const isGuest = target.kind !== 'node'
  const page = variant === 'page'
  const navigate = useNavigate()
  const coarse = useMediaQuery('(pointer: coarse)')
  const compact = useMediaQuery('(orientation: landscape) and (max-height: 520px)')
  const desktop = useMediaQuery('(min-width: 1024px)')

  // ------------------------------------------------------ guest state
  const statusQ = useGuestConsoleStatus(target)
  const configQ = useGuestConsoleConfig(target)
  const statusForbidden = isPveApiError(statusQ.error) && statusQ.error.isForbidden
  // Datacenter default console type (wait for it so the first connect uses it).
  const optionsQ = useClusterOptions()
  const dcConsole = typeof optionsQ.data?.console === 'string' ? optionsQ.data.console : null
  const optionsReady = optionsQ.isFetched || optionsQ.isError
  const ready =
    optionsReady && (!isGuest || ((statusQ.isFetched || statusQ.isError) && (configQ.isFetched || configQ.isError)))
  const guestStatus = statusQ.data
  const template = guestStatus?.template === 1
  const running = !isGuest || statusForbidden || guestStatus?.status === 'running'
  const caps = consoleCapabilities(target, guestStatus, configQ.data)

  // ------------------------------------------------------------ viewer
  const [pickedViewer, setPickedViewer] = useState<ConsoleViewer | null>(null)
  const viewer: ConsoleViewer =
    pickedViewer && caps.viewers.includes(pickedViewer)
      ? pickedViewer
      : chooseViewer(target, caps, configQ.data, requestedViewer, rememberedViewer(target.kind), dcConsole)
  const mode = viewer === 'novnc' ? 'vnc' : 'terminal'
  const pickViewer = (v: ConsoleViewer) => {
    setPickedViewer(v)
    rememberViewer(target.kind, v)
    onViewerChange?.(v)
  }

  // ----------------------------------------------------------- session
  const sessionRef = useRef<ConsoleSessionHandle>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ConsoleState>({ phase: 'connecting' })
  const [mods, setMods] = useState<Modifiers>(NO_MODIFIERS)
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const [keyBarPref, setKeyBarPref] = useState<boolean | null>(null)
  // Phones: on in the full-screen page; the embedded tab keeps the page short.
  const showKeyBar = keyBarPref ?? (coarse && (page || desktop))
  const [scaleMode, setScaleMode] = useState<VncScaleMode>('fit')
  const [remoteClip, setRemoteClip] = useState('')
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [pasteText, setPasteText] = useState('')
  const surfaceRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const canConnect = ready && running && !template

  // Datacenter default "SPICE (remote-viewer)": the full-screen console offers
  // the .vv download once, like the official console button; phones keep the
  // web console (no remote-viewer there).
  const spiceByDefault =
    page && !coarse && canConnect && caps.spice && !pickedViewer && opensSpiceByDefault(caps, requestedViewer, rememberedViewer(target.kind), dcConsole)
  const spiceOffered = useRef(false)
  useEffect(() => {
    if (!spiceByDefault || spiceOffered.current) return
    spiceOffered.current = true
    setDialog('spice')
  }, [spiceByDefault])
  const sessionKey = `${targetKey(target)}:${viewer}:${attempt}`
  const reconnect = useCallback(() => {
    setState({ phase: 'connecting' })
    setAttempt((a) => a + 1)
  }, [])

  // Track whether a text input inside the console has focus (= phone keyboard up).
  useEffect(() => {
    const update = () => {
      const el = document.activeElement
      setKeyboardOpen(!!el && el.tagName === 'TEXTAREA' && !!surfaceRef.current?.contains(el))
    }
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [])

  // A dialog (paste, sendkey, SPICE) closed: give the keyboard back to the
  // console on desktop once the dialog has finished restoring focus.
  const hadDialog = useRef(false)
  useEffect(() => {
    if (dialog) {
      hadDialog.current = true
      return
    }
    if (!hadDialog.current || coarse) return
    hadDialog.current = false
    const t = setTimeout(() => {
      if (!surfaceRef.current?.contains(document.activeElement)) sessionRef.current?.focus()
    }, 320)
    return () => clearTimeout(t)
  }, [dialog, coarse])

  // Guest was (re)started elsewhere while we showed "未运行": connect again.
  // (null until the first status arrived, so the first connect is not doubled.)
  const wasRunning = useRef<boolean | null>(null)
  useEffect(() => {
    if (!ready) return
    if (running && wasRunning.current === false) reconnect()
    wasRunning.current = running
  }, [ready, running, reconnect])

  useEffect(() => {
    if (!page) return
    const prev = document.title
    document.title = `${title} · ${target.kind === 'node' ? 'Shell' : '控制台'}`
    return () => {
      document.title = prev
    }
  }, [page, title, target.kind])

  // ------------------------------------------------------------ actions
  const send = {
    key: (k: SpecialKey) => {
      sessionRef.current?.sendKey(k, mods)
      setMods(NO_MODIFIERS)
    },
    char: (ch: string, forced: Modifiers) => {
      sessionRef.current?.sendChar(ch, {
        ctrl: forced.ctrl || mods.ctrl,
        alt: forced.alt || mods.alt,
        shift: forced.shift || mods.shift,
      })
      setMods(NO_MODIFIERS)
    },
  }

  async function paste() {
    try {
      const text = await navigator.clipboard?.readText?.()
      if (text) {
        sessionRef.current?.sendText(text)
        return
      }
    } catch {
      // not allowed here: ask for the text instead
    }
    setPasteText('')
    setDialog('paste')
  }

  async function copy() {
    const text = sessionRef.current?.copyText() ?? ''
    if (!text) {
      toast.info(mode === 'vnc' ? '客户机还没有复制内容' : '先在终端里选中要复制的文字')
      return
    }
    if (await copyToClipboard(text)) toast.success('已复制到剪贴板')
    else {
      setPasteText(text)
      toast.error('浏览器不允许写入剪贴板')
    }
  }

  const [isFullscreen, setIsFullscreen] = useState(false)
  useEffect(() => {
    const on = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled
  const orientation = typeof screen !== 'undefined' ? (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }) : undefined
  const canLockLandscape = page && coarse && fullscreenSupported && typeof orientation?.lock === 'function'

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await (page ? document.documentElement : rootRef.current)?.requestFullscreen({ navigationUI: 'hide' })
    } catch {
      toast.error('浏览器不允许全屏')
    }
  }

  async function landscape() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      await orientation?.lock?.('landscape')
    } catch {
      toast.info('无法锁定横屏，请直接旋转手机')
    }
  }

  // ------------------------------------------------------- start guest
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  async function start() {
    if (target.kind === 'node') return
    setStarting(true)
    setStartError(null)
    const resume = guestStatus?.qmpstatus === 'paused' || guestStatus?.qmpstatus === 'suspended'
    try {
      const handle = await runTask(resume ? resumeGuest(target) : startGuest(target), {
        title: `${resume ? '恢复' : '启动'} ${title}`,
        invalidate: [queryKeys.guest(target.node, target.kind, target.vmid), queryKeys.resources()],
      })
      const outcome = await handle.done
      if (outcome.state === 'error') setStartError(outcome.exitstatus ?? '启动失败')
      await statusQ.refetch()
    } catch (e) {
      setStartError(errorMessage(e))
    } finally {
      setStarting(false)
    }
  }

  // -------------------------------------------------------------- views
  const vv = useVisualViewport(page)
  const kindLabel = targetLabel(target)
  const lxcAppHint =
    target.kind === 'lxc' &&
    configQ.data?.cmode === 'console' &&
    configQ.data?.entrypoint !== undefined &&
    configQ.data.entrypoint !== '/sbin/init'

  const sessionProps = {
    target,
    serial: caps.serial,
    modifiers: mods,
    onModifiersUsed: () => setMods(NO_MODIFIERS),
    onStateChange: setState,
    scaleMode,
    onRemoteClipboard: setRemoteClip,
    ref: sessionRef,
  }

  let overlay: ReactNode = null
  if (isGuest && !ready) {
    overlay = <CenterSpinner label="正在读取客户机状态…" />
  } else if (isGuest && statusQ.isError && !statusQ.data && !statusForbidden) {
    // (A failed poll while connected keeps the console; only a first load failure blocks.)
    overlay = (
      <OverlayCard
        icon={TriangleAlert}
        tone="bad"
        title="无法读取客户机状态"
        description={errorMessage(statusQ.error)}
        actions={
          <Button onClick={() => void statusQ.refetch()}>
            <RefreshCw /> 重试
          </Button>
        }
      />
    )
  } else if (template) {
    overlay = <OverlayCard icon={Unplug} title="模板没有控制台" description="模板不能启动。先从模板克隆出客户机。" />
  } else if (!running) {
    const paused = guestStatus?.qmpstatus === 'paused' || guestStatus?.qmpstatus === 'suspended'
    overlay = (
      <OverlayCard
        icon={Power}
        title={`${kindLabel} 未运行`}
        description={startError ?? (paused ? '客户机已暂停，恢复后自动连接。' : '启动后会自动连接控制台。')}
        tone={startError ? 'bad' : undefined}
        actions={
          <Button onClick={() => void start()} disabled={starting} size="lg">
            {starting ? <LoaderCircle className="animate-spin" /> : <Play />}
            {starting ? '正在启动…' : paused ? '恢复运行' : '启动'}
          </Button>
        }
      />
    )
  } else if (state.phase === 'failed' || state.phase === 'closed') {
    overlay = (
      <OverlayCard
        icon={Unplug}
        tone={state.phase === 'failed' ? 'bad' : undefined}
        dim
        title={state.phase === 'failed' ? '连接失败' : '连接已断开'}
        description={state.message}
        actions={
          <>
            <Button onClick={reconnect} size="lg">
              <RefreshCw /> 重新连接
            </Button>
            {page && backTo && (
              <Button asChild variant="outline" size="lg">
                <Link to={backTo}>返回</Link>
              </Button>
            )}
          </>
        }
      />
    )
  } else if (state.phase === 'connecting') {
    overlay = <CenterSpinner label={`正在连接 ${kindLabel}…`} />
  }

  const surface = (
    <div
      ref={surfaceRef}
      className={cn('relative size-full overflow-hidden', page && !compact && 'rounded-xl ring-1 ring-border shadow-glass')}
      data-testid="console-surface"
      data-phase={canConnect ? state.phase : 'idle'}
    >
      {canConnect && (
        <Suspense fallback={null}>
          {viewer === 'xterm' ? (
            <XtermSession key={sessionKey} {...sessionProps} />
          ) : (
            <VncSession key={sessionKey} {...sessionProps} />
          )}
        </Suspense>
      )}
      {!canConnect && <div className="absolute inset-0 bg-(--glass-solid) paper:bg-card" aria-hidden />}
      {overlay}
      {lxcAppHint && state.phase === 'connected' && (
        <div className="surface-strong absolute inset-x-3 top-3 rounded-xl px-3 py-2 text-xs text-muted-foreground">
          检测到应用容器：控制台可能无法完全使用。
        </div>
      )}
    </div>
  )

  const keyBar = canConnect && showKeyBar && state.phase === 'connected' && (
    <KeyBar
      compact={compact}
      mode={mode}
      modifiers={mods}
      onToggleModifier={(m) => setMods((prev) => ({ ...prev, [m]: !prev[m] }))}
      onKey={send.key}
      onChar={send.char}
      onPaste={() => void paste()}
      onCtrlAltDel={() => sessionRef.current?.sendCtrlAltDel?.()}
      onKeyboard={() => setKeyboardOpen(sessionRef.current?.toggleKeyboard() ?? false)}
      keyboardOpen={keyboardOpen}
    />
  )

  const menu = (
    <ConsoleMenu
      target={target}
      mode={mode}
      page={page}
      connected={canConnect && state.phase === 'connected'}
      spice={caps.spice && running}
      showKeyBar={showKeyBar}
      onShowKeyBar={setKeyBarPref}
      scaleMode={scaleMode}
      onScaleMode={setScaleMode}
      remoteClip={!!remoteClip}
      isFullscreen={isFullscreen}
      fullscreenSupported={fullscreenSupported}
      canLockLandscape={canLockLandscape}
      onReconnect={reconnect}
      onCtrlAltDel={() => sessionRef.current?.sendCtrlAltDel?.()}
      onSendKey={() => setDialog('sendkey')}
      onPaste={() => {
        setPasteText('')
        setDialog('paste')
      }}
      onCopy={() => void copy()}
      onZoom={(s) => sessionRef.current?.zoom(s)}
      onFullscreen={() => void toggleFullscreen()}
      onLandscape={() => void landscape()}
      onSpice={() => setDialog('spice')}
      onOpenPage={() => navigate(fullPath(target))}
      onPopup={() => window.open(fullPath(target), `console-${targetKey(target)}`, 'popup,width=1100,height=760')}
      refocus={() => {
        if (!coarse) sessionRef.current?.focus()
      }}
    />
  )

  const switcher =
    caps.viewers.length > 1 && !template ? (
      <ViewerSwitch target={target} viewers={caps.viewers} value={viewer} onChange={pickViewer} />
    ) : null

  const dialogs = (
    <>
      <PasteDialog
        open={dialog === 'paste'}
        onOpenChange={(o) => !o && setDialog(null)}
        mode={mode}
        initialText={pasteText}
        clipboard={guestStatus?.clipboard === 'vnc'}
        onSend={(text, how) =>
          how === 'clipboard' ? sessionRef.current?.setRemoteClipboard?.(text) : sessionRef.current?.sendText(text)
        }
      />
      {target.kind === 'qemu' && (
        <SendKeyDialog
          open={dialog === 'sendkey'}
          onOpenChange={(o) => !o && setDialog(null)}
          node={target.node}
          vmid={target.vmid}
          name={title}
        />
      )}
      <SpiceDialog open={dialog === 'spice'} onOpenChange={(o) => !o && setDialog(null)} target={target} name={title} />
    </>
  )

  const status = <StatusPill phase={canConnect ? state.phase : null} guestStatus={isGuest ? guestStatus?.status : undefined} />

  if (page) {
    return (
      <div
        ref={rootRef}
        className={cn(
          'fixed inset-x-0 top-0 flex h-dvh flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]',
          className,
        )}
        style={vv.height ? { height: vv.height, transform: `translateY(${vv.offsetTop}px)` } : undefined}
      >
        <AmbientBackground />
        <header
          className={cn(
            'relative z-10 flex shrink-0 items-center gap-1 pr-2 pl-1 pt-[env(safe-area-inset-top)] sm:gap-2 sm:pr-3',
            compact ? 'h-[calc(2.75rem+env(safe-area-inset-top))]' : 'h-[calc(3.75rem+env(safe-area-inset-top))]',
          )}
        >
          {backTo && (
            <Link
              to={backTo}
              aria-label="返回"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ChevronLeft className="size-5" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className={cn('truncate font-semibold text-foreground', compact ? 'text-sm' : 'text-[15px] sm:text-base')}>{title}</h1>
            {!compact && (
              <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {status}
                <span aria-hidden>·</span>
                <span className="truncate tabular">
                  {kindLabel}
                  {target.kind !== 'node' && ` · ${target.node}`}
                </span>
              </div>
            )}
          </div>
          {compact && status}
          {switcher}
          {desktop && canConnect && state.phase === 'connected' && (
            <div className="flex items-center gap-1">
              {mode === 'vnc' && (
                <Button variant="ghost" size="sm" onPointerDown={(e) => e.preventDefault()} onClick={() => sessionRef.current?.sendCtrlAltDel?.()}>
                  Ctrl+Alt+Del
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="粘贴"
                title="粘贴"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => void paste()}
              >
                <ClipboardPaste />
              </Button>
              {fullscreenSupported && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={isFullscreen ? '退出全屏' : '全屏'}
                  title={isFullscreen ? '退出全屏' : '全屏'}
                  onClick={() => void toggleFullscreen()}
                >
                  {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                </Button>
              )}
            </div>
          )}
          {menu}
        </header>
        <main className={cn('relative z-10 min-h-0 flex-1', compact ? 'px-0' : 'px-2 pb-2 sm:px-3 sm:pb-3')}>{surface}</main>
        {keyBar && (
          <div
            className={cn(
              'relative z-10 shrink-0',
              compact ? 'border-t border-border/60 bg-(--glass-strong)' : 'surface-strong mx-2 mb-[max(0.5rem,env(safe-area-inset-bottom))] rounded-2xl sm:mx-3',
              keyboardOpen && !compact && 'mb-2',
            )}
          >
            {keyBar}
          </div>
        )}
        {dialogs}
      </div>
    )
  }

  return (
    <GlassCard flush className={cn('overflow-hidden', className)}>
      <div ref={rootRef} className="flex flex-col bg-(--glass-solid) [&:fullscreen]:h-dvh paper:bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
          <div className="min-w-0 flex-1">{status}</div>
          {switcher}
          {canConnect && state.phase === 'connected' && desktop && mode === 'vnc' && (
            <Button variant="ghost" size="sm" onPointerDown={(e) => e.preventDefault()} onClick={() => sessionRef.current?.sendCtrlAltDel?.()}>
              Ctrl+Alt+Del
            </Button>
          )}
          <Button asChild variant={coarse ? 'secondary' : 'ghost'} size="sm" className="pointer-coarse:h-10">
            <Link to={fullPath(target)}>
              <Expand />
              全屏
            </Link>
          </Button>
          {menu}
        </div>
        <div
          className={cn(
            'relative',
            isFullscreen
              ? 'min-h-0 flex-1'
              : desktop
                ? 'h-[min(70dvh,48rem)] min-h-[26rem]'
                : // Phone: keep the whole card above the floating action bar and nav.
                  'h-[max(18rem,calc(100dvh-var(--dock-h,4.5rem)-17rem))]',
          )}
        >
          {surface}
        </div>
        {keyBar && <div className="border-t border-border/60">{keyBar}</div>}
      </div>
      {dialogs}
    </GlassCard>
  )
}

// ---------------------------------------------------------------- pieces

function StatusPill({ phase, guestStatus }: { phase: ConsoleState['phase'] | null; guestStatus?: string | undefined }) {
  let label: string
  let tone: string
  if (phase === null) {
    label = guestStatus === 'running' || guestStatus === undefined ? '未连接' : '未运行'
    tone = 'bg-faint'
  } else {
    label = PHASE_LABEL[phase]
    tone =
      phase === 'connected'
        ? 'bg-success shadow-[0_0_8px_var(--success)] paper:shadow-none'
        : phase === 'connecting'
          ? 'bg-warning animate-pulse'
          : phase === 'failed'
            ? 'bg-destructive'
            : 'bg-faint'
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground" role="status" data-testid="console-status">
      <span aria-hidden className={cn('size-2 rounded-full', tone)} />
      {label}
    </span>
  )
}

function ViewerSwitch({
  target,
  viewers,
  value,
  onChange,
}: {
  target: ConsoleTarget
  viewers: ConsoleViewer[]
  value: ConsoleViewer
  onChange: (v: ConsoleViewer) => void
}) {
  return (
    <div role="radiogroup" aria-label="控制台类型" className="inline-flex shrink-0 rounded-lg bg-foreground/[0.06] p-0.5 paper:bg-secondary">
      {viewers.map((v) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(v)}
            className={cn(
              'h-8 min-w-12 rounded-md px-2.5 text-xs font-medium transition-colors pointer-coarse:h-9',
              active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border dark:bg-foreground/[0.12] dark:ring-0 paper:bg-card'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {viewerName(target, v)}
          </button>
        )
      })}
    </div>
  )
}

function CenterSpinner({ label }: { label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="surface-strong inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-brand-strong paper:text-foreground/70" aria-hidden />
        {label}
      </div>
    </div>
  )
}

function OverlayCard({
  icon: Icon,
  title,
  description,
  actions,
  tone,
  dim,
}: {
  icon: typeof Power
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  tone?: 'bad' | undefined
  /** Darken a (dead) console underneath. */
  dim?: boolean
}) {
  return (
    <div
      className={cn(
        'absolute inset-0 flex items-center justify-center overflow-y-auto p-4',
        dim && 'bg-(--overlay) backdrop-blur-[2px]',
      )}
    >
      <div
        className={cn(
          'flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl px-6 py-7 text-center',
          dim && 'surface-strong',
        )}
        role="alert"
      >
        <span
          className={cn(
            'inline-flex size-12 items-center justify-center rounded-2xl ring-1 ring-inset',
            tone === 'bad'
              ? 'bg-destructive/10 text-destructive ring-destructive/20'
              : 'bg-brand/10 text-brand-strong ring-brand/15 paper:bg-secondary paper:text-foreground/70 paper:ring-border',
          )}
        >
          <Icon className="size-6" aria-hidden />
        </span>
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {description && <p className="max-w-xs text-sm break-words text-muted-foreground">{description}</p>}
        {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

interface ConsoleMenuProps {
  target: ConsoleTarget
  mode: 'terminal' | 'vnc'
  page: boolean
  connected: boolean
  spice: boolean
  showKeyBar: boolean
  onShowKeyBar: (v: boolean) => void
  scaleMode: VncScaleMode
  onScaleMode: (m: VncScaleMode) => void
  remoteClip: boolean
  isFullscreen: boolean
  fullscreenSupported: boolean
  canLockLandscape: boolean
  onReconnect: () => void
  onCtrlAltDel: () => void
  onSendKey: () => void
  onPaste: () => void
  onCopy: () => void
  onZoom: (step: -1 | 0 | 1) => void
  onFullscreen: () => void
  onLandscape: () => void
  onSpice: () => void
  onOpenPage: () => void
  onPopup: () => void
  refocus: () => void
}

function ConsoleMenu(p: ConsoleMenuProps) {
  const qemu = p.target.kind === 'qemu'
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="控制台菜单" className="shrink-0">
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          p.refocus()
        }}
      >
        <DropdownMenuItem onSelect={p.onReconnect}>
          <RefreshCw /> 重新连接
        </DropdownMenuItem>
        {p.connected && (
          <>
            {p.mode === 'vnc' && (
              <DropdownMenuItem onSelect={p.onCtrlAltDel}>
                <Keyboard /> 发送 Ctrl+Alt+Del
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={p.onPaste}>
              <ClipboardPaste /> 粘贴文本…
            </DropdownMenuItem>
            {(p.mode === 'terminal' || p.remoteClip) && (
              <DropdownMenuItem onSelect={p.onCopy}>
                <ClipboardCopy /> {p.mode === 'terminal' ? '复制选中内容' : '复制客户机剪贴板'}
              </DropdownMenuItem>
            )}
          </>
        )}
        {qemu && (
          <DropdownMenuItem onSelect={p.onSendKey}>
            <Keyboard /> 发送按键…
          </DropdownMenuItem>
        )}
        {p.connected && (
          <>
            <DropdownMenuSeparator />
            {p.mode === 'vnc' ? (
              <>
                <DropdownMenuLabel>显示</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={p.scaleMode} onValueChange={(v) => p.onScaleMode(v as VncScaleMode)}>
                  <DropdownMenuRadioItem value="fit">适应窗口</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="native">原始大小</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {p.scaleMode === 'fit' && (
                  <div className="flex items-center gap-1 px-1 py-1">
                    <ZoomButton label="缩小" onClick={() => p.onZoom(-1)} icon={ZoomOut} />
                    <ZoomButton label="复原" onClick={() => p.onZoom(0)} text="100%" />
                    <ZoomButton label="放大" onClick={() => p.onZoom(1)} icon={ZoomIn} />
                  </div>
                )}
              </>
            ) : (
              <>
                <DropdownMenuLabel>字号</DropdownMenuLabel>
                <div className="flex items-center gap-1 px-1 py-1">
                  <ZoomButton label="缩小字号" onClick={() => p.onZoom(-1)} icon={ZoomOut} />
                  <ZoomButton label="默认字号" onClick={() => p.onZoom(0)} text="默认" />
                  <ZoomButton label="放大字号" onClick={() => p.onZoom(1)} icon={ZoomIn} />
                </div>
              </>
            )}
            <DropdownMenuCheckboxItem checked={p.showKeyBar} onCheckedChange={(v) => p.onShowKeyBar(!!v)}>
              辅助按键栏
            </DropdownMenuCheckboxItem>
          </>
        )}
        <DropdownMenuSeparator />
        {!p.page && (
          <DropdownMenuItem onSelect={p.onOpenPage}>
            <Expand /> 全屏打开
          </DropdownMenuItem>
        )}
        {!p.page && (
          <DropdownMenuItem onSelect={p.onPopup}>
            <ExternalLink /> 在新窗口打开
          </DropdownMenuItem>
        )}
        {p.fullscreenSupported && (
          <DropdownMenuItem onSelect={p.onFullscreen}>
            {p.isFullscreen ? <Minimize2 /> : <Maximize2 />} {p.isFullscreen ? '退出全屏' : p.page ? '全屏' : '浏览器全屏'}
          </DropdownMenuItem>
        )}
        {p.canLockLandscape && (
          <DropdownMenuItem onSelect={p.onLandscape}>
            <Smartphone className="rotate-90" /> 横屏全屏
          </DropdownMenuItem>
        )}
        {p.spice && (
          <DropdownMenuItem onSelect={p.onSpice}>
            {p.target.kind === 'node' ? <ScreenShare /> : <MonitorDown />} SPICE（.vv 文件）…
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ZoomButton({ label, onClick, icon: Icon, text }: { label: string; onClick: () => void; icon?: typeof ZoomIn; text?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex h-9 flex-1 items-center justify-center rounded-md bg-foreground/[0.05] text-sm text-foreground hover:bg-accent pointer-coarse:h-10 paper:bg-secondary"
    >
      {Icon ? <Icon className="size-4" /> : text}
    </button>
  )
}
