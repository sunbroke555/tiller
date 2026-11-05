import { describe, expect, it } from 'vitest'

import { compareVersions, featureSupport } from './pve-features'

describe('compareVersions', () => {
  it('compares numeric parts, not strings', () => {
    expect(compareVersions('9.2.25', '9.2.4')).toBe(1)
    expect(compareVersions('9.2.4', '9.2.4')).toBe(0)
    expect(compareVersions('9.1.15', '9.2.14')).toBe(-1)
    expect(compareVersions('7.0.14-28', '7.0.14-6')).toBe(1)
  })

  it('treats missing parts as zero and splits on any non-digit', () => {
    expect(compareVersions('9.2', '9.2.0')).toBe(0)
    expect(compareVersions('2.12-9+pmx4', '2.12-9')).toBe(1)
  })
})

describe('featureSupport', () => {
  it('reports the boundary version as supported', () => {
    expect(featureSupport('cephHealthMute', '9.2.12')).toBe('supported')
    expect(featureSupport('cephHealthMute', '9.2.11')).toBe('unsupported')
    expect(featureSupport('guestAgentStats', '9.1.15')).toBe('unsupported')
  })

  it('is unknown without a version', () => {
    expect(featureSupport('journalFilters', undefined)).toBe('unknown')
  })
})
