// Which console viewers a target supports and which one opens by default.
// Mirrors PVE.Utils.defaultViewer / the console button of the official UI:
// - QEMU: noVNC always; xterm.js only with a serial port (status.serial);
//   SPICE only with a SPICE display (status.spice).
// - LXC and the node shell: xterm.js (default), noVNC and SPICE.
// Without a datacenter default (/cluster/options console) we open noVNC for
// VMs (SPICE needs a desktop client) unless the display itself is a serial
// port (vga=serialN), and xterm.js otherwise. With one, it is honoured the
// way PVE.Utils.defaultViewer does: html5 → noVNC, xtermjs → xterm.js when
// supported, vv → the SPICE .vv download when the target offers SPICE (the
// embedded view then shows our default viewer).

import type { ConsoleTarget, ConsoleViewer, GuestConsoleConfig, GuestConsoleStatus } from '@/api/console'

export interface ConsoleCapabilities {
  viewers: ConsoleViewer[]
  /** A .vv file can be downloaded. */
  spice: boolean
  /** termproxy serial= for QEMU (serial0..3), else undefined. */
  serial?: string | undefined
}

export const VIEWER_LABEL: Record<ConsoleViewer, string> = {
  novnc: 'noVNC',
  xterm: 'xterm.js',
}

export const VIEWER_HINT: Record<ConsoleViewer, string> = {
  novnc: '图形',
  xterm: '终端',
}

/** QEMU serial ports usable by termproxy (type "socket"), in order. */
export function serialPorts(config: GuestConsoleConfig | undefined): string[] {
  if (!config) return []
  return [0, 1, 2, 3].map((i) => `serial${i}`).filter((k) => String(config[k] ?? '').trim() === 'socket')
}

/** "serial0" when the VM's display is a serial port (vga: serial0), else null. */
export function serialDisplay(config: GuestConsoleConfig | undefined): string | null {
  const vga = String(config?.vga ?? '')
  const type = vga.split(',')[0]?.replace(/^type=/, '') ?? ''
  return /^serial[0-3]$/.test(type) ? type : null
}

/** VGA types that offer SPICE (used when status.spice is not available). */
export function vgaIsSpice(config: GuestConsoleConfig | undefined): boolean {
  const vga = String(config?.vga ?? '')
  const type = vga.split(',')[0]?.replace(/^type=/, '') ?? ''
  return /^qxl[234]?$/.test(type) || type === 'virtio-gl' || type === 'virtio'
}

export function consoleCapabilities(
  target: ConsoleTarget,
  status?: Pick<GuestConsoleStatus, 'spice' | 'serial'>,
  config?: GuestConsoleConfig,
): ConsoleCapabilities {
  if (target.kind !== 'qemu') return { viewers: ['xterm', 'novnc'], spice: true }
  const ports = serialPorts(config)
  const display = serialDisplay(config)
  const serial = display ?? ports[0]
  const hasSerial = !!serial || status?.serial === 1
  const viewers: ConsoleViewer[] = hasSerial ? ['novnc', 'xterm'] : ['novnc']
  const spice = status?.spice !== undefined ? status.spice === 1 : vgaIsSpice(config)
  return { viewers, spice, serial }
}

export function defaultViewer(target: ConsoleTarget, caps: ConsoleCapabilities, config?: GuestConsoleConfig): ConsoleViewer {
  if (target.kind === 'qemu') return serialDisplay(config) && caps.viewers.includes('xterm') ? 'xterm' : 'novnc'
  return 'xterm'
}

/** A viewer, or SPICE (download a .vv file for remote-viewer). */
export type ConsoleChoice = ConsoleViewer | 'spice'

/**
 * The datacenter default console (/cluster/options `console`: html5, xtermjs,
 * vv) for this target, with the official fallbacks (PVE.Utils.defaultViewer):
 * xtermjs without a serial terminal → SPICE if possible, else noVNC; vv
 * without SPICE → xterm.js if possible, else noVNC. null when not set.
 */
export function datacenterViewer(option: string | null | undefined, caps: ConsoleCapabilities): ConsoleChoice | null {
  const xterm = caps.viewers.includes('xterm')
  switch (option) {
    case 'html5':
      return 'novnc'
    case 'xtermjs':
      return xterm ? 'xterm' : caps.spice ? 'spice' : 'novnc'
    case 'vv':
      return caps.spice ? 'spice' : xterm ? 'xterm' : 'novnc'
    default:
      return null
  }
}

function pickable(caps: ConsoleCapabilities, ...choices: (string | null | undefined)[]): ConsoleViewer | null {
  for (const v of choices) {
    if ((v === 'xterm' || v === 'novnc') && caps.viewers.includes(v)) return v
  }
  return null
}

/**
 * Pick the viewer: the requested one if supported, else the remembered one,
 * else the datacenter default, else ours. (A SPICE datacenter default shows
 * our default here; see opensSpiceByDefault.)
 */
export function chooseViewer(
  target: ConsoleTarget,
  caps: ConsoleCapabilities,
  config: GuestConsoleConfig | undefined,
  requested?: string | null,
  remembered?: string | null,
  datacenterDefault?: string | null,
): ConsoleViewer {
  const dc = datacenterViewer(datacenterDefault, caps)
  return pickable(caps, requested, remembered, dc) ?? defaultViewer(target, caps, config)
}

/** The datacenter default is SPICE (vv) and nothing more specific was asked for or remembered. */
export function opensSpiceByDefault(
  caps: ConsoleCapabilities,
  requested: string | null | undefined,
  remembered: string | null | undefined,
  datacenterDefault: string | null | undefined,
): boolean {
  return !pickable(caps, requested, remembered) && datacenterViewer(datacenterDefault, caps) === 'spice'
}

// ------------------------------------------------------------ preferences

const VIEWER_PREF_KEY = 'tiller:console-viewer'
const FONT_PREF_KEY = 'tiller:console-font-size'
const SPICE_PROXY_KEY = 'tiller:spice-proxy'

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode / quota: preferences are optional
  }
}

/** Remembered viewer per target kind ("qemu", "lxc", "node"). */
export function rememberedViewer(kind: ConsoleTarget['kind']): string | null {
  return readJson<Record<string, string>>(VIEWER_PREF_KEY)?.[kind] ?? null
}

export function rememberViewer(kind: ConsoleTarget['kind'], viewer: ConsoleViewer) {
  writeJson(VIEWER_PREF_KEY, { ...readJson<Record<string, string>>(VIEWER_PREF_KEY), [kind]: viewer })
}

export const FONT_SIZE = { min: 9, max: 28, default: 14, mobile: 12 } as const

export function clampFontSize(n: number): number {
  return Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(n)))
}

export function storedFontSize(): number | null {
  const n = readJson<number>(FONT_PREF_KEY)
  return typeof n === 'number' && Number.isFinite(n) ? clampFontSize(n) : null
}

export function storeFontSize(n: number) {
  writeJson(FONT_PREF_KEY, clampFontSize(n))
}

/** Optional SPICE proxy host (default: PVE picks the node). */
export function storedSpiceProxy(): string {
  return readJson<string>(SPICE_PROXY_KEY) ?? ''
}

export function storeSpiceProxy(v: string) {
  writeJson(SPICE_PROXY_KEY, v.trim())
}

/** Zoom limits for the noVNC view (1 = fit the frame). */
export const VNC_ZOOM = { min: 1, max: 4 } as const

export function clampZoom(z: number): number {
  return Math.min(VNC_ZOOM.max, Math.max(VNC_ZOOM.min, z))
}
