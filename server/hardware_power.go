package main

import "time"

// Recent samples are shared across viewers in the existing per-node cache.
// No background worker, node-side sampler, or power-only HTTP request is needed.
const hardwarePowerMaxAge = 15 * time.Second

func calculateHardwarePower(s *hardwareSnapshot, previous *hardwareSnapshot, now time.Time) {
	if len(s.energy) == 0 {
		return
	}
	s.PowerPending = true
	if previous == nil {
		return
	}
	if len(previous.energy) != len(s.energy) {
		retainHardwarePower(s, previous, now)
		return
	}
	elapsed := now.Sub(previous.UpdatedAt)
	if elapsed <= 0 || elapsed > hardwarePowerMaxAge {
		retainHardwarePower(s, previous, now)
		return
	}
	sum := 0.0
	for key, value := range s.energy {
		old, ok := previous.energy[key]
		// Exporter counters have no wrap range. Reset the baseline after a wrap,
		// restart, missing socket, or negative counter instead of inventing watts;
		// RAPL wraps every few tens of minutes, so keep a fresh value meanwhile.
		if !ok || value < 0 || old < 0 || value < old {
			retainHardwarePower(s, previous, now)
			return
		}
		sum += value - old
	}
	if elapsed < time.Second {
		// A manual refresh can arrive before a useful interval has elapsed.
		retainHardwarePower(s, previous, now)
		return
	}
	value := sum / elapsed.Seconds()
	if value >= 0 && value < 10000 {
		s.CPUWatts = &value
		s.PowerUpdatedAt = now
		s.PowerSampleSeconds = elapsed.Seconds()
		s.PowerPending = false
	}
}

// Carry a still-fresh computed value forward with its original timestamp and
// window, so it expires on schedule instead of looking newly sampled.
func retainHardwarePower(s *hardwareSnapshot, previous *hardwareSnapshot, now time.Time) {
	if previous.CPUWatts == nil || previous.PowerUpdatedAt.IsZero() {
		return
	}
	if age := now.Sub(previous.PowerUpdatedAt); age < 0 || age > hardwarePowerMaxAge {
		return
	}
	value := *previous.CPUWatts
	s.CPUWatts = &value
	s.PowerUpdatedAt = previous.PowerUpdatedAt
	s.PowerSampleSeconds = previous.PowerSampleSeconds
	s.PowerPending = false
}

func expireHardwarePower(s *hardwareSnapshot, now time.Time) {
	if s.CPUWatts != nil && (s.PowerUpdatedAt.IsZero() || now.Sub(s.PowerUpdatedAt) < 0 || now.Sub(s.PowerUpdatedAt) > hardwarePowerMaxAge) {
		s.CPUWatts = nil
		s.PowerUpdatedAt = time.Time{}
		s.PowerSampleSeconds = 0
		s.PowerPending = len(s.energy) > 0
		s.PowerError = "功耗缓存已过期"
	}
}
