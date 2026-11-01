// WebAuthn glue for PVE's TFA (login and registration), matching the official
// UI (proxmoxlib.js): PVE sends JSON with base64url byte fields and expects
// the browser's response back as JSON with base64url strings.

export function base64urlToBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function bytesToBase64url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let bin = ''
  for (const b of view) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The `webauthn` member of a login TFA challenge (from the "!tfa!" ticket). */
export interface WebauthnLoginChallenge {
  publicKey: {
    challenge: string
    allowCredentials?: { id: string; type: string; transports?: string[] }[]
    timeout?: number
    rpId?: string
    userVerification?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

/** Pull the WebAuthn challenge out of a "PVE:!tfa!<json>:…" ticket. */
export function webauthnChallengeOf(ticket: string): WebauthnLoginChallenge | null {
  const field = ticket.split(':')[1] ?? ''
  if (!field.startsWith('!tfa!')) return null
  try {
    const parsed = JSON.parse(decodeURIComponent(field.slice(5))) as { webauthn?: unknown }
    const w = parsed.webauthn as WebauthnLoginChallenge | undefined
    return w && typeof w === 'object' && w.publicKey && typeof w.publicKey.challenge === 'string' ? w : null
  } catch {
    return null
  }
}

/** navigator.credentials.get() options for a login challenge. */
export function loginRequestOptions(challenge: WebauthnLoginChallenge, signal?: AbortSignal): CredentialRequestOptions {
  const pk = challenge.publicKey
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...(pk as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64urlToBytes(pk.challenge),
    allowCredentials: (pk.allowCredentials ?? []).map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: base64urlToBytes(c.id),
      type: 'public-key',
    })),
  }
  return signal ? { publicKey, signal } : { publicKey }
}

interface AssertionLike {
  id: string
  type: string
  rawId: ArrayBuffer
  response: { authenticatorData: ArrayBuffer; clientDataJSON: ArrayBuffer; signature: ArrayBuffer }
}

/** The `webauthn:<json>` answer for POST /access/ticket. */
export function assertionToPve(cred: AssertionLike, challenge: string): string {
  return JSON.stringify({
    id: cred.id,
    type: cred.type,
    challenge,
    rawId: bytesToBase64url(cred.rawId),
    response: {
      authenticatorData: bytesToBase64url(cred.response.authenticatorData),
      clientDataJSON: bytesToBase64url(cred.response.clientDataJSON),
      signature: bytesToBase64url(cred.response.signature),
    },
  })
}

/** Registration step 1 returns `challenge`: JSON credential creation options. */
export function registrationOptions(challengeJson: string): { options: CredentialCreationOptions; challenge: string } {
  const creds = JSON.parse(challengeJson) as {
    publicKey: {
      challenge: string
      user: { id: string; name: string; displayName: string }
      excludeCredentials?: { id: string; type: string }[]
      [key: string]: unknown
    }
  }
  const pk = creds.publicKey
  const publicKey = {
    ...(pk as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64urlToBytes(pk.challenge),
    user: { ...pk.user, id: base64urlToBytes(pk.user.id) },
    excludeCredentials: (pk.excludeCredentials ?? []).map((c) => ({ id: base64urlToBytes(c.id), type: 'public-key' as const })),
  } satisfies PublicKeyCredentialCreationOptions
  return { options: { publicKey }, challenge: pk.challenge }
}

interface AttestationLike {
  id: string
  type: string
  rawId: ArrayBuffer
  response: { attestationObject: ArrayBuffer; clientDataJSON: ArrayBuffer }
}

/** The `value` for registration step 2. */
export function attestationToPve(cred: AttestationLike): string {
  return JSON.stringify({
    id: cred.id,
    type: cred.type,
    rawId: bytesToBase64url(cred.rawId),
    response: {
      attestationObject: bytesToBase64url(cred.response.attestationObject),
      clientDataJSON: bytesToBase64url(cred.response.clientDataJSON),
    },
  })
}

/** WebAuthn needs a secure context (HTTPS or localhost) and browser support. */
export function webauthnSupport(): 'ok' | 'insecure' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.isSecureContext) return 'insecure'
  if (!('credentials' in navigator) || typeof window.PublicKeyCredential === 'undefined') return 'unsupported'
  return 'ok'
}

/** User-facing message for a navigator.credentials failure. */
export function webauthnErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  switch (name) {
    case 'NotAllowedError':
      return '操作已取消或超时，请重试。'
    case 'InvalidStateError':
      return '这个安全密钥已经注册过了。'
    case 'SecurityError':
      return '浏览器拒绝了请求：当前网址与数据中心 WebAuthn 设置（ID / Origin）不一致。'
    case 'NotSupportedError':
      return '这个设备不支持所需的安全密钥类型。'
    case 'AbortError':
      return '已取消。'
    default:
      return e instanceof Error && e.message ? e.message : '安全密钥验证失败'
  }
}
