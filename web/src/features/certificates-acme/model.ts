// Pure logic of the certificates area: PEM handling, certificate display
// helpers, the node's ACME config (acme / acmedomainN) and ACME account and
// plugin form → API params. Rules follow pvemanagerlib.js / proxmoxlib.js and
// the API schema (pvesh usage … -v) of PVE 9.

import type { Params } from '@/api/client'
import type { AcmeChallengeSchema, AcmePlugin, AcmeSchemaField, CertificateInfo, NodeAcmeConfig } from '@/api/certificates-acme'

// ===================================================================== PEM

export interface PemBlock {
  /** "CERTIFICATE", "PRIVATE KEY", "RSA PRIVATE KEY", … */
  label: string
  /** The whole block including BEGIN/END lines. */
  text: string
}

const PEM_RE = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/g

/** Every PEM block in a text (other text between blocks is ignored). */
export function pemBlocks(text: string): PemBlock[] {
  const out: PemBlock[] = []
  for (const m of text.replace(/\r\n?/g, '\n').matchAll(PEM_RE)) out.push({ label: m[1]!, text: m[0] })
  return out
}

const isKeyLabel = (label: string) => /PRIVATE KEY$/.test(label)
const isCertLabel = (label: string) => label === 'CERTIFICATE' || label === 'TRUSTED CERTIFICATE'

/**
 * Split a file or paste that may hold certificates and a key together (a
 * combined .pem): certificates in their order, the private key separately.
 */
export function splitPem(text: string): { certificates: string; key: string } {
  const blocks = pemBlocks(text)
  const certs = blocks.filter((b) => isCertLabel(b.label)).map((b) => b.text)
  const keys = blocks.filter((b) => isKeyLabel(b.label)).map((b) => b.text)
  return {
    certificates: certs.length ? certs.join('\n') + '\n' : '',
    key: keys.length ? keys.join('\n') + '\n' : '',
  }
}

/** Trimmed text with a single trailing newline ("" stays ""). */
export function normalizePem(text: string): string {
  const t = text.replace(/\r\n?/g, '\n').trim()
  return t ? t + '\n' : ''
}

/** Error text for the certificate chain field, or null when it looks right. */
export function validateCertificateChain(text: string): string | null {
  if (!text.trim()) return '请填写证书链'
  const blocks = pemBlocks(text)
  if (blocks.some((b) => isKeyLabel(b.label))) return '证书链里包含私钥，请把私钥放到“私钥”中'
  if (!blocks.some((b) => isCertLabel(b.label))) return '没有找到 PEM 格式的证书（-----BEGIN CERTIFICATE-----）'
  return null
}

/** Error text for the (optional) private key field, or null. */
export function validatePrivateKey(text: string): string | null {
  if (!text.trim()) return null
  const blocks = pemBlocks(text)
  const keys = blocks.filter((b) => isKeyLabel(b.label))
  if (keys.length === 0) {
    if (blocks.some((b) => isCertLabel(b.label))) return '这里需要私钥，不是证书'
    return '没有找到 PEM 格式的私钥（-----BEGIN PRIVATE KEY-----）'
  }
  if (keys.length > 1) return '只能有一个私钥'
  if (keys[0]!.label === 'ENCRYPTED PRIVATE KEY' || /Proc-Type:\s*4,ENCRYPTED/.test(keys[0]!.text)) {
    return '私钥已加密，PVE 需要未加密的私钥'
  }
  return null
}

/** Number of certificates in a chain text. */
export function countCertificates(text: string): number {
  return pemBlocks(text).filter((b) => isCertLabel(b.label)).length
}

/** POST /nodes/{node}/certificates/custom (force like the official UI). */
export function uploadParams(form: { certificates: string; key: string; restart: boolean }): Params {
  const key = normalizePem(form.key)
  return {
    certificates: normalizePem(form.certificates),
    ...(key ? { key } : {}),
    force: 1,
    restart: form.restart ? 1 : 0,
  }
}

// ====================================================== certificate display

/** Known certificate files of a PVE node. */
export const CERT_FILE_LABEL: Record<string, string> = {
  'pve-root-ca.pem': '集群根 CA',
  'pve-ssl.pem': '节点证书（集群 CA 签发）',
  'pveproxy-ssl.pem': '自定义证书（Web 界面使用）',
}

export const CUSTOM_CERT_FILE = 'pveproxy-ssl.pem'

export function certFileLabel(filename: string): string {
  return CERT_FILE_LABEL[filename] ?? filename
}

