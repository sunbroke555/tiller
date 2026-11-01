// Pure logic of the users / groups / tokens / TFA screens (form → API params,
// display helpers). Rules follow the official UI (pvemanagerlib.js
// PVE.dc.UserEdit / UserView / TokenEdit / TokenView, proxmoxlib.js TfaView).

import type { Params } from '@/api/client'
import type { ApiToken, TfaUser, UserConfig, UserEntry } from '@/api/access-users'
import type { TfaEntry, TfaType } from '@/api/shell'

// ------------------------------------------------------------- user ids

/** "alice@pve" → { name: "alice", realm: "pve" } (the realm is after the last "@"). */
export function splitUserid(userid: string): { name: string; realm: string } {
  const at = userid.lastIndexOf('@')
  return at > 0 ? { name: userid.slice(0, at), realm: userid.slice(at + 1) } : { name: userid, realm: '' }
}

/** "alice@pve!ci" → { userid: "alice@pve", tokenid: "ci" }. */
export function splitTokenid(full: string): { userid: string; tokenid: string } {
  const bang = full.indexOf('!')
  return bang > 0 ? { userid: full.slice(0, bang), tokenid: full.slice(bang + 1) } : { userid: full, tokenid: '' }
}

/** PVE user names: no whitespace, ":" or "@"… the API checks the full rule; catch the common mistakes here. */
export function userNameError(name: string): string | undefined {
  const n = name.trim()
  if (!n) return undefined
  if (n.includes('@')) return '只填用户名，认证域在右边选择'
  if (/[\s:/]/.test(n)) return '不能包含空格、冒号或斜杠'
  if (n.length > 60) return '最多 60 个字符'
  return undefined
}

/** Token ids: letter first, then letters, digits, "-", "_", "." (pve-tokenid format). */
export function tokenIdError(id: string): string | undefined {
  if (!id) return undefined
  if (id.length < 2) return '至少 2 个字符'
  if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(id)) return '以字母开头，只能包含字母、数字、“-”“_”“.”'
  return undefined
}

export function groupIdError(id: string): string | undefined {
  if (!id) return undefined
  if (!/^[A-Za-z0-9.\-_]+$/.test(id)) return '只能包含字母、数字、“-”“_”“.”'
  return undefined
}

