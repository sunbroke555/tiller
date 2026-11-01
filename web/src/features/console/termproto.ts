// The termproxy wire protocol (same as /usr/share/pve-xtermjs/main.js):
//
//   client → "<user>:<ticket>\n"           once, right after the socket opened
//   server → "OK" + first output           handshake accepted (else it closes)
//   client → "0:<utf8 byte length>:<data>"  keyboard input
//   client → "1:<cols>:<rows>:"            terminal size
//   client → "2"                           keep-alive (official UI: every 30 s)
//   server → raw terminal output (binary)

export const PING_MESSAGE = '2'
export const PING_INTERVAL_MS = 30_000

/** UTF-8 length of a string without allocating the bytes. */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4
        i++
      } else n += 3
    } else n += 3
  }
  return n
}

export function authMessage(user: string, ticket: string): string {
  return `${user}:${ticket}\n`
}

export function inputMessage(data: string): string {
  return `0:${utf8Length(data)}:${data}`
}

export function resizeMessage(cols: number, rows: number): string {
  return `1:${Math.max(1, Math.floor(cols))}:${Math.max(1, Math.floor(rows))}:`
}

/** First server message: "OK" means the ticket was accepted. Returns the output after it, or null. */
export function parseHandshake(first: Uint8Array): Uint8Array | null {
  if (first.length >= 2 && first[0] === 0x4f && first[1] === 0x4b) return first.subarray(2)
  return null
}