/** Which certificate pveproxy serves: the custom/ACME one when present, else pve-ssl. */
export function activeCertificate(certs: readonly CertificateInfo[]): string | undefined {
  if (certs.some((c) => c.filename === CUSTOM_CERT_FILE)) return CUSTOM_CERT_FILE
  if (certs.some((c) => c.filename === 'pve-ssl.pem')) return 'pve-ssl.pem'
  return undefined
}

/** Display order: the active certificate first, the root CA last. */
export function sortCertificates(certs: readonly CertificateInfo[]): CertificateInfo[] {
  const rank = (f: string) => (f === CUSTOM_CERT_FILE ? 0 : f === 'pve-ssl.pem' ? 1 : f === 'pve-root-ca.pem' ? 3 : 2)
  return [...certs].sort((a, b) => rank(a.filename) - rank(b.filename) || a.filename.localeCompare(b.filename))
}

export interface DnPart {
  key: string
  value: string
}

/**
 * Parse a distinguished name: OpenSSL one-line ("/OU=x/O=y/CN=z", what PVE
 * returns) or RFC 2253 ("CN=z, O=y").
 */
export function parseDn(dn: string | undefined): DnPart[] {
  if (!dn) return []
  const s = dn.trim()
  const parts = s.startsWith('/') ? s.slice(1).split(/\/(?=[A-Za-z][\w.-]*=)/) : s.split(/,\s*(?=[A-Za-z][\w.-]*=)/)
  const out: DnPart[] = []
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    out.push({ key: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() })
  }
  return out
}

/** Short name of a DN: its CN, else O, else the raw text. */
export function dnShortName(dn: string | undefined): string {
  const parts = parseDn(dn)
  return parts.find((p) => p.key === 'CN')?.value ?? parts.find((p) => p.key === 'O')?.value ?? dn ?? ''
}

/** Compress an uncompressed IPv6 address ("0000:…:0001" → "::1"); other values unchanged. */
export function compactIpv6(value: string): string {
  if (!/^[0-9a-f]{1,4}(:[0-9a-f]{1,4}){7}$/i.test(value)) return value
  const groups = value.split(':').map((g) => g.replace(/^0+(?=.)/, '').toLowerCase())
  // Longest run of zero groups (length ≥ 2) becomes "::".
  let best = -1
  let bestLen = 0
  for (let i = 0; i < 8; ) {
    if (groups[i] !== '0') {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === '0') j++
    if (j - i > bestLen && j - i >= 2) {
      best = i
      bestLen = j - i
    }
    i = j
  }
  if (best < 0) return groups.join(':')
  return `${groups.slice(0, best).join(':')}::${groups.slice(best + bestLen).join(':')}`
}

export interface SanEntry {
  value: string
  kind: 'dns' | 'ip'
}

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/

/** SAN list for display: numbers dropped (as the official renderer does), IPv6 compacted. */
export function sanEntries(san: CertificateInfo['san']): SanEntry[] {
  if (!Array.isArray(san)) return []
  const out: SanEntry[] = []
  for (const v of san) {
    if (typeof v !== 'string' || !v) continue
    const ip = IPV4.test(v) || v.includes(':')
    out.push({ value: ip ? compactIpv6(v) : v, kind: ip ? 'ip' : 'dns' })
  }
  return out
}

export type ValidityState = 'valid' | 'expiring' | 'expired' | 'notyet' | 'unknown'

export interface Validity {
  state: ValidityState
  /** Whole days until expiry (negative when expired). */
  daysLeft: number | null
  label: string
}

/** Within this many days the certificate counts as expiring (ACME renews at 30). */
export const EXPIRING_DAYS = 30

export function certValidity(cert: Pick<CertificateInfo, 'notbefore' | 'notafter'>, nowMs = Date.now()): Validity {
  const now = nowMs / 1000
  if (typeof cert.notafter !== 'number') return { state: 'unknown', daysLeft: null, label: '有效期未知' }
  const daysLeft = Math.floor((cert.notafter - now) / 86400)
  if (cert.notafter <= now) return { state: 'expired', daysLeft, label: `已过期 ${Math.max(1, -daysLeft)} 天` }
  if (typeof cert.notbefore === 'number' && cert.notbefore > now) return { state: 'notyet', daysLeft, label: '尚未生效' }
  if (daysLeft < EXPIRING_DAYS) return { state: 'expiring', daysLeft, label: daysLeft < 1 ? '今天到期' : `${daysLeft} 天后到期` }
  return { state: 'valid', daysLeft, label: daysLeft >= 730 ? `${Math.floor(daysLeft / 365)} 年后到期` : `${daysLeft} 天后到期` }
}

