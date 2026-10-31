// Console endpoints (area console): noVNC (vncproxy / vncshell), xterm.js
// (termproxy), SPICE (.vv files) and QEMU sendkey. All consoles connect to
// .../vncwebsocket through the Go proxy with the PVEAuthCookie.
//
//   POST /nodes/{node}/termproxy                 node shell (xterm.js)
//   POST /nodes/{node}/vncshell   websocket=1    node shell (noVNC)
//   POST /nodes/{node}/spiceshell proxy          node shell (.vv)
//   POST /nodes/{node}/{qemu|lxc}/{vmid}/termproxy   (qemu: serial=serialN)
//   POST /nodes/{node}/{qemu|lxc}/{vmid}/vncproxy    websocket=1 (lxc: width/height)
//   POST /nodes/{node}/{qemu|lxc}/{vmid}/spiceproxy  proxy
//   GET  …/vncwebsocket?port=<port>&vncticket=<ticket>
//   PUT  /nodes/{node}/qemu/{vmid}/sendkey key=ctrl-alt-delete

import { useQuery } from '@tanstack/react-query'

import { get, p, post, put } from './client'
import { POLL, queryKeys } from './queries'
import type { GuestType, PveBool } from './types'

/** What a console connects to. */
export type ConsoleTarget = { kind: 'node'; node: string } | { kind: GuestType; node: string; vmid: number }

export type ConsoleViewer = 'xterm' | 'novnc'

/** termproxy result. The ticket is valid for a few seconds: connect at once. */
export interface TermProxyTicket {
  user: string
  ticket: string
  port: number | string
  upid: string
}

/** vncproxy / vncshell result (websocket=1). */
export interface VncProxyTicket extends TermProxyTicket {
  cert?: string
  /** Newer PVE returns a separate VNC password; older ones use the ticket. */
  password?: string
}

/** spiceproxy / spiceshell result: the [virt-viewer] keys of a .vv file. */
export type SpiceConfig = Record<string, string | number>

/** /nodes/{node}[/{type}/{vmid}] */
export function consoleApiBase(target: ConsoleTarget): string {
  return target.kind === 'node' ? p`/nodes/${target.node}` : p`/nodes/${target.node}/${target.kind}/${target.vmid}`
}

/** Stable short id for storage keys and test ids: "node:pve", "qemu:100". */
export function targetKey(target: ConsoleTarget): string {
  return target.kind === 'node' ? `node:${target.node}` : `${target.kind}:${target.vmid}`
}

/** "节点 pve" / "VM 100" / "CT 100". */
export function targetLabel(target: ConsoleTarget): string {
  if (target.kind === 'node') return `节点 ${target.node}`
  return `${target.kind === 'lxc' ? 'CT' : 'VM'} ${target.vmid}`
}

export function startTermProxy(target: ConsoleTarget, opts: { serial?: string | undefined } = {}): Promise<TermProxyTicket> {
  return post<TermProxyTicket>(`${consoleApiBase(target)}/termproxy`, target.kind === 'qemu' ? { serial: opts.serial } : undefined)
}

export function startVncProxy(
  target: ConsoleTarget,
  opts: { width?: number | undefined; height?: number | undefined } = {},
): Promise<VncProxyTicket> {
  // QEMU has a real display; LXC and the node shell run a terminal emulator
  // (vncterm) whose pixel size we choose.
  const size = target.kind === 'qemu' ? {} : { width: opts.width, height: opts.height }
  const path = target.kind === 'node' ? `${consoleApiBase(target)}/vncshell` : `${consoleApiBase(target)}/vncproxy`
  return post<VncProxyTicket>(path, { websocket: 1, ...size })
}

/** The password noVNC sends: the dedicated one when PVE generated it, else the ticket. */
export function vncPassword(t: VncProxyTicket): string {
  return t.password ?? t.ticket
}

