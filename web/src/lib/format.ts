// Formatting helpers. All return a display string; missing or invalid input
// renders as an em dash so tables never show "NaN".

export const DASH = '—'

const IEC_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** 1536 → "1.5 KiB". Uses binary (IEC) units like the PVE UI. */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (!isNum(bytes) || bytes < 0) return DASH
  if (bytes < 1024) return `${Math.round(bytes)} B`
  let unit = 0
  let value = bytes
  while (value >= 1024 && unit < IEC_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  // 1023.96 GiB would round to "1024.0 GiB"; promote instead.
  if (Number(value.toFixed(digits)) >= 1024 && unit < IEC_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(digits)
  return `${fixed} ${IEC_UNITS[unit]}`
}

/** Bytes per second, e.g. "12.3 MiB/s". */
export function formatRate(bytesPerSecond: number | null | undefined): string {
  const b = formatBytes(bytesPerSecond)
  return b === DASH ? DASH : `${b}/s`
}

/** "3.2 / 16.0 GiB" */
export function formatUsage(used: number | null | undefined, total: number | null | undefined): string {
  if (!isNum(used) || !isNum(total) || total <= 0) return DASH
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

/** used/total as 0..1, or null when unknown. */
export function ratio(used: number | null | undefined, total: number | null | undefined): number | null {
  if (!isNum(used) || !isNum(total) || total <= 0) return null
  return Math.min(Math.max(used / total, 0), 1)
}

/**
 * A 0..1 ratio as a percentage. Small values keep one decimal so idle
 * guests show "0.4%" rather than "0%".
 */
export function formatPercent(value: number | null | undefined, digits?: number): string {
  if (!isNum(value)) return DASH
  const pct = value * 100
  const d = digits ?? (pct !== 0 && Math.abs(pct) < 10 ? 1 : 0)
  return `${pct.toFixed(d)}%`
}

const DURATION_UNITS: [seconds: number, label: string][] = [
  [86400, '天'],
  [3600, '小时'],
  [60, '分'],
  [1, '秒'],
]

/**
 * Seconds as the largest `parts` units: 93784 → "1 天 2 小时".
 * Sub-minute values show seconds; zero is "0 秒".
 */
export function formatDuration(seconds: number | null | undefined, parts = 2): string {
  if (!isNum(seconds) || seconds < 0) return DASH
  let rest = Math.floor(seconds)
  if (rest === 0) return '0 秒'
  const out: string[] = []
  for (const [size, label] of DURATION_UNITS) {
    if (out.length >= parts) break
    const n = Math.floor(rest / size)
    if (n > 0) {
      out.push(`${n} ${label}`)
      rest -= n * size
    } else if (out.length > 0) {
      // Keep units adjacent: "1 天 0 小时" reads oddly, stop instead.
      break
    }
  }
  return out.join(' ')
}

/** Uptime: em dash for stopped guests (uptime 0). */
export function formatUptime(seconds: number | null | undefined): string {
  return isNum(seconds) && seconds > 0 ? formatDuration(seconds) : DASH
}

/** Unix seconds relative to now: "刚刚", "5 分钟前", "3 天前". */
export function formatRelativeTime(epochSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (!isNum(epochSeconds)) return DASH
  const diff = Math.round(nowMs / 1000 - epochSeconds)
  if (diff < 0) return formatDateTime(epochSeconds)
  if (diff < 45) return '刚刚'
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} 分钟前`
  if (diff < 86400) return `${Math.round(diff / 3600)} 小时前`
  if (diff < 86400 * 30) return `${Math.round(diff / 86400)} 天前`
  return formatDateTime(epochSeconds)
}

/** Unix seconds as local "2026-11-01 08:30". */
export function formatDateTime(epochSeconds: number | null | undefined): string {
  if (!isNum(epochSeconds)) return DASH
  const d = new Date(epochSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** CPU count label: 4 → "4 核". */
export function formatCores(n: number | null | undefined): string {
  return isNum(n) ? `${n} 核` : DASH
}
