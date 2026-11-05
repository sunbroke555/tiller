/** Display thresholds for live metrics; missing readings never imply an alarm. */
export type MetricTone = 'normal' | 'high' | 'critical'

export const METRIC_TEXT: Record<MetricTone, string> = {
  normal: '',
  high: 'text-warning-strong',
  critical: 'text-destructive',
}

export const METRIC_FILL: Record<MetricTone, string> = {
  normal: 'bg-brand',
  high: 'bg-warning',
  critical: 'bg-destructive',
}

export const USAGE_HINT = '使用率 ≥ 75% 为警告，≥ 90% 为严重'
export const CEPH_USAGE_HINT = '使用率 ≥ 75% 为警告，≥ 85% 为严重'

export function highValueTone(value: number | null | undefined, warning: number, critical: number): MetricTone {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'normal'
  return value >= critical ? 'critical' : value >= warning ? 'high' : 'normal'
}

/** Usage is a fraction; Ceph retains its existing, earlier 85% critical mark. */
export function usageTone(value: number | null | undefined): MetricTone {
  return highValueTone(value, 0.75, 0.9)
}

export function cephUsageTone(value: number | null | undefined): MetricTone {
  return highValueTone(value, 0.75, 0.85)
}

/** Remaining battery charge / SSD life is a percentage, with reversed thresholds. */
export function remainingTone(value: number | null | undefined): MetricTone {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'normal'
  return value <= 10 ? 'critical' : value <= 20 ? 'high' : 'normal'
}

export type TemperatureKind = 'cpu' | 'sensor' | 'disk' | 'nvme'

const TEMPERATURE_DEFAULTS: Record<TemperatureKind, { warning: number; critical: number; label: string }> = {
  cpu: { warning: 70, critical: 85, label: 'CPU' },
  disk: { warning: 50, critical: 60, label: '非 NVMe 磁盘' },
  nvme: { warning: 70, critical: 80, label: 'NVMe' },
  sensor: { warning: 70, critical: 85, label: '未识别类型的传感器' },
}

/** hwmon names include the driver; thermal-zone IDs may only have a type label. */
export function sensorTemperatureKind(reading?: { id: string; name: string }): TemperatureKind {
  if (!reading) return 'sensor'
  const identity = `${reading.id} ${reading.name}`
  if (/(?:^|[^a-z0-9])nvme(?:\d|[^a-z0-9]|$)/i.test(identity)) return 'nvme'
  if (/(?:^|[^a-z0-9])(?:drivetemp|sata|hdd|ssd|scsi)(?:\d|[^a-z0-9]|$)|硬盘|磁盘/i.test(identity)) return 'disk'
  if (/(?:^|[^a-z0-9])(?:coretemp|k10temp|k8temp|zenpower|cpu|x86_pkg_temp)(?:\d|[^a-z0-9]|$)|处理器/i.test(identity)) return 'cpu'
  return 'sensor'
}

function validTemperatureLimit(value?: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 200
}

export function temperatureThresholds(limit?: number, kind: TemperatureKind = 'sensor', warningLimit?: number) {
  const { warning, critical } = TEMPERATURE_DEFAULTS[kind]
  const reportedCritical = validTemperatureLimit(limit)
  if (validTemperatureLimit(warningLimit) && (!reportedCritical || warningLimit <= limit)) {
    // A lone reported warning must not sit above a fallback critical threshold.
    return { warning: warningLimit, critical: reportedCritical ? limit : Math.max(critical, warningLimit + critical - warning) }
  }
  if (reportedCritical) {
    // Retain the device category's warning margin when a critical limit is known.
    return { warning: Math.max(0, limit - (critical - warning)), critical: limit }
  }
  return { warning, critical }
}

export function temperatureTone(value: number | null | undefined, limit?: number, kind?: TemperatureKind, warningLimit?: number): MetricTone {
  const { warning, critical } = temperatureThresholds(limit, kind, warningLimit)
  return highValueTone(value, warning, critical)
}

export function temperatureHint(limit?: number, kind: TemperatureKind = 'sensor', warningLimit?: number): string {
  const { warning, critical } = temperatureThresholds(limit, kind, warningLimit)
  const reportedCritical = validTemperatureLimit(limit)
  const reportedWarning = validTemperatureLimit(warningLimit) && (!reportedCritical || warningLimit <= limit)
  const source = reportedWarning
    ? reportedCritical ? '设备上报的两档阈值' : '警告值由设备上报，严重值为推算提醒阈值'
    : reportedCritical ? '依据传感器临界值，警告值为推算提醒阈值' : '默认提醒阈值'
  return `${TEMPERATURE_DEFAULTS[kind].label}：温度 ≥ ${warning} °C 为警告，≥ ${critical} °C 为严重（${source}）`
}
