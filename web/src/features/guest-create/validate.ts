// Small validators shared by the VM and CT wizards (same rules as the
// official UI's vtypes and the PVE schema formats).

/** Errors of one step, keyed by API parameter / field name. */
export type FieldErrors = Record<string, string>

const DNS_NAME = /^(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)\.)*(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)$/
const TAG = /^[a-z0-9_][a-z0-9_\-+.]*$/i
const MAC = /^(?:[a-fA-F0-9]{2}:){5}[a-fA-F0-9]{2}$/
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const CPUSET = /^\s*\d+(?:-\d+)?(?:\s*,\s*\d+(?:-\d+)?)*\s*$/
const MOUNT_PATH = /^\/[^,;=\s]*$/

export function isDnsName(v: string): boolean {
  return DNS_NAME.test(v)
}

export function isTag(v: string): boolean {
  return TAG.test(v)
}

/** Unicast MAC (the low bit of the first octet must be 0). */
export function isUnicastMac(v: string): boolean {
  return MAC.test(v) && (parseInt(v.slice(0, 2), 16) & 1) === 0
}

export function isIPv4(v: string): boolean {
  return IPV4.test(v)
}

export function isIPv6(v: string): boolean {
  if (!v.includes(':') || !/^[0-9a-fA-F:.]+$/.test(v)) return false
  // Embedded IPv4 tail ("::ffff:1.2.3.4").
  let s = v
  const lastColon = v.lastIndexOf(':')
  if (v.slice(lastColon + 1).includes('.')) {
    if (!isIPv4(v.slice(lastColon + 1))) return false
    s = `${v.slice(0, lastColon + 1)}0:0`
  }
  const dbl = s.split('::')
  if (dbl.length > 2) return false
  const groups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = groups(dbl[0] ?? '')
  const tail = dbl.length === 2 ? groups(dbl[1] ?? '') : []
  if (![...head, ...tail].every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false
  const count = head.length + tail.length
  return dbl.length === 2 ? count < 8 : count === 8
}

function cidr(v: string, maxPrefix: number, isAddr: (a: string) => boolean): boolean {
  const slash = v.indexOf('/')
  if (slash === -1) return false
  const addr = v.slice(0, slash)
  const prefix = v.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > maxPrefix) return false
  return isAddr(addr)
}

export function isIPv4Cidr(v: string): boolean {
  return cidr(v, 32, isIPv4)
}

export function isIPv6Cidr(v: string): boolean {
  return cidr(v, 128, isIPv6)
}

/** "0-3,8,10-11" */
export function isCpuSet(v: string): boolean {
  return CPUSET.test(v)
}

export function isMountPath(v: string): boolean {
  return MOUNT_PATH.test(v) && v !== '/'
}

/**
 * The official UI's SSH key check: "[options] type key [comment]" with a
 * known key type.
 */
export function isSshKey(line: string): boolean {
  const keyre = /^(?:((?:[^\s"]|"(?:\\.|[^"\\])*")+)\s+)?(\S+)\s+(\S+)(?:\s+(.*))?$/
  const typere = /^(?:(?:sk-)?(?:ssh-(?:dss|rsa|ed25519)|ecdsa-sha2-nistp\d+)(?:@(?:[a-z0-9_-]+\.)+[a-z]{2,})?)$/
  const m = keyre.exec(line.trim())
  if (!m || !m[2]) return false
  return (!!m[1] && typere.test(m[1])) || typere.test(m[2])
}

/** Every non-empty line is a valid key. */
export function sshKeysValid(text: string): boolean {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .every(isSshKey)
}

/** Space separated list of IPv4/IPv6 addresses ("1.1.1.1 2606:4700::1111"); "," and ";" accepted. */
export function splitAddressList(v: string): string[] {
  return v
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isAddressList(v: string): boolean {
  const list = splitAddressList(v)
  return list.length > 0 && list.every((a) => isIPv4(a) || isIPv6(a))
}
