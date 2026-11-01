import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  consoleApiBase,
  fetchSpiceConfig,
  sendQemuKey,
  spiceFileContent,
  spiceFileName,
  startTermProxy,
  startVncProxy,
  targetKey,
  targetLabel,
  vncPassword,
  vncWebsocketUrl,
  type ConsoleTarget,
} from '@/api/console'

import {
  applyTerminalModifiers,
  charToVncKey,
  ctrlChar,
  domKeyToSpecial,
  KEYSYM,
  NO_MODIFIERS,
  normalizeQemuKey,
  terminalKeySequence,
  vncComboEvents,
  vncSpecialKey,
  vncTextEvents,
} from './keys'
import { describeConsoleError } from './session'
import { authMessage, inputMessage, parseHandshake, resizeMessage, utf8Length } from './termproto'
import { withAlpha, xtermTheme } from './termTheme'
import {
  chooseViewer,
  clampFontSize,
  clampZoom,
  consoleCapabilities,
  defaultViewer,
  serialDisplay,
  serialPorts,
  vgaIsSpice,
} from './viewers'

const node: ConsoleTarget = { kind: 'node', node: 'pve-lab' }
const vm: ConsoleTarget = { kind: 'qemu', node: 'pve-lab', vmid: 100 }
const ct: ConsoleTarget = { kind: 'lxc', node: 'pve-lab', vmid: 200 }
const mods = (m: Partial<typeof NO_MODIFIERS>) => ({ ...NO_MODIFIERS, ...m })

describe('termproxy protocol', () => {
  it('counts UTF-8 bytes like unescape(encodeURIComponent(s)).length', () => {
    for (const s of ['', 'ls -la\r', 'é', '中文', '😀', 'a😀b中']) {
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length)
    }
  })

  it('frames input, resize and auth', () => {
    expect(inputMessage('ls\r')).toBe('0:3:ls\r')
    expect(inputMessage('中')).toBe('0:3:中')
    expect(resizeMessage(80.7, 24)).toBe('1:80:24:')
    expect(resizeMessage(0, 0)).toBe('1:1:1:')
    expect(authMessage('root@pam', 'PVEVNC:abc')).toBe('root@pam:PVEVNC:abc\n')
  })

  it('accepts the OK handshake and keeps the output after it', () => {
    const rest = parseHandshake(new TextEncoder().encode('OKhello'))
    expect(rest && new TextDecoder().decode(rest)).toBe('hello')
    expect(parseHandshake(new TextEncoder().encode('OK'))?.length).toBe(0)
    expect(parseHandshake(new TextEncoder().encode('NO'))).toBeNull()
    expect(parseHandshake(new Uint8Array([0x4f]))).toBeNull()
  })
})

