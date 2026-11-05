import { describe, expect, it } from 'vitest'

import { cephUsageTone, highValueTone, remainingTone, sensorTemperatureKind, temperatureHint, temperatureThresholds, temperatureTone, usageTone } from './metric-status'

describe('metric thresholds', () => {
  it.each([[0, 'normal'], [0.7499, 'normal'], [0.75, 'high'], [0.8999, 'high'], [0.9, 'critical'], [1.2, 'critical']] as const)('classifies usage %s as %s', (value, tone) => {
    expect(usageTone(value)).toBe(tone)
  })

  it.each([undefined, null, NaN, Infinity, -Infinity])('does not raise an alarm for an unknown reading: %s', (value) => {
    expect(usageTone(value)).toBe('normal')
    expect(remainingTone(value)).toBe('normal')
    expect(temperatureTone(value)).toBe('normal')
  })

  it('preserves the earlier critical threshold for Ceph', () => {
    expect(cephUsageTone(0.75)).toBe('high')
    expect(cephUsageTone(0.8499)).toBe('high')
    expect(cephUsageTone(0.85)).toBe('critical')
  })

  it.each([[100, 'normal'], [20.1, 'normal'], [20, 'high'], [10.1, 'high'], [10, 'critical'], [0, 'critical'], [-1, 'normal']] as const)('classifies remaining charge/life %s as %s', (value, tone) => {
    expect(remainingTone(value)).toBe(tone)
  })

  it('uses the reported sensor critical limit and warns 15 degrees earlier', () => {
    expect(temperatureThresholds(100)).toEqual({ warning: 85, critical: 100 })
    expect(temperatureTone(84.9, 100)).toBe('normal')
    expect(temperatureTone(85, 100)).toBe('high')
    expect(temperatureTone(100, 100)).toBe('critical')
    expect(temperatureTone(65, 65)).toBe('critical')
  })

  it('uses display defaults only when a sensor limit is unavailable', () => {
    for (const limit of [undefined, 0, -1, NaN, Infinity]) {
      expect(temperatureTone(69.9, limit)).toBe('normal')
      expect(temperatureTone(70, limit)).toBe('high')
      expect(temperatureTone(85, limit)).toBe('critical')
    }
    expect(temperatureTone(50, undefined, 'disk')).toBe('high')
    expect(temperatureTone(60, undefined, 'disk')).toBe('critical')
    expect(temperatureTone(60, undefined, 'nvme')).toBe('normal')
    expect(temperatureTone(70, undefined, 'nvme')).toBe('high')
    expect(temperatureTone(80, undefined, 'nvme')).toBe('critical')
  })

  it('keeps load and IO wait thresholds separate from utilization', () => {
    expect(highValueTone(1, 1, 1.5)).toBe('high')
    expect(highValueTone(1.5, 1, 1.5)).toBe('critical')
    expect(highValueTone(0.1, 0.1, 0.2)).toBe('high')
    expect(highValueTone(0.2, 0.1, 0.2)).toBe('critical')
  })

  it.each([
    ['pci0000:00_0000:00:18_3/temp1', 'k10temp · Tctl', 'cpu'],
    ['platform_coretemp_0/temp1', 'coretemp · Package id 0', 'cpu'],
    ['thermal/0', 'cpu-thermal · 0', 'cpu'],
    ['thermal/0', 'x86_pkg_temp · 0', 'cpu'],
    ['cpu0/temp1', 'CPU 温度', 'cpu'],
    ['scsi0/temp1', 'drivetemp · temp1', 'disk'],
    ['hwmon1/temp1', 'SATA SSD', 'disk'],
    ['nvme0/temp1', 'nvme · Composite', 'nvme'],
    ['pci0000:00_0000:01:00_0/temp1', 'NVMe SSD · Sensor 1', 'nvme'],
    ['acpitz/temp1', 'acpitz · temp1', 'sensor'],
    ['amdgpu/temp1', 'amdgpu · edge', 'sensor'],
    ['board/temp1', '主板温度', 'sensor'],
  ] as const)('identifies the temperature category for %s / %s', (id, name, kind) => {
    expect(sensorTemperatureKind({ id, name })).toBe(kind)
  })

  it('uses different defaults for identical CPU, disk and NVMe temperatures', () => {
    expect(temperatureTone(60, undefined, 'cpu')).toBe('normal')
    expect(temperatureTone(60, undefined, 'disk')).toBe('critical')
    expect(temperatureTone(60, undefined, 'nvme')).toBe('normal')
    expect(temperatureTone(80, undefined, 'cpu')).toBe('high')
    expect(temperatureTone(80, undefined, 'nvme')).toBe('critical')
  })

  it('preserves category warning margins when using reported critical limits', () => {
    expect(temperatureThresholds(100, 'cpu')).toEqual({ warning: 85, critical: 100 })
    expect(temperatureThresholds(60, 'disk')).toEqual({ warning: 50, critical: 60 })
    expect(temperatureThresholds(85, 'nvme')).toEqual({ warning: 75, critical: 85 })
    expect(temperatureTone(74.9, 85, 'nvme')).toBe('normal')
    expect(temperatureTone(75, 85, 'nvme')).toBe('high')
    expect(temperatureTone(85, 85, 'nvme')).toBe('critical')
  })

  it('explains the category and threshold source without treating unknown sensors as CPUs', () => {
    expect(temperatureHint(undefined, 'cpu')).toContain('CPU：温度 ≥ 70 °C')
    expect(temperatureHint(undefined, 'disk')).toContain('非 NVMe 磁盘：温度 ≥ 50 °C')
    expect(temperatureHint(undefined, 'nvme')).toContain('默认提醒阈值')
    expect(temperatureHint(85, 'nvme')).toContain('依据传感器临界值')
    expect(temperatureHint(0, 'disk')).toContain('默认提醒阈值')
    expect(temperatureHint(undefined, sensorTemperatureKind())).toContain('未识别类型的传感器')
  })

  it('uses both NVMe thresholds without deriving the warning from the critical value', () => {
    expect(temperatureThresholds(90, 'nvme', 82)).toEqual({ warning: 82, critical: 90 })
    expect(temperatureTone(81.9, 90, 'nvme', 82)).toBe('normal')
    expect(temperatureTone(82, 90, 'nvme', 82)).toBe('high')
    expect(temperatureTone(90, 90, 'nvme', 82)).toBe('critical')
    expect(temperatureHint(90, 'nvme', 82)).toContain('设备上报的两档阈值')
  })

  it('preserves a lone warning threshold above the usual fallback critical value', () => {
    expect(temperatureThresholds(undefined, 'nvme', 82)).toEqual({ warning: 82, critical: 92 })
    expect(temperatureTone(81, undefined, 'nvme', 82)).toBe('normal')
    expect(temperatureTone(82, undefined, 'nvme', 82)).toBe('high')
    expect(temperatureHint(undefined, 'nvme', 82)).toContain('严重值为推算提醒阈值')
  })

  it('rejects invalid and reversed device thresholds and handles equal thresholds', () => {
    for (const warning of [0, -1, NaN, Infinity, 65535, 91]) {
      expect(temperatureThresholds(90, 'nvme', warning)).toEqual({ warning: 80, critical: 90 })
    }
    expect(temperatureThresholds(65535, 'nvme', 0)).toEqual({ warning: 70, critical: 80 })
    expect(temperatureTone(80, 80, 'nvme', 80)).toBe('critical')
  })
})