/** wss://host/api2/json/…/vncwebsocket?port=…&vncticket=… on the current origin. */
export function vncWebsocketUrl(
  target: ConsoleTarget,
  t: Pick<TermProxyTicket, 'port' | 'ticket'>,
  loc: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  const qs = `port=${encodeURIComponent(String(t.port))}&vncticket=${encodeURIComponent(t.ticket)}`
  return `${scheme}//${loc.host}/api2/json${consoleApiBase(target)}/vncwebsocket?${qs}`
}

export function fetchSpiceConfig(target: ConsoleTarget, proxy?: string): Promise<SpiceConfig> {
  const path = target.kind === 'node' ? `${consoleApiBase(target)}/spiceshell` : `${consoleApiBase(target)}/spiceproxy`
  return post<SpiceConfig>(path, { proxy: proxy?.trim() || undefined })
}

/** Render a .vv file (the official UI does the same). */
export function spiceFileContent(cfg: SpiceConfig): string {
  return Object.entries(cfg).reduce((acc, [k, v]) => `${acc}${k}=${String(v)}\n`, '[virt-viewer]\n')
}

export function spiceFileName(target: ConsoleTarget): string {
  return target.kind === 'node' ? `pve-spice-${target.node}.vv` : `pve-spice-${target.vmid}.vv`
}

/** Fetch a SPICE ticket and hand the browser a .vv file (opened by remote-viewer). */
export async function downloadSpiceFile(target: ConsoleTarget, proxy?: string): Promise<void> {
  const cfg = await fetchSpiceConfig(target, proxy)
  const blob = new Blob([spiceFileContent(cfg)], { type: 'application/x-virt-viewer' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = spiceFileName(target)
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Send a key combination to a VM without opening a console (qemu key names, e.g. "ctrl-alt-delete"). */
export function sendQemuKey(node: string, vmid: number, key: string): Promise<null> {
  return put<null>(p`/nodes/${node}/qemu/${vmid}/sendkey`, { key })
}

// ----------------------------------------------------------------- queries

/** Fields of GET …/status/current the console cares about. */
export interface GuestConsoleStatus {
  status: string
  qmpstatus?: string
  lock?: string
  /** QEMU: the display supports SPICE. */
  spice?: PveBool
  /** QEMU: at least one serial port. */
  serial?: PveBool
  /** QEMU: "vnc" when the VNC clipboard is enabled (vga clipboard=vnc). */
  clipboard?: string
  name?: string
  template?: PveBool
}

/** Config keys the console needs (vga, serialN for QEMU; cmode, entrypoint for LXC). */
export type GuestConsoleConfig = Record<string, string | number | undefined>

export function useGuestConsoleStatus(target: ConsoleTarget, enabled = true) {
  const guest = target.kind === 'node' ? null : target
  return useQuery({
    queryKey: guest ? [...queryKeys.guest(guest.node, guest.kind, guest.vmid), 'console', 'status'] : ['pve', 'none'],
    queryFn: ({ signal }) => get<GuestConsoleStatus>(`${consoleApiBase(target)}/status/current`, undefined, { signal }),
    enabled: enabled && guest !== null,
    refetchInterval: POLL.status,
  })
}

export function useGuestConsoleConfig(target: ConsoleTarget, enabled = true) {
  const guest = target.kind === 'node' ? null : target
  return useQuery({
    queryKey: guest ? [...queryKeys.guest(guest.node, guest.kind, guest.vmid), 'console', 'config'] : ['pve', 'none'],
    queryFn: ({ signal }) => get<GuestConsoleConfig>(`${consoleApiBase(target)}/config`, undefined, { signal }),
    enabled: enabled && guest !== null,
    // A 403 (no VM.Audit) just means we fall back to defaults.
    retry: false,
  })
}

export function startGuest(target: ConsoleTarget): Promise<string> {
  if (target.kind === 'node') throw new Error('节点不能启动')
  return post<string>(`${consoleApiBase(target)}/status/start`)
}

export function resumeGuest(target: ConsoleTarget): Promise<string> {
  if (target.kind === 'node') throw new Error('节点不能恢复')
  return post<string>(`${consoleApiBase(target)}/status/resume`)
}