describe('terminal keys', () => {
  it('sends xterm sequences for cursor keys (normal and application mode)', () => {
    expect(terminalKeySequence('ArrowUp')).toBe('\x1b[A')
    expect(terminalKeySequence('ArrowLeft', NO_MODIFIERS, true)).toBe('\x1bOD')
    expect(terminalKeySequence('ArrowRight', mods({ ctrl: true }))).toBe('\x1b[1;5C')
    expect(terminalKeySequence('Home', mods({ shift: true }))).toBe('\x1b[1;2H')
    expect(terminalKeySequence('End')).toBe('\x1b[F')
  })

  it('sends tilde and SS3 sequences', () => {
    expect(terminalKeySequence('PageUp')).toBe('\x1b[5~')
    expect(terminalKeySequence('Delete', mods({ alt: true }))).toBe('\x1b[3;3~')
    expect(terminalKeySequence('F1')).toBe('\x1bOP')
    expect(terminalKeySequence('F4', mods({ ctrl: true }))).toBe('\x1b[1;5S')
    expect(terminalKeySequence('F5')).toBe('\x1b[15~')
    expect(terminalKeySequence('F12')).toBe('\x1b[24~')
  })

  it('handles Esc, Tab, Enter, Backspace', () => {
    expect(terminalKeySequence('Escape')).toBe('\x1b')
    expect(terminalKeySequence('Tab')).toBe('\t')
    expect(terminalKeySequence('Tab', mods({ shift: true }))).toBe('\x1b[Z')
    expect(terminalKeySequence('Enter', mods({ alt: true }))).toBe('\x1b\r')
    expect(terminalKeySequence('Backspace')).toBe('\x7f')
    expect(terminalKeySequence('Backspace', mods({ ctrl: true }))).toBe('\x08')
  })

  it('maps Ctrl+char to control characters', () => {
    expect(ctrlChar('c')).toBe('\x03')
    expect(ctrlChar('C')).toBe('\x03')
    expect(ctrlChar('[')).toBe('\x1b')
    expect(ctrlChar('@')).toBe('\x00')
    expect(ctrlChar('?')).toBe('\x7f')
    expect(ctrlChar('1')).toBeNull()
    expect(ctrlChar('ab')).toBeNull()
  })

  it('applies sticky modifiers to a single typed character only', () => {
    expect(applyTerminalModifiers('c', mods({ ctrl: true }))).toBe('\x03')
    expect(applyTerminalModifiers('x', mods({ alt: true }))).toBe('\x1bx')
    expect(applyTerminalModifiers('d', mods({ ctrl: true, alt: true }))).toBe('\x1b\x04')
    expect(applyTerminalModifiers('hello', mods({ ctrl: true }))).toBe('hello')
    expect(applyTerminalModifiers('c', NO_MODIFIERS)).toBe('c')
    expect(applyTerminalModifiers('1', mods({ ctrl: true }))).toBe('1')
  })

  it('maps hardware key names', () => {
    expect(domKeyToSpecial('ArrowDown')).toBe('ArrowDown')
    expect(domKeyToSpecial('F10')).toBe('F10')
    expect(domKeyToSpecial('a')).toBeNull()
    expect(domKeyToSpecial('Shift')).toBeNull()
  })
})

describe('VNC keys', () => {
  it('gives keysyms and US codes for characters', () => {
    expect(charToVncKey('a')).toEqual({ keysym: 0x61, code: 'KeyA', shift: false })
    expect(charToVncKey('A')).toEqual({ keysym: 0x41, code: 'KeyA', shift: true })
    expect(charToVncKey('7')).toEqual({ keysym: 0x37, code: 'Digit7', shift: false })
    expect(charToVncKey('&')).toEqual({ keysym: 0x26, code: 'Digit7', shift: true })
    expect(charToVncKey('/')).toEqual({ keysym: 0x2f, code: 'Slash', shift: false })
    expect(charToVncKey('\n')).toMatchObject({ keysym: KEYSYM.Return, code: 'Enter' })
    expect(charToVncKey('é')).toEqual({ keysym: 0xe9, code: undefined, shift: false })
    expect(charToVncKey('中')).toEqual({ keysym: 0x1000000 | 0x4e2d, code: undefined, shift: false })
  })

  it('wraps a key in its modifiers, released in reverse order', () => {
    const ev = vncComboEvents(vncSpecialKey('Delete'), mods({ ctrl: true, alt: true }))
    expect(ev.map((e) => [e.keysym, e.down])).toEqual([
      [KEYSYM.Control_L, true],
      [KEYSYM.Alt_L, true],
      [KEYSYM.Delete, true],
      [KEYSYM.Delete, false],
      [KEYSYM.Alt_L, false],
      [KEYSYM.Control_L, false],
    ])
    expect(vncComboEvents(vncSpecialKey('F2')).map((e) => e.keysym)).toEqual([0xffbf, 0xffbf])
  })

  it('types text with Shift where the US layout needs it', () => {
    const ev = vncTextEvents('aB\r\n')
    expect(ev.map((e) => `${e.code}${e.down ? '↓' : '↑'}`)).toEqual([
      'KeyA↓',
      'KeyA↑',
      'ShiftLeft↓',
      'KeyB↓',
      'KeyB↑',
      'ShiftLeft↑',
      'Enter↓',
      'Enter↑',
    ])
  })

  it('normalizes QEMU sendkey combinations', () => {
    expect(normalizeQemuKey('Ctrl + Alt + Del')).toBe('ctrl-alt-delete')
    expect(normalizeQemuKey('ctrl-alt-f2')).toBe('ctrl-alt-f2')
    expect(normalizeQemuKey('Win')).toBe('meta_l')
    expect(normalizeQemuKey('shift tab')).toBe('shift-tab')
    expect(normalizeQemuKey('ctrl--x')).toBeNull()
    expect(normalizeQemuKey('rm -rf;')).toBeNull()
  })
})

