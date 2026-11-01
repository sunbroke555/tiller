import { describe, expect, it } from 'vitest'

import type { FirewallRule } from '@/api/firewall'

import {
  actionsFor,
  createRuleParams,
  describeRule,
  dropIndex,
  emptyRuleForm,
  formatAddress,
  formatOption,
  formatService,
  groupRuleParams,
  managementAccess,
  moveToParam,
  optionDefs,
  optionParams,
  parseLogLine,
  parseLogRatelimit,
  refOptions,
  reorderRules,
  ruleKeys,
  ruleToForm,
  scopeFeatures,
  stringifyLogRatelimit,
  updateGroupRuleParams,
  updateRuleParams,
  validateAddress,
  validateName,
  validatePorts,
  validateRuleForm,
  type RuleForm,
} from './model'
import { parseDcFirewallPath, tabFirewallHref } from './nav'

const rule = (r: Partial<FirewallRule>): FirewallRule => ({ pos: 0, type: 'in', action: 'ACCEPT', digest: 'd1', ...r })

describe('scopes', () => {
  it('offers per-scope views and directions', () => {
    expect(scopeFeatures({ kind: 'dc' }).views).toEqual(['rules', 'groups', 'aliases', 'ipset', 'options'])
    expect(scopeFeatures({ kind: 'node', node: 'n' }).views).toContain('log')
    expect(scopeFeatures({ kind: 'guest', node: 'n', type: 'qemu', vmid: 1 }).directions).toEqual(['in', 'out'])
    expect(scopeFeatures({ kind: 'vnet', vnet: 'v' }).directions).toEqual(['forward'])
    expect(scopeFeatures({ kind: 'group', group: 'g' }).groups).toBe(false)
    expect(actionsFor('forward')).toEqual(['ACCEPT', 'DROP'])
  })
})

describe('rule summary', () => {
  it('formats addresses with scoped refs', () => {
    expect(formatAddress(undefined)).toBe('任意')
    expect(formatAddress('+dc/trusted')).toBe('trusted（IPSet）')
    expect(formatAddress('dc/office,10.0.0.1')).toBe('office, 10.0.0.1')
    expect(formatAddress('192.168.0.0/24')).toBe('192.168.0.0/24')
  })

  it('formats the matched service', () => {
    expect(formatService({ macro: 'HTTPS' })).toBe('HTTPS')
    expect(formatService({ proto: 'tcp', dport: '22' })).toBe('tcp 22')
    expect(formatService({ proto: 'icmp', 'icmp-type': 'echo-request' })).toBe('icmp echo-request')
    expect(formatService({})).toBe('所有流量')
    expect(describeRule(rule({ type: 'out', action: 'DROP', proto: 'udp', dport: '53', dest: '+dc/dns' }))).toBe('出站丢弃 udp 53：任意 → dns（IPSet）')
    expect(describeRule(rule({ type: 'group', action: 'web', iface: 'net0' }))).toBe('安全组 web（net0）')
  })
})

