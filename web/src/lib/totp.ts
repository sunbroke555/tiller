// TOTP setup helpers (secret generation and otpauth:// URIs), matching the
// official "Add TOTP" window: 160-bit base32 secret, SHA1, 6 digits, 30 s.

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out
}

/** A random 160-bit secret as 32 base32 characters. */
export function randomTotpSecret(random: (buf: Uint8Array<ArrayBuffer>) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return base32Encode(random(new Uint8Array(20)))
}

export interface TotpUriOptions {
  issuer: string
  account: string
  secret: string
  period?: number
  digits?: number
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512'
}

/** otpauth://totp/<issuer>:<account>?secret=…&period=30&digits=6&algorithm=SHA1&issuer=… */
export function totpUri({ issuer, account, secret, period = 30, digits = 6, algorithm = 'SHA1' }: TotpUriOptions): string {
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}` +
    `?secret=${secret}&period=${period}&digits=${digits}&algorithm=${algorithm}&issuer=${encodeURIComponent(issuer)}`
  )
}

/** "ABCDEFGH…" → "ABCD EFGH …" for reading aloud / typing. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, '$1 ')
}
