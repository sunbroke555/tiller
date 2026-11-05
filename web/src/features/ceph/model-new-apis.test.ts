// Pure logic behind the newer pve-manager Ceph APIs: health mute,
// rolling restart, node releases and the noautoscale flag.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RESTART_FORM,
  FLAG_DESCRIPTION,
  FLAG_LABEL,
  MUTE_DURATIONS,
  defaultRelease,
  flagChanges,
  healthMuteParams,
  healthUnmuteParams,
  idleMutes,
  muteExpiryLabel,
  muteInfos,
  muteTtl,
  nodeOsdRestartParams,
  parseCephTime,
  releaseOptions,
  restartBulkParams,
} from './model'

// The ttl pattern of PUT /cluster/ceph/health-mute/{code}.
const UNIT = '(?:s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?|w|wk|weeks?|mo|months?|y|yr|years?)'
const TTL_RE = new RegExp(`^\\d+[ \\t]*${UNIT}(?:[ \\t]*\\d+[ \\t]*${UNIT})*$`)

describe('health mute', () => {
  it('omits ttl for "不过期" (no ttl=0) and sends sticky only when wanted', () => {
    expect(healthMuteParams({ duration: 'forever', sticky: false })).toEqual({ value: 1 })
    expect(healthMuteParams({ duration: 'forever', sticky: true })).toEqual({ value: 1, sticky: 1 })
    expect(healthMuteParams({ duration: '1w', sticky: false })).toEqual({ value: 1, ttl: '1w' })
    expect(healthMuteParams({ duration: '4h', sticky: true })).toEqual({ value: 1, ttl: '4h', sticky: 1 })
    expect(healthUnmuteParams()).toEqual({ value: 0 })
  })

  it('offers only durations the API accepts, plus no expiry', () => {
    expect(MUTE_DURATIONS.map((d) => d.value)).toContain('forever')
    expect(MUTE_DURATIONS.find((d) => d.value === 'forever')?.label).toBe('不过期')
    for (const d of MUTE_DURATIONS) {
      const ttl = muteTtl(d.value)
      if (d.value === 'forever') expect(ttl).toBeUndefined()
      else expect(ttl).toMatch(TTL_RE)
    }
  })

  it('indexes mutes and lists the ones whose check is not raised', () => {
    const mutes = muteInfos([
      { code: 'OSD_DOWN', sticky: 1, ttl: '2026-11-12T08:00:00.000000+0000' },
      { code: 'AUTH_INSECURE_GLOBAL_ID_RECLAIM_ALLOWED', sticky: false, summary: 'mons allow insecure reclaim' },
      { code: 'POOL_NO_REDUNDANCY', sticky: 0 },
      { code: '', sticky: 0 },
    ])
    expect(mutes.size).toBe(3)
    expect(mutes.get('OSD_DOWN')).toEqual({ code: 'OSD_DOWN', sticky: true, ttl: '2026-11-12T08:00:00.000000+0000', summary: undefined })
    expect(mutes.get('AUTH_INSECURE_GLOBAL_ID_RECLAIM_ALLOWED')?.sticky).toBe(false)
    expect(idleMutes([{ id: 'OSD_DOWN' }], mutes).map((m) => m.code)).toEqual(['AUTH_INSECURE_GLOBAL_ID_RECLAIM_ALLOWED', 'POOL_NO_REDUNDANCY'])
    expect(muteInfos(null).size).toBe(0)
  })

  it('reads Ceph time stamps', () => {
    expect(parseCephTime('2026-11-12T08:00:00.123456+0000')).toBe(Date.UTC(2026, 10, 12, 8, 0, 0, 123))
    expect(parseCephTime('2026-11-12 08:00:00+0100')).toBe(Date.UTC(2026, 10, 12, 7))
    expect(parseCephTime('2026-11-12T08:00:00Z')).toBe(Date.UTC(2026, 10, 12, 8))
    expect(parseCephTime('soon')).toBeNull()
    expect(parseCephTime(undefined)).toBeNull()
  })

  it('labels the expiry', () => {
    const now = Date.UTC(2026, 10, 5, 8)
    expect(muteExpiryLabel(undefined, now)).toBe('不过期')
    expect(muteExpiryLabel('2026-11-05T11:00:00Z', now)).toMatch(/到期（还剩 3 小时）$/)
    expect(muteExpiryLabel('2026-11-05T07:00:00Z', now)).toBe('即将到期')
    expect(muteExpiryLabel('garbage', now)).toBe('到期：garbage')
  })
})

