// Which console viewers a target supports and which one opens by default.
// Mirrors PVE.Utils.defaultViewer / the console button of the official UI:
// - QEMU: noVNC always; xterm.js only with a serial port (status.serial);
//   SPICE only with a SPICE display (status.spice).
// - LXC and the node shell: xterm.js (default), noVNC and SPICE.
// We default to noVNC for VMs (SPICE needs a desktop client) unless the
// display itself is a serial port (vga=serialN), and to xterm.js otherwise.

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

/** Pick the viewer: the requested one if supported, else the remembered one, else the default. */
export function chooseViewer(
  target: ConsoleTarget,
  caps: ConsoleCapabilities,
  config: GuestConsoleConfig | undefined,
  requested?: string | null,
  remembered?: string | null,
): ConsoleViewer {
  for (const v of [requested, remembered]) {
    if (v === 'xterm' || v === 'novnc') {
      if (caps.viewers.includes(v)) return v
    }
  }
  return defaultViewer(target, caps, config)
}

// ------------------------------------------------------------ preferences

const VIEWER_PREF_KEY = 'pve-web:console-viewer'
const FONT_PREF_KEY = 'pve-web:console-font-size'
const SPICE_PROXY_KEY = 'pve-web:spice-proxy'

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