describe('viewers', () => {
  it('finds socket serial ports and serial displays', () => {
    expect(serialPorts({ serial0: 'socket', serial1: '/dev/ttyS0', serial2: 'socket' })).toEqual(['serial0', 'serial2'])
    expect(serialPorts(undefined)).toEqual([])
    expect(serialDisplay({ vga: 'serial0' })).toBe('serial0')
    expect(serialDisplay({ vga: 'type=serial1,memory=16' })).toBe('serial1')
    expect(serialDisplay({ vga: 'std' })).toBeNull()
    expect(vgaIsSpice({ vga: 'qxl' })).toBe(true)
    expect(vgaIsSpice({ vga: 'qxl2,memory=32' })).toBe(true)
    expect(vgaIsSpice({ vga: 'std' })).toBe(false)
  })

  it('offers noVNC for VMs and xterm.js only with a serial port', () => {
    expect(consoleCapabilities(vm, { spice: 0, serial: 0 }, {})).toEqual({ viewers: ['novnc'], spice: false, serial: undefined })
    expect(consoleCapabilities(vm, { spice: 1, serial: 1 }, { serial0: 'socket' })).toEqual({
      viewers: ['novnc', 'xterm'],
      spice: true,
      serial: 'serial0',
    })
    // vga=serial1 wins over the first serial port
    expect(consoleCapabilities(vm, undefined, { serial0: 'socket', serial1: 'socket', vga: 'serial1' }).serial).toBe('serial1')
    // without status, SPICE follows the display type
    expect(consoleCapabilities(vm, undefined, { vga: 'qxl' }).spice).toBe(true)
    expect(consoleCapabilities(ct)).toEqual({ viewers: ['xterm', 'novnc'], spice: true })
    expect(consoleCapabilities(node).viewers).toEqual(['xterm', 'novnc'])
  })

  it('defaults to noVNC for VMs (xterm.js for serial displays) and xterm.js otherwise', () => {
    const plain = consoleCapabilities(vm, { serial: 1 }, { serial0: 'socket' })
    expect(defaultViewer(vm, plain, { serial0: 'socket' })).toBe('novnc')
    const cfg = { serial0: 'socket', vga: 'serial0' }
    expect(defaultViewer(vm, consoleCapabilities(vm, { serial: 1 }, cfg), cfg)).toBe('xterm')
    expect(defaultViewer(ct, consoleCapabilities(ct))).toBe('xterm')
    expect(defaultViewer(node, consoleCapabilities(node))).toBe('xterm')
  })

  it('prefers the requested, then the remembered viewer when supported', () => {
    const caps = consoleCapabilities(vm, { serial: 0 }, {})
    expect(chooseViewer(vm, caps, {}, 'xterm', 'xterm')).toBe('novnc')
    expect(chooseViewer(ct, consoleCapabilities(ct), undefined, 'novnc', 'xterm')).toBe('novnc')
    expect(chooseViewer(ct, consoleCapabilities(ct), undefined, null, 'novnc')).toBe('novnc')
    expect(chooseViewer(ct, consoleCapabilities(ct), undefined, 'bogus', null)).toBe('xterm')
  })

  it('clamps font size and zoom', () => {
    expect(clampFontSize(3)).toBe(9)
    expect(clampFontSize(15.6)).toBe(16)
    expect(clampFontSize(99)).toBe(28)
    expect(clampZoom(0.5)).toBe(1)
    expect(clampZoom(9)).toBe(4)
  })
})