/** "rsaEncryption 2048" → "RSA 2048 位". */
export function keyTypeLabel(cert: Pick<CertificateInfo, 'public-key-type' | 'public-key-bits'>): string {
  const t = cert['public-key-type']
  const name = !t ? '' : /rsa/i.test(t) ? 'RSA' : /ec|ecdsa|prime256|secp/i.test(t) ? 'ECDSA' : /ed25519/i.test(t) ? 'Ed25519' : t
  const bits = cert['public-key-bits']
  return [name, bits ? `${bits} 位` : ''].filter(Boolean).join(' ') || '—'
}

/** Rough issuer classification for a badge. */
export function issuerKind(cert: Pick<CertificateInfo, 'issuer' | 'subject'>): 'self' | 'pve' | 'acme-staging' | 'acme' | 'other' {
  const issuer = cert.issuer ?? ''
  if (issuer && issuer === cert.subject) return 'self'
  if (/PVE Cluster Manager CA/.test(issuer)) return 'pve'
  if (/STAGING|\(STAGING\)|Fake LE/i.test(issuer)) return 'acme-staging'
  if (/Let's Encrypt|ZeroSSL|Buypass|Google Trust/i.test(issuer)) return 'acme'
  return 'other'
}

// ========================================================== ACME node config

/** Node config holds at most this many DNS-validated domains (acmedomain0..4). */
export const ACME_DOMAIN_SLOTS = 5

export interface AcmeConfig {
  account?: string
  domains: string[]
}

/** Parse node config `acme` ("account=x,domains=a;b"). */
export function parseAcmeConfig(value: string | undefined): AcmeConfig {
  const out: AcmeConfig = { domains: [] }
  if (!value) return out
  for (const part of value.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (key === 'account') out.account = v
    else if (key === 'domains') out.domains = v.split(';').map((d) => d.trim()).filter(Boolean)
  }
  return out
}

/** Back to the property string; null when nothing is left (the key should be deleted). */
export function printAcmeConfig(cfg: AcmeConfig): string | null {
  const parts: string[] = []
  if (cfg.account) parts.push(`account=${cfg.account}`)
  const domains = uniq(cfg.domains.filter(Boolean))
  if (domains.length) parts.push(`domains=${domains.join(';')}`)
  return parts.length ? parts.join(',') : null
}

function uniq(list: string[]): string[] {
  return list.filter((v, i, all) => all.indexOf(v) === i)
}

export type AcmeChallengeType = 'standalone' | 'dns'

export interface AcmeDomainEntry {
  domain: string
  type: AcmeChallengeType
  plugin?: string
  alias?: string
  /** "acme" for HTTP (standalone) domains, "acmedomainN" for DNS ones. */
  configkey: string
}

/** The account the node uses (PVE's default is "default"). */
export function nodeAcmeAccount(config: NodeAcmeConfig | undefined): string {
  return parseAcmeConfig(config?.acme).account ?? 'default'
}

/** Domains of a node: standalone ones from `acme`, then acmedomain0..4. */
export function acmeDomains(config: NodeAcmeConfig | undefined): AcmeDomainEntry[] {
  if (!config) return []
  const out: AcmeDomainEntry[] = parseAcmeConfig(config.acme).domains.map((domain) => ({
    domain,
    type: 'standalone',
    configkey: 'acme',
  }))
  for (let i = 0; i < ACME_DOMAIN_SLOTS; i++) {
    const raw = config[`acmedomain${i}`]
    if (typeof raw !== 'string' || !raw) continue
    const entry: AcmeDomainEntry = { domain: '', type: 'dns', configkey: `acmedomain${i}` }
    for (const part of raw.split(',')) {
      const eq = part.indexOf('=')
      const key = eq < 0 ? 'domain' : part.slice(0, eq).trim()
      const v = eq < 0 ? part.trim() : part.slice(eq + 1).trim()
      if (key === 'domain') entry.domain = v
      else if (key === 'plugin') entry.plugin = v
      else if (key === 'alias') entry.alias = v
    }
    // acmedomainN without a plugin uses the standalone (HTTP) challenge.
    if (!entry.plugin || entry.plugin === 'standalone') {
      entry.type = 'standalone'
      delete entry.plugin
    }
    out.push(entry)
  }
  return out
}

/** Free acmedomainN key, or null when all are used. */
export function freeDomainSlot(config: NodeAcmeConfig | undefined): string | null {
  for (let i = 0; i < ACME_DOMAIN_SLOTS; i++) {
    if (!config?.[`acmedomain${i}`]) return `acmedomain${i}`
  }
  return null
}

// pve-acme-domain / pve-acme-alias (PVE/NodeConfig.pm): at least two labels.
const DOMAIN_RE = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+$/i
const ALIAS_RE = /^[a-z0-9_][a-z0-9_-]*(?:\.[a-z0-9_][a-z0-9_-]*)+$/i

export function validateAcmeDomain(value: string): string | null {
  const v = value.trim()
  if (!v) return '请填写域名'
  if (v.startsWith('*.')) return 'PVE 节点证书不支持通配符域名'
  if (!DOMAIN_RE.test(v)) return '不是有效的域名（例如 pve.example.com）'
  return null
}

export function validateAcmeAlias(value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (!ALIAS_RE.test(v)) return '不是有效的别名域名（例如 _acme-challenge.example.net）'
  return null
}

export interface DomainForm {
  type: AcmeChallengeType
  domain: string
  plugin?: string | undefined
  alias?: string | undefined
}

/**
 * PUT /nodes/{node}/config params for adding (old undefined) or editing a
 * domain. Same moves as PVE.node.ACMEDomainEdit: HTTP domains live in
 * `acme.domains`, DNS ones each in an acmedomainN slot; switching type moves
 * the entry. Throws a readable error when the domain is already configured or
 * no DNS slot is free.
 */
export function domainEditParams(config: NodeAcmeConfig, old: AcmeDomainEntry | undefined, form: DomainForm): Params {
  const domain = form.domain.trim()
  const lower = domain.toLowerCase()
  const others = acmeDomains(config).filter((d) => !(old && d.configkey === old.configkey && d.domain === old.domain))
  if (others.some((d) => d.domain.toLowerCase() === lower)) throw new Error(`域名 ${domain} 已经配置过了`)

  const params: Params = {}
  if (config.digest) params.digest = config.digest
  const acme = parseAcmeConfig(config.acme)
  const deletes: string[] = []

  if (form.type === 'dns') {
    let key = old && old.configkey !== 'acme' ? old.configkey : null
    if (!key) {
      key = freeDomainSlot(config)
      if (!key) throw new Error(`最多只能配置 ${ACME_DOMAIN_SLOTS} 个 DNS 验证的域名`)
      if (old) {
        acme.domains = acme.domains.filter((d) => d !== old.domain)
        setAcme(params, deletes, acme)
      }
    }
    const parts = [`domain=${domain}`]
    if (form.plugin) parts.push(`plugin=${form.plugin}`)
    const alias = form.alias?.trim()
    if (alias) parts.push(`alias=${alias}`)
    params[key] = parts.join(',')
  } else {
    if (old && old.configkey !== 'acme') deletes.push(old.configkey)
    acme.domains = uniq([...acme.domains.filter((d) => d !== old?.domain), domain])
    setAcme(params, deletes, acme)
  }
  if (deletes.length) params.delete = deletes.join(',')
  return params
}

function setAcme(params: Params, deletes: string[], acme: AcmeConfig) {
  const printed = printAcmeConfig(acme)
  if (printed) params.acme = printed
  else deletes.push('acme')
}

/** PUT params removing one domain. */
export function domainRemoveParams(config: NodeAcmeConfig, entry: AcmeDomainEntry): Params {
  const params: Params = {}
  if (config.digest) params.digest = config.digest
  if (entry.configkey !== 'acme') {
    params.delete = entry.configkey
    return params
  }
  const acme = parseAcmeConfig(config.acme)
  acme.domains = acme.domains.filter((d) => d !== entry.domain)
  const printed = printAcmeConfig(acme)
  if (printed) params.acme = printed
  else params.delete = 'acme'
  return params
}

/** PUT params switching the node's ACME account (domains kept). */
export function accountChangeParams(config: NodeAcmeConfig | undefined, account: string): Params {
  const acme = parseAcmeConfig(config?.acme)
  acme.account = account
  const params: Params = { acme: printAcmeConfig(acme)! }
  if (config?.digest) params.digest = config.digest
  return params
}

// ============================================================ ACME accounts

// pve-configid
export const CONFIG_ID_RE = /^[a-z][a-z0-9_-]+$/i

export function validateConfigId(value: string, what: string): string | null {
  if (!value) return null
  if (!CONFIG_ID_RE.test(value)) return `${what}只能包含字母、数字、- 和 _，以字母开头，至少 2 个字符`
  return null
}

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/

export function validateEmail(value: string): string | null {
  const v = value.trim()
  if (!v) return '请填写邮箱'
  if (!EMAIL_RE.test(v)) return '不是有效的邮箱地址'
  return null
}

export const CUSTOM_DIRECTORY = '__custom__'

export interface AccountForm {
  name: string
  contact: string
  /** A known directory URL, or CUSTOM_DIRECTORY. */
  directory: string
  customUrl: string
  tosAccepted: boolean
  eabKid: string
  eabHmacKey: string
}

export interface DirectoryMetaInfo {
  termsOfService?: string | undefined
  eabRequired: boolean
}

/** The directory URL the form points at ("" when none yet). */
export function accountDirectoryUrl(form: Pick<AccountForm, 'directory' | 'customUrl'>): string {
  return form.directory === CUSTOM_DIRECTORY ? form.customUrl.trim() : form.directory
}

/** Field errors of the register form (empty object = valid). */
export function accountFormErrors(
  form: AccountForm,
  meta: DirectoryMetaInfo | undefined,
  opts: { defaultExists: boolean; existing: readonly string[] },
): Partial<Record<'name' | 'contact' | 'directory' | 'tos' | 'eab-kid' | 'eab-hmac-key', string>> {
  const errors: ReturnType<typeof accountFormErrors> = {}
  const name = form.name.trim()
  if (!name && opts.defaultExists) errors.name = '已有名为 default 的账户，请填写名称'
  else if (name) {
    const e = validateConfigId(name, '名称')
    if (e) errors.name = e
    else if (opts.existing.includes(name)) errors.name = `账户 ${name} 已存在`
  }
  const contact = validateEmail(form.contact)
  if (contact) errors.contact = contact
  const url = accountDirectoryUrl(form)
  if (!url) errors.directory = '请选择 ACME 目录'
  else if (!/^https?:\/\//.test(url)) errors.directory = '目录地址以 https:// 开头'
  if (meta?.termsOfService && !form.tosAccepted) errors.tos = '需要同意服务条款'
  const kid = form.eabKid.trim()
  const hmac = form.eabHmacKey.trim()
  if (meta?.eabRequired) {
    if (!kid) errors['eab-kid'] = '这个 CA 要求外部账户绑定（EAB）'
    if (!hmac) errors['eab-hmac-key'] = '这个 CA 要求外部账户绑定（EAB）'
  } else if (!!kid !== !!hmac) {
    if (!kid) errors['eab-kid'] = 'EAB 的 Key ID 和 HMAC 密钥要一起填写'
    else errors['eab-hmac-key'] = 'EAB 的 Key ID 和 HMAC 密钥要一起填写'
  }
  return errors
}

/** POST /cluster/acme/account params. */
export function accountRegisterParams(form: AccountForm, meta: DirectoryMetaInfo | undefined): Params {
  const params: Params = {
    contact: form.contact.trim(),
    directory: accountDirectoryUrl(form),
  }
  const name = form.name.trim()
  if (name) params.name = name
  if (meta?.termsOfService && form.tosAccepted) params.tos_url = meta.termsOfService
  const kid = form.eabKid.trim()
  const hmac = form.eabHmacKey.trim()
  if (kid && hmac) {
    params['eab-kid'] = kid
    params['eab-hmac-key'] = hmac
  }
  return params
}

/** /cluster/acme/meta answer → what the form needs. */
export function directoryMetaInfo(meta: { termsOfService?: string; externalAccountRequired?: unknown } | null | undefined): DirectoryMetaInfo {
  return {
    termsOfService: meta?.termsOfService || undefined,
    eabRequired: !!meta?.externalAccountRequired && meta.externalAccountRequired !== '0',
  }
}

/** "mailto:a@b.c" → "a@b.c". */
export function accountEmail(contact: readonly string[] | undefined): string | undefined {
  const c = contact?.[0]
  return c ? c.replace(/^mailto:/i, '') : undefined
}

export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  valid: '有效',
  deactivated: '已注销',
  revoked: '已吊销',
}

/** Directory URL → its known name ("Let's Encrypt V2 Staging"), else the host. */
export function directoryLabel(url: string | undefined, known: readonly { name: string; url: string }[] = []): string {
  if (!url) return '—'
  const hit = known.find((d) => d.url === url)
  if (hit) return hit.name
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// ============================================================ ACME plugins

export interface PluginDataSplit {
  /** KEY=value pairs (value = everything after the first "="). */
  values: Record<string, string>
  /** Lines without "=" (kept verbatim). */
  extra: string[]
}

/** Split plugin data text into KEY=value pairs. */
export function parsePluginData(data: string | undefined): PluginDataSplit {
  const values: Record<string, string> = {}
  const extra: string[] = []
  for (const line of (data ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) continue
    const eq = line.indexOf('=')
    if (eq > 0) values[line.slice(0, eq).trim()] = line.slice(eq + 1)
    else extra.push(line)
  }
  return { values, extra }
}

export interface SchemaFieldDef {
  key: string
  label: string
  type: 'string' | 'integer' | 'number'
  description?: string
  defaultValue?: string
  optional: boolean
}

/** Form fields of one DNS API, sorted by key like the official dialog. */
export function schemaFields(schema: AcmeChallengeSchema | undefined): SchemaFieldDef[] {
  const fields: Record<string, AcmeSchemaField> = schema?.schema.fields ?? {}
  return Object.entries(fields)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, def]): SchemaFieldDef => ({
      key,
      label: typeof def.name === 'string' && def.name ? def.name : key,
      type: def.type === 'integer' ? 'integer' : def.type === 'number' ? 'number' : 'string',
      ...(def.description ? { description: def.description } : {}),
      ...(def.default !== undefined && def.default !== '' ? { defaultValue: String(def.default) } : {}),
      optional: !!def.optional,
    }))
}