describe('rule form → params', () => {
  const base: RuleForm = { ...emptyRuleForm({ directions: ['in', 'out'] }), enable: true }

  it('creates with only set values', () => {
    expect(createRuleParams({ ...base, proto: 'tcp', dport: '22', source: ' 10.0.0.0/8 ', comment: 'ssh' }, { iface: true })).toEqual({
      enable: 1,
      type: 'in',
      action: 'ACCEPT',
      proto: 'tcp',
      dport: '22',
      source: '10.0.0.0/8',
      comment: 'ssh',
    })
  })

  it('lets a macro define protocol and ports, ICMP replace ports', () => {
    const p = createRuleParams({ ...base, macro: 'SSH', proto: 'tcp', dport: '22', sport: '1' }, { iface: true })
    expect(p).toMatchObject({ macro: 'SSH' })
    expect(p).not.toHaveProperty('proto')
    expect(p).not.toHaveProperty('dport')
    const icmp = createRuleParams({ ...base, proto: 'icmp', dport: '80', icmpType: 'echo-request' }, { iface: true })
    expect(icmp).toMatchObject({ proto: 'icmp', 'icmp-type': 'echo-request' })
    expect(icmp).not.toHaveProperty('dport')
    expect(createRuleParams({ ...base, iface: 'net0' }, { iface: false })).not.toHaveProperty('iface')
    expect(createRuleParams({ ...base, log: 'info' }, { iface: true })).toMatchObject({ log: 'info' })
    expect(createRuleParams({ ...base, type: 'forward', action: 'REJECT' }, { iface: true })).toMatchObject({ action: 'ACCEPT' })
  })

  it('updates changed keys, deletes cleared ones, sends the digest', () => {
    const r = rule({ pos: 3, proto: 'tcp', dport: '22', source: '10.0.0.1', comment: 'x', enable: 1, log: 'info' })
    const form = { ...ruleToForm(r), dport: '2222', source: '', log: 'nolog' as const, enable: false }
    expect(updateRuleParams(r, form, { iface: true })).toEqual({ dport: '2222', delete: 'source,log', enable: 0, digest: 'd1' })
    expect(updateRuleParams(r, ruleToForm(r), { iface: true })).toBeNull()
  })

  it('validates ports, addresses and names', () => {
    expect(validatePorts('22,80:85,https')).toBeNull()
    expect(validatePorts('70000')).toMatch(/65535/)
    expect(validatePorts('90:80')).toMatch(/起点/)
    expect(validatePorts('a b')).toMatch(/不是有效/)
    expect(validateAddress('10.0.0.1, 10.0.0.2')).toBeNull()
    expect(validateAddress('10.0.0.1 10.0.0.2')).toMatch(/空格/)
    expect(validateName('web-1')).toBeNull()
    expect(validateName('1web')).toMatch(/字母开头/)
    expect(validateName('')).toBe('必填')
    expect(validateRuleForm({ ...base, dport: '22' }, { iface: true, guest: false })).toHaveProperty('proto')
    expect(validateRuleForm({ ...base, iface: 'eth0' }, { iface: true, guest: true })).toHaveProperty('iface')
    expect(validateRuleForm({ ...base, macro: 'SSH', dport: 'bad port' }, { iface: true, guest: false })).toEqual({})
  })

  it('builds security group rules', () => {
    expect(groupRuleParams({ group: 'web', iface: 'net0', enable: true, comment: '' }, { iface: true })).toEqual({
      type: 'group',
      action: 'web',
      enable: 1,
      iface: 'net0',
    })
    const r = rule({ type: 'group', action: 'web', iface: 'net0', enable: 1 })
    expect(updateGroupRuleParams(r, { group: 'db', iface: '', enable: true, comment: 'c' }, { iface: true })).toEqual({
      action: 'db',
      comment: 'c',
      delete: 'iface',
      digest: 'd1',
    })
  })
})