describe('console API helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('builds API paths, keys and labels', () => {
    expect(consoleApiBase(node)).toBe('/nodes/pve-lab')
    expect(consoleApiBase(vm)).toBe('/nodes/pve-lab/qemu/100')
    expect(consoleApiBase({ kind: 'lxc', node: 'a b', vmid: 7 })).toBe('/nodes/a%20b/lxc/7')
    expect(targetKey(node)).toBe('node:pve-lab')
    expect(targetKey(ct)).toBe('lxc:200')
    expect(targetLabel(vm)).toBe('VM 100')
    expect(targetLabel(ct)).toBe('CT 200')
    expect(targetLabel(node)).toBe('节点 pve-lab')
  })

  it('builds the vncwebsocket URL on the current origin with an encoded ticket', () => {
    const t = { port: 5900, ticket: 'PVEVNC:6F2A::abc/+=' }
    expect(vncWebsocketUrl(vm, t, { protocol: 'https:', host: 'pve.example:8443' })).toBe(
      'wss://pve.example:8443/api2/json/nodes/pve-lab/qemu/100/vncwebsocket?port=5900&vncticket=PVEVNC%3A6F2A%3A%3Aabc%2F%2B%3D',
    )
    expect(vncWebsocketUrl(node, t, { protocol: 'http:', host: '192.168.0.32:8103' })).toMatch(
      /^ws:\/\/192\.168\.0\.32:8103\/api2\/json\/nodes\/pve-lab\/vncwebsocket\?port=5900&/,
    )
  })

  it('uses the generated VNC password when PVE returns one', () => {
    expect(vncPassword({ user: 'u', ticket: 'T', port: 1, upid: 'x' })).toBe('T')
    expect(vncPassword({ user: 'u', ticket: 'T', port: 1, upid: 'x', password: 'P' })).toBe('P')
  })

  it('renders .vv files like the official UI', () => {
    expect(spiceFileContent({ type: 'spice', host: 'pvespiceproxy:abc', 'tls-port': 61000, proxy: 'http://pve:3128' })).toBe(
      '[virt-viewer]\ntype=spice\nhost=pvespiceproxy:abc\ntls-port=61000\nproxy=http://pve:3128\n',
    )
    expect(spiceFileName(vm)).toBe('pve-spice-100.vv')
    expect(spiceFileName(node)).toBe('pve-spice-pve-lab.vv')
  })

  it('posts the right endpoints and params', async () => {
    const calls: { url: string; method: string; body: string }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, method: init.method ?? 'GET', body: String(init.body ?? '') })
        return new Response(JSON.stringify({ data: { port: 5900, ticket: 't', user: 'root@pam', upid: 'u' } }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    await startTermProxy(node)
    await startTermProxy(vm, { serial: 'serial1' })
    await startTermProxy(ct, { serial: 'serial0' })
    await startVncProxy(vm, { width: 800, height: 600 })
    await startVncProxy(ct, { width: 800, height: 600 })
    await startVncProxy(node, { width: 640, height: 480 })
    await fetchSpiceConfig(vm, ' 10.0.0.1 ')
    await fetchSpiceConfig(node)
    await sendQemuKey('pve-lab', 100, 'ctrl-alt-delete')
    expect(calls.map((c) => `${c.method} ${c.url} ${c.body}`)).toEqual([
      'POST /api2/json/nodes/pve-lab/termproxy ',
      'POST /api2/json/nodes/pve-lab/qemu/100/termproxy serial=serial1',
      'POST /api2/json/nodes/pve-lab/lxc/200/termproxy ',
      'POST /api2/json/nodes/pve-lab/qemu/100/vncproxy websocket=1',
      'POST /api2/json/nodes/pve-lab/lxc/200/vncproxy websocket=1&width=800&height=600',
      'POST /api2/json/nodes/pve-lab/vncshell websocket=1&width=640&height=480',
      'POST /api2/json/nodes/pve-lab/qemu/100/spiceproxy proxy=10.0.0.1',
      'POST /api2/json/nodes/pve-lab/spiceshell ',
      'PUT /api2/json/nodes/pve-lab/qemu/100/sendkey key=ctrl-alt-delete',
    ])
  })
})

describe('misc', () => {
  it('describes console errors in Chinese', () => {
    expect(describeConsoleError(new Error("VM 100 not running"))).toBe('客户机没有运行')
    expect(describeConsoleError(new Error('Permission check failed (/vms/100, VM.Console)'))).toMatch(/没有打开控制台的权限/)
    expect(describeConsoleError('x')).toBe('无法连接控制台')
  })

  it('builds xterm themes with the accent colour', () => {
    expect(withAlpha('#8b93ff', 0.5)).toBe('rgba(139, 147, 255, 0.5)')
    expect(withAlpha('oklch(1 0 0)', 0.5)).toBe('oklch(1 0 0)')
    const t = xtermTheme('paper', '#d97757')
    expect(t.cursor).toBe('#d97757')
    expect(t.background).toBe('#fffefb')
    expect(t.selectionBackground).toBe('rgba(217, 119, 87, 0.28)')
  })
})