/**
 * Form state for a plugin's data: values of the schema fields, and the rest
 * (unknown keys and loose lines) as the "other data" text.
 */
export function pluginDataToForm(data: string | undefined, fields: readonly SchemaFieldDef[]): { values: Record<string, string>; extra: string } {
  const split = parsePluginData(data)
  const keys = new Set(fields.map((f) => f.key))
  const values: Record<string, string> = {}
  const extra = [...split.extra]
  for (const [k, v] of Object.entries(split.values)) {
    if (keys.has(k)) values[k] = v
    else extra.push(`${k}=${v}`)
  }
  return { values, extra: extra.join('\n') }
}

/** Schema field values + other data → the plain KEY=value text PVE stores. */
export function buildPluginData(fields: readonly SchemaFieldDef[], values: Record<string, string>, extra: string): string {
  const lines: string[] = []
  for (const f of fields) {
    const v = values[f.key]
    if (v !== undefined && v.trim() !== '') lines.push(`${f.key}=${v.trim()}`)
  }
  for (const line of extra.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim()) lines.push(line.trim())
  }
  return lines.length ? lines.join('\n') + '\n' : ''
}

/** UTF-8 safe base64 (the API wants `data` base64 encoded). */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export const DEFAULT_VALIDATION_DELAY = 30
export const MAX_VALIDATION_DELAY = 48 * 60 * 60

