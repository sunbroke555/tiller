// Optional PVE APIs that only newer package versions provide.
//
// Older PVE answers unknown endpoints with 501 and rejects unknown parameters
// with 400, so pages hide a control (or skip a parameter) until the node's
// package version is known to support it. Versions come from the package
// changelogs: GET /nodes/{node}/apt/versions gives the exact package version;
// without Sys.Audit, pve-manager features fall back to GET /version.

import { useAptVersions } from './node-summary'
import { useNodes, useVersion } from './queries'

export const PVE_FEATURES = {
  /** GET /nodes/{node}/journal: structured, identifiers, units, priority, unit, service, kernel. */
  journalFilters: { pkg: 'pve-manager', min: '9.2.4' },
  /** POST /cluster/ceph/restart-bulk and /nodes/{node}/ceph/restart-bulk. */
  cephRestartBulk: { pkg: 'pve-manager', min: '9.2.5' },
  /** GET /nodes/{node}/ceph/releases. */
  cephReleases: { pkg: 'pve-manager', min: '9.2.7' },
  /** GET /cluster/ceph/health-mute, PUT /cluster/ceph/health-mute/{code}. */
  cephHealthMute: { pkg: 'pve-manager', min: '9.2.12' },
  /** PUT /cluster/ceph/flags: noautoscale. */
  cephNoAutoscale: { pkg: 'pve-manager', min: '9.2.23' },
  /** GET /nodes/{node}/qemu/{vmid}/agent/get-cpustats, get-load, get-disks, get-diskstats. */
  guestAgentStats: { pkg: 'qemu-server', min: '9.2.14' },
  /** POST /storage, PUT /storage/{storage}: on-volume-remove (LVM). */
  storageOnVolumeRemove: { pkg: 'libpve-storage-perl', min: '9.1.12' },
  /** POST /cluster/replication, PUT /cluster/replication/{id}: skip-freeze-fs. */
  replicationSkipFreezeFs: { pkg: 'libpve-guest-common-perl', min: '6.0.6' },
} as const satisfies Record<string, { pkg: string; min: string }>

export type PveFeature = keyof typeof PVE_FEATURES

/**
 * Compares Debian-style versions by their numeric parts ("9.2.25" > "9.2.4",
 * "7.0.14-28" > "7.0.14-6"). Any non-digit characters only separate parts.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.match(/\d+/g) ?? []).map(Number)
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

/** "supported" / "unsupported" once a version is known; "unknown" while loading or without permission. */
export type FeatureSupport = 'supported' | 'unsupported' | 'unknown'

export function featureSupport(feature: PveFeature, installed: string | undefined): FeatureSupport {
  if (!installed) return 'unknown'
  return compareVersions(installed, PVE_FEATURES[feature].min) >= 0 ? 'supported' : 'unsupported'
}

/**
 * Whether `node` (or, for cluster-wide APIs, the first online node) provides
 * `feature`. Callers hide controls on "unsupported"; "unknown" means the
 * version could not be read, so read-only calls may still be tried and must
 * tolerate 501.
 */
export function usePveFeature(feature: PveFeature, node?: string): FeatureSupport {
  const { pkg } = PVE_FEATURES[feature]
  const nodes = useNodes({ enabled: !node })
  const target = node ?? nodes.data?.find((n) => n.status === 'online')?.node ?? ''
  const apt = useAptVersions(target, { enabled: !!target, retry: false })
  const version = useVersion({ enabled: pkg === 'pve-manager' })
  const installed = apt.data?.find((p) => p.Package === pkg)?.Version
  if (installed) return featureSupport(feature, installed)
  if (pkg === 'pve-manager' && (apt.isError || !target)) return featureSupport(feature, version.data?.version)
  return 'unknown'
}
