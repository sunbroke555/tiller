// PWA helpers: online state and the "install to home screen" prompt.

import { useCallback, useSyncExternalStore } from 'react'

// --------------------------------------------------------------- online

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** navigator.onLine, live. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )
}

// -------------------------------------------------------------- install

/** Chromium's BeforeInstallPromptEvent (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') {
  // Registered at module load (imported from main via AppShell), so the
  // early event fired before React mounts is not lost.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    emit()
  })
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** iPhone / iPad Safari: no install event, the user adds it via the share sheet. */
export function isIosSafari(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}

export type InstallState =
  /** Chromium offered the install prompt: call install(). */
  | 'available'
  /** iOS Safari: show "share → add to home screen" instructions. */
  | 'ios'
  /** Already running as an installed app. */
  | 'installed'
  /** Not installable here (no HTTPS, unsupported browser, or already dismissed by the browser). */
  | 'unavailable'

function snapshot(): InstallState {
  if (installed || isStandalone()) return 'installed'
  if (deferred) return 'available'
  if (isIosSafari() && window.isSecureContext) return 'ios'
  return 'unavailable'
}

function subscribeInstall(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useInstallPrompt(): { state: InstallState; install: () => Promise<boolean> } {
  const state = useSyncExternalStore(subscribeInstall, snapshot, () => 'unavailable' as InstallState)
  const install = useCallback(async () => {
    const ev = deferred
    if (!ev) return false
    await ev.prompt()
    const choice = await ev.userChoice
    deferred = null
    emit()
    return choice.outcome === 'accepted'
  }, [])
  return { state, install }
}

// ------------------------------------------------------ dismiss memory

const DISMISS_KEY = 'pve-web:install-dismissed'
const DISMISS_DAYS = 30

export function installDismissed(now = Date.now()): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return Number.isFinite(at) && at > 0 && now - at < DISMISS_DAYS * 86_400_000
  } catch {
    return false
  }
}

export function dismissInstall(now = Date.now()): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(now))
  } catch {
    // ignore
  }
}