export interface PluginForm {
  id: string
  api: string
  /** Seconds; null = default (30). */
  validationDelay: number | null
  /** Data text (see buildPluginData). */
  data: string
  /** Restrict to these nodes; empty = all. */
  nodes: string[]
  disable: boolean
}

/**
 * POST (create) or PUT (edit) /cluster/acme/plugins params. On edit, cleared
 * options go to `delete` and the digest guards against concurrent changes.
 */
export function pluginParams(form: PluginForm, original?: AcmePlugin): Params {
  const params: Params = { api: form.api, data: base64Utf8(form.data) }
  const delay = form.validationDelay
  const hasDelay = delay !== null && delay !== DEFAULT_VALIDATION_DELAY
  const nodes = form.nodes.join(',')
  if (!original) {
    params.id = form.id.trim()
    params.type = 'dns'
    if (hasDelay) params['validation-delay'] = delay
    if (nodes) params.nodes = nodes
    if (form.disable) params.disable = 1
    return params
  }
  const deletes: string[] = []
  if (hasDelay) params['validation-delay'] = delay
  else if (original['validation-delay'] !== undefined) deletes.push('validation-delay')
  if (nodes) params.nodes = nodes
  else if (original.nodes) deletes.push('nodes')
  if (form.disable) params.disable = 1
  else if (original.disable !== undefined && Number(original.disable)) deletes.push('disable')
  if (deletes.length) params.delete = deletes.join(',')
  if (original.digest) params.digest = original.digest
  return params
}

/** "a,b" / "a;b" / "a b" → ["a","b"]. */
export function parseNodeList(value: string | undefined): string[] {
  return (value ?? '').split(/[,;\s]+/).filter(Boolean)
}
