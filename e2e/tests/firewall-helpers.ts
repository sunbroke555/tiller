import type { PveApi } from '../fixtures'

// Lab helpers of the firewall specs (not a spec itself).

export const DC = '/cluster/firewall'
export const PREFIX = 'e2e-fw'

export interface Rule {
  pos: number
  type: string
  action: string
  comment?: string
  enable?: number
  proto?: string
  dport?: string
  source?: string
  macro?: string
  iface?: string
}

export async function rulesAt(pve: PveApi, path: string): Promise<Rule[]> {
  return pve.get<Rule[]>(path)
}

/** Delete rules whose comment starts with e2e-fw (highest position first). */
export async function deleteTestRules(pve: PveApi, path: string) {
  for (;;) {
    const rules = await rulesAt(pve, path)
    const victim = [...rules].reverse().find((r) => r.comment?.startsWith(PREFIX))
    if (!victim) return
    await pve.del(`${path}/${victim.pos}`)
  }
}

/** Remove leftovers of earlier runs: rules, groups, aliases and IPSets named e2e-fw*. */
export async function sweepFirewall(pve: PveApi) {
  await deleteTestRules(pve, `${DC}/rules`)
  for (;;) {
    const rules = await rulesAt(pve, `${DC}/rules`)
    const victim = [...rules].reverse().find((r) => r.type === 'group' && r.action.startsWith(PREFIX))
    if (!victim) break
    await pve.del(`${DC}/rules/${victim.pos}`)
  }
  for (const g of await pve.get<{ group: string }[]>(`${DC}/groups`)) {
    if (!g.group.startsWith(PREFIX)) continue
    for (const r of (await rulesAt(pve, `${DC}/groups/${g.group}`)).reverse()) await pve.del(`${DC}/groups/${g.group}/${r.pos}`)
    await pve.del(`${DC}/groups/${g.group}`)
  }
  for (const s of await pve.get<{ name: string }[]>(`${DC}/ipset`)) {
    if (s.name.startsWith(PREFIX)) await pve.del(`${DC}/ipset/${s.name}`, { force: 1 })
  }
  for (const a of await pve.get<{ name: string }[]>(`${DC}/aliases`)) {
    if (a.name.startsWith(PREFIX)) await pve.del(`${DC}/aliases/${a.name}`)
  }
}

export async function dcOptions(pve: PveApi) {
  return pve.get<Record<string, string | number>>(`${DC}/options`)
}

