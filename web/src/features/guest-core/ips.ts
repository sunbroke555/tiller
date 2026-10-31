// Normalise guest network interfaces from the QEMU guest agent
// (network-get-interfaces) and from /lxc/{vmid}/interfaces into one shape.

import type { AgentNetworkInterface, LxcInterface } from '@/api/guest-core'

export interface GuestAddress {
  address: string
  prefix?: number
  family: 4 | 6
  /** Loopback or link-local: hidden unless "显示全部". */
  minor: boolean
}

export interface GuestInterface {
  name: string
  mac?: string
  addresses: GuestAddress[]
  loopback: boolean
}

export function isLoopbackName(name: string): boolean {
  return name === 'lo' || /^loopback/i.test(name)
}

/** Loopback (127/8, ::1) or link-local (169.254/16, fe80::/10). */
export function isMinorAddress(address: string, family: 4 | 6): boolean {
  const a = address.toLowerCase()
  if (family === 4) return a.startsWith('127.') || a.startsWith('169.254.')
  return a === '::1' || /^fe[89ab][0-9a-f]:/.test(a)
}

function addr(address: string, prefix: number | string | undefined, type: string | undefined): GuestAddress {
  const family: 4 | 6 = type === 'ipv6' || type === 'inet6' || address.includes(':') ? 6 : 4
  const p = prefix === undefined || prefix === '' ? undefined : Number(prefix)
  return { address, prefix: Number.isFinite(p) ? p : undefined, family, minor: isMinorAddress(address, family) }
}

function splitCidr(cidr: string): [string, string | undefined] {
  const i = cidr.indexOf('/')
  return i < 0 ? [cidr, undefined] : [cidr.slice(0, i), cidr.slice(i + 1)]
}

function sortAddresses(list: GuestAddress[]): GuestAddress[] {
  return [...list].sort((a, b) => a.family - b.family || Number(a.minor) - Number(b.minor))
}

/** QEMU guest agent result. */
export function fromAgent(list: readonly AgentNetworkInterface[]): GuestInterface[] {
  return list.map((i) => ({
    name: i.name,
    mac: i['hardware-address'] && i['hardware-address'] !== '00:00:00:00:00:00' ? i['hardware-address'] : undefined,
    addresses: sortAddresses((i['ip-addresses'] ?? []).map((a) => addr(a['ip-address'], a.prefix, a['ip-address-type']))),
    loopback: isLoopbackName(i.name),
  }))
}

/** /lxc/{vmid}/interfaces (newer PVE adds ip-addresses; older only inet/inet6). */
export function fromLxc(list: readonly LxcInterface[]): GuestInterface[] {
  return list.map((i) => {
    let addresses: GuestAddress[]
    if (i['ip-addresses']?.length) {
      addresses = i['ip-addresses'].map((a) => addr(a['ip-address'], a.prefix, a['ip-address-type']))
    } else {
      addresses = [i.inet, i.inet6]
        .filter((v): v is string => !!v)
        .flatMap((v) => v.split(/[\s,]+/).filter(Boolean))
        .map((v) => {
          const [a, prefix] = splitCidr(v)
          return addr(a, prefix, undefined)
        })
    }
    const mac = i.hwaddr ?? i['hardware-address']
    return {
      name: i.name,
      mac: mac && mac !== '00:00:00:00:00:00' ? mac : undefined,
      addresses: sortAddresses(addresses),
      loopback: isLoopbackName(i.name),
    }
  })
}

/** Interfaces to show: without "all", drop loopback and minor addresses (and then-empty interfaces). */
export function visibleInterfaces(list: readonly GuestInterface[], all: boolean): GuestInterface[] {
  if (all) return [...list]
  return list
    .filter((i) => !i.loopback)
    .map((i) => ({ ...i, addresses: i.addresses.filter((a) => !a.minor) }))
    .filter((i) => i.addresses.length > 0)
}

/** Primary address for headers: first global IPv4, else first global IPv6. */
export function primaryAddress(list: readonly GuestInterface[]): string | null {
  const all = visibleInterfaces(list, false).flatMap((i) => i.addresses)
  return (all.find((a) => a.family === 4) ?? all[0])?.address ?? null
}