describe('rolling restart', () => {
  it('sends only the type and non-default options cluster-wide', () => {
    expect(restartBulkParams('mon', DEFAULT_RESTART_FORM)).toEqual({ 'service-type': 'mon' })
    expect(restartBulkParams('mds', { ...DEFAULT_RESTART_FORM, force: true, dryRun: true })).toEqual({ 'service-type': 'mds', force: 1, 'dry-run': 1 })
    // only-outdated is OSD only.
    expect(restartBulkParams('mgr', { ...DEFAULT_RESTART_FORM, onlyOutdated: true })).toEqual({ 'service-type': 'mgr' })
    expect(restartBulkParams('osd', { ...DEFAULT_RESTART_FORM, onlyOutdated: true })).toEqual({ 'service-type': 'osd', 'only-outdated': 1 })
  })

  it('builds the per-node OSD restart', () => {
    expect(nodeOsdRestartParams(DEFAULT_RESTART_FORM)).toEqual({ 'service-type': 'osd' })
    expect(nodeOsdRestartParams({ ...DEFAULT_RESTART_FORM, onlyOutdated: true, setNoout: false })).toEqual({
      'service-type': 'osd',
      'only-outdated': 1,
      'set-noout': 0,
    })
    // Resume uses the saved plan: only-outdated / set-noout are ignored by PVE, so not sent.
    expect(nodeOsdRestartParams({ ...DEFAULT_RESTART_FORM, resume: true, onlyOutdated: true, setNoout: false, force: true })).toEqual({
      'service-type': 'osd',
      force: 1,
      resume: 1,
    })
  })
})

describe('releases', () => {
  it('falls back to the built-in list', () => {
    expect(releaseOptions(null).map((r) => r.release)).toEqual(['squid', 'tentacle'])
    expect(releaseOptions([]).every((r) => r.unavailable === null)).toBe(true)
  })

  it('uses the node list, oldest first, with the reason for unavailable releases', () => {
    const opts = releaseOptions([
      { release: 'tentacle', version: '20.2', available: 1, 'is-default': 0, unsupported: 1 },
      { release: 'reef', version: '18.2', available: 0 },
      { release: 'squid', version: '19.2', available: true, 'is-default': true },
    ])
    expect(opts.map((o) => o.release)).toEqual(['reef', 'squid', 'tentacle'])
    expect(opts[0]!.unavailable).toBeTruthy()
    expect(opts[1]).toMatchObject({ unavailable: null, isDefault: true, preview: false })
    expect(opts[2]).toMatchObject({ unavailable: null, isDefault: false, preview: true })
  })

  it('preselects the running release, then the recommended, then the newest installable', () => {
    const opts = releaseOptions([
      { release: 'reef', version: '18.2', available: 0 },
      { release: 'squid', version: '19.2', available: 1, 'is-default': 1 },
      { release: 'tentacle', version: '20.2', available: 1 },
    ])
    expect(defaultRelease('20.2.0', opts)).toBe('tentacle')
    expect(defaultRelease(undefined, opts)).toBe('squid')
    // Running reef, but the node cannot install it.
    expect(defaultRelease('18.2.4', opts)).toBe('squid')
    const noDefault = releaseOptions([
      { release: 'squid', version: '19.2', available: 1 },
      { release: 'tentacle', version: '20.2', available: 1 },
      { release: 'umbrella', version: '21.2', available: 0 },
    ])
    expect(defaultRelease(undefined, noDefault)).toBe('tentacle')
  })
})

describe('noautoscale flag', () => {
  it('has a Chinese label and description and is sent like the other flags', () => {
    expect(FLAG_LABEL.noautoscale).toBeTruthy()
    expect(FLAG_DESCRIPTION.noautoscale).toMatch(/PG/)
    const current = [
      { name: 'noout', description: '', value: 0 as const },
      { name: 'noautoscale', description: '', value: 0 as const },
    ]
    expect(flagChanges(current, { noout: false, noautoscale: true })).toEqual({ noautoscale: 1 })
  })
})