describe('reordering', () => {
  const list = ['a', 'b', 'c', 'd'].map((comment, pos) => rule({ pos, comment }))

  it("maps a final index to PVE's moveto", () => {
    // moveto inserts before the rule that was at that index (verified on the lab).
    expect(moveToParam(0, 1)).toBe(2)
    expect(moveToParam(3, 0)).toBe(0)
    expect(moveToParam(1, 3)).toBe(4)
    expect(moveToParam(2, 1)).toBe(1)
  })

  it('reorders optimistically and renumbers', () => {
    const next = reorderRules(list, 0, 2)
    expect(next.map((r) => r.comment)).toEqual(['b', 'c', 'a', 'd'])
    expect(next.map((r) => r.pos)).toEqual([0, 1, 2, 3])
    expect(reorderRules(list, 3, 0).map((r) => r.comment)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('computes drop targets', () => {
    expect(dropIndex(0, 2, false)).toBe(1)
    expect(dropIndex(0, 2, true)).toBe(2)
    expect(dropIndex(3, 0, false)).toBe(0)
    expect(dropIndex(3, 1, true)).toBe(2)
  })

  it('keeps keys stable across moves and unique for duplicates', () => {
    const dup = [rule({ comment: 'x' }), rule({ comment: 'x', pos: 1 })]
    const keys = ruleKeys(dup)
    expect(new Set(keys).size).toBe(2)
    const before = ruleKeys(list)
    const after = ruleKeys(reorderRules(list, 0, 3))
    expect(after[3]).toBe(before[0])
  })
})

describe('refs', () => {
  it('scopes alias and IPSet references like the official selector', () => {
    const opts = refOptions([
      { type: 'ipset', name: 'trusted', ref: '+trusted', scope: 'dc' },
      { type: 'alias', name: 'office', ref: 'office', scope: 'guest' },
    ])
    expect(opts.map((o) => o.value)).toEqual(['guest/office', '+dc/trusted'])
    expect(refOptions([{ type: 'ipset', name: 's', ref: '+s', scope: 'dc' }], 'alias')).toEqual([])
  })
})

describe('options', () => {
  it('defines rows per scope', () => {
    const keys = (s: Parameters<typeof optionDefs>[0]) => optionDefs(s).map((d) => d.key)
    expect(keys({ kind: 'dc' })).toEqual(['enable', 'ebtables', 'policy_in', 'policy_out', 'policy_forward', 'log_ratelimit'])
    expect(keys({ kind: 'node', node: 'n' })).toEqual(expect.arrayContaining(['nftables', 'nf_conntrack_max', 'protection_synflood', 'smurf_log_level']))
    expect(keys({ kind: 'guest', node: 'n', type: 'lxc', vmid: 1 })).toEqual(expect.arrayContaining(['dhcp', 'macfilter', 'ipfilter', 'policy_in']))
    expect(keys({ kind: 'vnet', vnet: 'v' })).toEqual(['enable', 'policy_forward', 'log_level_forward'])
  })

  it('formats values and defaults', () => {
    const [enable, , policyIn, , , ratelimit] = optionDefs({ kind: 'dc' })
    expect(formatOption(enable!, undefined)).toBe('关闭')
    expect(formatOption(policyIn!, undefined)).toBe('DROP（丢弃）')
    expect(formatOption(ratelimit!, undefined)).toBe('1/秒，突发 5')
    expect(formatOption(ratelimit!, '0')).toBe('不限速')
  })

  it('builds option params', () => {
    expect(optionParams('enable', true, 'x')).toEqual({ enable: 1, digest: 'x' })
    expect(optionParams('policy_in', undefined, 'x')).toEqual({ delete: 'policy_in', digest: 'x' })
  })

  it('parses and prints the log rate limit', () => {
    expect(parseLogRatelimit('enable=1,rate=10/minute,burst=20')).toEqual({ enable: true, rate: 10, unit: 'minute', burst: 20 })
    expect(parseLogRatelimit('0')).toMatchObject({ enable: false, rate: 1, unit: 'second', burst: 5 })
    expect(stringifyLogRatelimit({ enable: true, rate: 3, unit: 'hour', burst: 7 })).toBe('enable=1,rate=3/hour,burst=7')
  })

  it('checks management access before enabling', () => {
    expect(managementAccess([])).toEqual({ web: false, ssh: false })
    expect(
      managementAccess([
        rule({ enable: 1, proto: 'tcp', dport: '8006,22', source: '192.168.0.0/24' }),
        rule({ enable: 0, proto: 'tcp', dport: '22' }),
      ]),
    ).toEqual({ web: true, ssh: true })
    expect(managementAccess([rule({ enable: 1, macro: 'SSH' })])).toEqual({ web: false, ssh: true })
    expect(managementAccess([rule({ enable: 1, proto: 'tcp', dport: '8000:8010' })])).toEqual({ web: true, ssh: false })
    expect(managementAccess([rule({ enable: 1, type: 'out', proto: 'tcp', dport: '8006' })])).toEqual({ web: false, ssh: false })
  })
})

describe('log', () => {
  it('parses firewall log lines', () => {
    expect(parseLogLine('100 6 tap100i0-IN 01/Nov/2026:12:00:00 +0800 policy DROP: IN=fwbr100i0 SRC=1.2.3.4')).toEqual({
      vmid: 100,
      level: '6',
      chain: 'tap100i0-IN',
      time: '01/Nov/2026:12:00:00 +0800',
      message: 'policy DROP: IN=fwbr100i0 SRC=1.2.3.4',
      verdict: 'DROP',
    })
    expect(parseLogLine('0 5 - 01/Nov/2026:02:27:30 +0800 starting pvefw logger')?.verdict).toBeNull()
    expect(parseLogLine('no content')).toBeNull()
  })
})

describe('navigation', () => {
  it('parses datacenter sub-paths and builds tab links', () => {
    const views = scopeFeatures({ kind: 'dc' }).views
    expect(parseDcFirewallPath('ipset/web%2D1', views)).toEqual({ view: 'ipset', item: 'web-1' })
    expect(parseDcFirewallPath('', views)).toEqual({ view: 'rules', item: undefined })
    expect(parseDcFirewallPath('log', views).view).toBe('rules')
    expect(tabFirewallHref('rules')).toEqual({ search: '' })
    expect(tabFirewallHref('ipset', 'ipfilter-net0')).toEqual({ search: '?fw=ipset&item=ipfilter-net0' })
  })
})