const EMAIL_RE = /^[\w+~-]+(\.[\w+~-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/

export function emailError(email: string): string | undefined {
  const e = email.trim()
  return e && !EMAIL_RE.test(e) ? '邮箱格式不正确' : undefined
}

/** Realm types whose passwords PVE can change (authSchema[type].pwchange). */
export function canSetPassword(realmType: string | undefined): boolean {
  return realmType === 'pve' || realmType === 'pam' || realmType === 'ldap' || realmType === 'ad'
}

export const USER_PASSWORD_MIN = 8

// ---------------------------------------------------------------- expire

/** Epoch seconds → "YYYY-MM-DD" (local) for <input type="date">; 0/undefined → "". */
export function expireToDate(expire: number | undefined): string {
  if (!expire) return ''
  const d = new Date(expire * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "YYYY-MM-DD" → epoch seconds at local midnight (like the official date field); "" → 0 (never). */
export function dateToExpire(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!m) return 0
  return Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000)
}

export type ExpireState = { kind: 'never' } | { kind: 'expired'; date: string } | { kind: 'soon' | 'later'; date: string }

/** Expiry for badges: expired, within 14 days, later, never. */
export function expireState(expire: number | undefined, nowMs = Date.now()): ExpireState {
  if (!expire) return { kind: 'never' }
  const date = expireToDate(expire)
  const left = expire * 1000 - nowMs
  if (left <= 0) return { kind: 'expired', date }
  return { kind: left < 14 * 86400_000 ? 'soon' : 'later', date }
}

export function expireLabel(expire: number | undefined, nowMs = Date.now()): string {
  const s = expireState(expire, nowMs)
  if (s.kind === 'never') return '永不过期'
  if (s.kind === 'expired') return `已于 ${s.date} 过期`
  return `${s.date} 到期`
}

// ------------------------------------------------------------------ users

export interface UserForm {
  /** Name without realm when creating; the full id when editing. */
  name: string
  realm: string
  password: string
  confirm: string
  groups: string[]
  expire: string
  enable: boolean
  firstname: string
  lastname: string
  email: string
  comment: string
  keys: string
}

export function emptyUserForm(realm = 'pve'): UserForm {
  return {
    name: '',
    realm,
    password: '',
    confirm: '',
    groups: [],
    expire: '',
    enable: true,
    firstname: '',
    lastname: '',
    email: '',
    comment: '',
    keys: '',
  }
}

/** "x", "x!oath", "x!u2f", "x!yubico": TFA markers, not Yubico key ids (the official UI disables the field). */
export function isTfaMarker(keys: string | undefined): boolean {
  return keys === 'x' || keys === 'x!oath' || keys === 'x!u2f' || keys === 'x!yubico'
}

export function userFormFromConfig(userid: string, c: UserConfig): UserForm {
  return {
    ...emptyUserForm(splitUserid(userid).realm),
    name: userid,
    groups: [...(c.groups ?? [])].sort(),
    expire: expireToDate(c.expire),
    enable: c.enable !== 0,
    firstname: c.firstname ?? '',
    lastname: c.lastname ?? '',
    email: c.email ?? '',
    comment: c.comment ?? '',
    keys: isTfaMarker(c.keys) ? '' : (c.keys ?? ''),
  }
}

export function validateUserForm(f: UserForm, create: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  if (create) {
    const nameErr = userNameError(f.name)
    if (nameErr) errors.userid = nameErr
    if (f.realm === 'pve') {
      if (f.password && f.password.length < USER_PASSWORD_MIN) errors.password = `至少 ${USER_PASSWORD_MIN} 个字符`
      if (f.confirm && f.confirm !== f.password) errors.confirm = '两次输入的密码不一致'
    }
  }
  const mail = emailError(f.email)
  if (mail) errors.email = mail
  if (f.keys && !/^[0-9a-zA-Z!=,;]*$/.test(f.keys)) errors.keys = '只能包含字母、数字和 ! = , ;'
  return errors
}

export function userFormReady(f: UserForm, create: boolean): boolean {
  if (Object.keys(validateUserForm(f, create)).length) return false
  if (!create) return true
  if (!f.name.trim() || !f.realm) return false
  // pve realm: a password is optional in the API, but the official form requires it.
  if (f.realm === 'pve') return f.password.length >= USER_PASSWORD_MIN && f.confirm === f.password
  return true
}

/** POST /access/users: like the official form, empty text fields are left out. */
export function createUserParams(f: UserForm): Params {
  const params: Params = {
    userid: `${f.name.trim()}@${f.realm}`,
    enable: f.enable ? 1 : 0,
    expire: dateToExpire(f.expire),
  }
  if (f.realm === 'pve' && f.password) params.password = f.password
  if (f.groups.length) params.groups = [...f.groups].sort().join(',')
  for (const k of ['firstname', 'lastname', 'email', 'comment', 'keys'] as const) {
    const v = f[k].trim()
    if (v) params[k] = v
  }
  return params
}

/**
 * PUT /access/users/{userid}: only what changed (the API has no digest and no
 * `delete`; an empty string clears a text field, groups="" removes all groups).
 * null when nothing changed.
 */
export function updateUserParams(before: UserForm, after: UserForm): Params | null {
  const params: Params = {}
  if (after.enable !== before.enable) params.enable = after.enable ? 1 : 0
  if (after.expire !== before.expire) params.expire = dateToExpire(after.expire)
  const g1 = [...before.groups].sort().join(',')
  const g2 = [...after.groups].sort().join(',')
  if (g1 !== g2) params.groups = g2
  for (const k of ['firstname', 'lastname', 'email', 'comment', 'keys'] as const) {
    if (after[k].trim() !== before[k].trim()) params[k] = after[k].trim()
  }
  return Object.keys(params).length ? params : null
}

export function fullName(u: Pick<UserEntry, 'firstname' | 'lastname'>): string {
  return [u.firstname, u.lastname].filter((s) => s?.trim()).join(' ')
}

export function userGroups(u: Pick<UserEntry, 'groups'>): string[] {
  return (u.groups ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

// -------------------------------------------------------------------- TFA

export type TfaStatus = { kind: 'none' } | { kind: 'on'; label: string } | { kind: 'locked'; until?: number } | { kind: 'totp-locked' }

/** The users list's TFA column (PVE.Utils.render_tfa). */
export function userTfaStatus(u: Pick<UserEntry, 'keys' | 'tfa-locked-until' | 'totp-locked'>, nowMs = Date.now()): TfaStatus {
  const keys = u.keys
  if (!keys) return { kind: 'none' }
  if (keys === 'x!oath') return { kind: 'on', label: 'TOTP' }
  const legacy = /^x!(.+)$/.exec(keys)
  if (legacy) return { kind: 'on', label: legacy[1] === 'yubico' ? 'Yubico' : legacy[1]! }
  const until = u['tfa-locked-until']
  if (until && until * 1000 > nowMs) return { kind: 'locked', until }
  if (u['totp-locked']) return { kind: 'totp-locked' }
  return { kind: 'on', label: '已开启' }
}

/** Unlock is offered when either lock flag is set (official UI). */
export function isTfaLocked(u: Pick<UserEntry, 'tfa-locked-until' | 'totp-locked'>): boolean {
  return !!(u['totp-locked'] || u['tfa-locked-until'])
}

export const TFA_TYPE_LABEL: Record<TfaType, string> = {
  totp: 'TOTP',
  webauthn: 'WebAuthn',
  recovery: '恢复码',
  yubico: 'Yubico OTP',
  u2f: 'U2F',
}

/** An entry is locked when all factors are, or TOTP is and it is a TOTP entry. */
export function tfaEntryLocked(user: Pick<TfaUser, 'tfa-locked-until' | 'totp-locked'>, entry: Pick<TfaEntry, 'type'>, nowMs = Date.now()): boolean {
  const all = (user['tfa-locked-until'] ?? 0) * 1000 > nowMs
  return all || (entry.type === 'totp' && !!user['totp-locked'])
}

/** PUT /access/tfa/{userid}/{id}: description and enable, plus the actor's password. */
export function tfaEditParams(
  before: { description: string; enable: boolean },
  after: { description: string; enable: boolean },
  password: string | undefined,
): Params | null {
  const params: Params = {}
  if (after.description.trim() !== before.description.trim()) params.description = after.description.trim()
  if (after.enable !== before.enable) params.enable = after.enable ? 1 : 0
  if (!Object.keys(params).length) return null
  if (password) params.password = password
  return params
}

// ----------------------------------------------------------------- tokens

export interface TokenRow extends ApiToken {
  userid: string
  /** "user@realm!tokenid". */
  id: string
}

export function tokenRows(users: UserEntry[]): TokenRow[] {
  return users
    .flatMap((u) => (u.tokens ?? []).map((t) => ({ ...t, userid: u.userid, id: `${u.userid}!${t.tokenid}` })))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export interface TokenForm {
  userid: string
  tokenid: string
  privsep: boolean
  expire: string
  comment: string
}

export function emptyTokenForm(userid: string): TokenForm {
  return { userid, tokenid: '', privsep: true, expire: '', comment: '' }
}

export function tokenFormFrom(t: TokenRow): TokenForm {
  return { userid: t.userid, tokenid: t.tokenid, privsep: t.privsep !== 0, expire: expireToDate(t.expire), comment: t.comment ?? '' }
}

/** POST …/token/{tokenid}: the official form always sends privsep and expire (empty date = 0, never). */
export function createTokenParams(f: TokenForm): Params {
  const params: Params = { privsep: f.privsep ? 1 : 0, expire: dateToExpire(f.expire) }
  if (f.comment.trim()) params.comment = f.comment.trim()
  return params
}

/** PUT …/token/{tokenid}: changed fields only; a cleared comment goes to `delete`. */
export function updateTokenParams(before: TokenForm, after: TokenForm): Params | null {
  const params: Params = {}
  if (after.privsep !== before.privsep) params.privsep = after.privsep ? 1 : 0
  if (after.expire !== before.expire) params.expire = dateToExpire(after.expire)
  const c = after.comment.trim()
  if (c !== before.comment.trim()) {
    if (c) params.comment = c
    else params.delete = 'comment'
  }
  return Object.keys(params).length ? params : null
}

/** Token CRUD: your own tokens, or anyone's with User.Modify (TokenView.hasTokenCRUDPermissions). */
export function canManageTokensOf(userid: string, self: string | undefined, userModify: boolean): boolean {
  return userModify || userid === self
}

// ------------------------------------------------------------------ groups

/** Groups for a user after adding/removing one (sorted, comma separated, for PUT groups=). */
export function groupsWith(current: string[], groupid: string, member: boolean): string {
  const set = new Set(current)
  if (member) set.add(groupid)
  else set.delete(groupid)
  return [...set].sort().join(',')
}

// ------------------------------------------------------------- permissions

export interface PermissionRow {
  path: string
  privs: { name: string; propagate: boolean }[]
}

/** GET /access/permissions?userid= → rows sorted by path, privileges by name. */
export function permissionRows(map: Record<string, Record<string, number | boolean>>, filter = ''): PermissionRow[] {
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return Object.entries(map)
    .map(([path, privs]) => ({
      path,
      privs: Object.entries(privs)
        .map(([name, v]) => ({ name, propagate: v === 1 || v === true }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((r) => {
      if (!words.length) return true
      const hay = `${r.path} ${r.privs.map((x) => x.name).join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Case-insensitive match of a user against a search box (id, names, email, groups, comment). */
export function userMatches(u: UserEntry, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [u.userid, u.firstname, u.lastname, u.email, u.groups, u.comment].filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}
