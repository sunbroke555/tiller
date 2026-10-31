// Size units used by PVE: memory in MiB, disks as "32G" strings, the API in bytes.

export type SizeUnit = 'B' | 'KiB' | 'MiB' | 'GiB' | 'TiB'

export const SIZE_FACTOR: Record<SizeUnit, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
}

/** Convert a number between units (no rounding). */
export function convertSize(value: number, from: SizeUnit, to: SizeUnit): number {
  return (value * SIZE_FACTOR[from]) / SIZE_FACTOR[to]
}

const SUFFIX: Record<string, number> = {
  '': 1,
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
  P: 1024 ** 5,
}

/**
 * PVE size string → bytes: "32G" → 34359738368, "512M", "1.5T", "4096" (bytes).
 * Accepts "GiB"/"GB" style suffixes too. Returns null when unparsable.
 */
export function parsePveSize(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!value) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*([KMGTP]?)(?:i?B)?\s*$/i.exec(value)
  if (!m) return null
  const factor = SUFFIX[m[2]!.toUpperCase()]
  return factor === undefined ? null : Math.round(Number(m[1]) * factor)
}

/**
 * Bytes → the shortest exact PVE size string: 34359738368 → "32G",
 * 536870912 → "512M", 1000 → "1000". Non-integral sizes use the largest unit
 * that keeps an integer value.
 */
export function formatPveSize(bytes: number): string {
  for (const [suffix, factor] of [
    ['T', 1024 ** 4],
    ['G', 1024 ** 3],
    ['M', 1024 ** 2],
    ['K', 1024],
  ] as const) {
    if (bytes >= factor && bytes % factor === 0) return `${bytes / factor}${suffix}`
  }
  return String(Math.round(bytes))
}

/** Largest unit (from `units`) in which `value` (given in `base`) is a whole number ≥ 1. */
export function bestSizeUnit(value: number | null | undefined, base: SizeUnit, units: readonly SizeUnit[]): SizeUnit {
  const sorted = [...units].sort((a, b) => SIZE_FACTOR[b] - SIZE_FACTOR[a])
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) {
    return units.includes(base) ? base : sorted[sorted.length - 1]!
  }
  for (const unit of sorted) {
    const v = convertSize(value, base, unit)
    if (v >= 1 && Number.isInteger(v)) return unit
  }
  return sorted[sorted.length - 1]!
}
