// webauthn, totp and qrcode helpers.
import { describe, expect, it } from 'vitest'

import { encodeQr, qrSvgPath } from './qrcode'
import { base32Encode, groupSecret, randomTotpSecret, totpUri } from './totp'
import {
  assertionToPve,
  attestationToPve,
  base64urlToBytes,
  bytesToBase64url,
  loginRequestOptions,
  registrationOptions,
  webauthnChallengeOf,
} from './webauthn'

const buf = (...b: number[]) => new Uint8Array(b).buffer

describe('webauthn encoding', () => {
  it('round-trips base64url without padding', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255])
    const s = bytesToBase64url(bytes)
    expect(s).not.toMatch(/[+/=]/)
    expect(Array.from(base64urlToBytes(s))).toEqual(Array.from(bytes))
    expect(bytesToBase64url(buf(1, 2, 3))).toBe('AQID')
  })

  it('extracts the login challenge from a !tfa! ticket', () => {
    const challenge = { totp: true, webauthn: { publicKey: { challenge: 'AQID', allowCredentials: [{ id: 'BAUG', type: 'public-key' }], rpId: 'pve.lan' } } }
    const ticket = `PVE:!tfa!${encodeURIComponent(JSON.stringify(challenge))}:6AE5E655::sig`
    const w = webauthnChallengeOf(ticket)!
    expect(w.publicKey.challenge).toBe('AQID')
    const opts = loginRequestOptions(w).publicKey!
    expect(Array.from(new Uint8Array(opts.challenge as ArrayBuffer))).toEqual([1, 2, 3])
    expect(Array.from(new Uint8Array(opts.allowCredentials![0]!.id as ArrayBuffer))).toEqual([4, 5, 6])
    expect(opts.rpId).toBe('pve.lan')
    expect(webauthnChallengeOf('PVE:root@pam:1234::sig')).toBeNull()
    expect(webauthnChallengeOf(`PVE:!tfa!${encodeURIComponent('{"totp":true}')}:1::s`)).toBeNull()
  })

  it('formats the assertion like the official UI', () => {
    const json = JSON.parse(
      assertionToPve(
        { id: 'abc', type: 'public-key', rawId: buf(1), response: { authenticatorData: buf(2), clientDataJSON: buf(3), signature: buf(4) } },
        'CHAL',
      ),
    )
    expect(json).toEqual({
      id: 'abc',
      type: 'public-key',
      challenge: 'CHAL',
      rawId: 'AQ',
      response: { authenticatorData: 'Ag', clientDataJSON: 'Aw', signature: 'BA' },
    })
  })

  it('prepares registration and formats the attestation', () => {
    const { options, challenge } = registrationOptions(
      JSON.stringify({ publicKey: { challenge: 'AQID', user: { id: 'BA', name: 'u', displayName: 'u' }, excludeCredentials: [{ id: 'BQ', type: 'public-key' }], rp: { name: 'pve' } } }),
    )
    expect(challenge).toBe('AQID')
    expect(Array.from(new Uint8Array(options.publicKey!.user.id as ArrayBuffer))).toEqual([4])
    expect(options.publicKey!.excludeCredentials).toHaveLength(1)
    expect(JSON.parse(attestationToPve({ id: 'i', type: 'public-key', rawId: buf(1), response: { attestationObject: buf(2), clientDataJSON: buf(3) } }))).toEqual({
      id: 'i',
      type: 'public-key',
      rawId: 'AQ',
      response: { attestationObject: 'Ag', clientDataJSON: 'Aw' },
    })
  })
})

describe('totp', () => {
  it('base32-encodes (RFC 4648 vectors)', () => {
    const enc = (s: string) => base32Encode(new TextEncoder().encode(s))
    expect(enc('f')).toBe('MY')
    expect(enc('foob')).toBe('MZXW6YQ')
    expect(enc('foobar')).toBe('MZXW6YTBOI')
  })

  it('makes 32-char secrets and otpauth URIs', () => {
    const s = randomTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]{32}$/)
    expect(randomTotpSecret((b) => b.fill(0))).toBe('A'.repeat(32))
    expect(totpUri({ issuer: 'Proxmox - pve', account: 'root@pam', secret: 'ABC' })).toBe(
      'otpauth://totp/Proxmox%20-%20pve:root%40pam?secret=ABC&period=30&digits=6&algorithm=SHA1&issuer=Proxmox%20-%20pve',
    )
    expect(groupSecret('ABCDEFGHIJ')).toBe('ABCD EFGH IJ')
  })
})

describe('qr code', () => {
  it('picks the smallest version and draws finder patterns', () => {
    const small = encodeQr('hello')
    expect(small.version).toBe(1)
    expect(small.size).toBe(21)
    // Top-left finder: dark 7×7 ring with a dark 3×3 centre.
    const m = small.modules
    expect([m[0]![0], m[0]![6], m[6]![0], m[6]![6], m[3]![3], m[1]![1], m[2]![2]]).toEqual([true, true, true, true, true, false, true])
    // Dark module next to the bottom-left finder.
    expect(m[small.size - 8]![8]).toBe(true)
    const uri = totpUri({ issuer: 'Proxmox - 192.168.0.32', account: 'root@pam', secret: 'A'.repeat(32) })
    expect(encodeQr(uri).version).toBeGreaterThanOrEqual(7)
    expect(qrSvgPath(small).startsWith('M')).toBe(true)
  })
})
