package main

import (
	"bufio"
	"errors"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type hardwareReading struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Value        float64  `json:"value"`
	Limit        *float64 `json:"limit,omitempty"`
	WarningLimit *float64 `json:"warningLimit,omitempty"`
}

type hardwareBattery struct {
	Name    string   `json:"name"`
	Charge  *float64 `json:"charge,omitempty"`
	Runtime *float64 `json:"runtime,omitempty"`
	Load    *float64 `json:"load,omitempty"`
	Voltage *float64 `json:"voltage,omitempty"`
	Status  string   `json:"status,omitempty"`
	Source  string   `json:"source"`
}

type hardwareDisk struct {
	Device              string    `json:"device"`
	Model               string    `json:"model"`
	Health              string    `json:"health"`
	Temperature         *float64  `json:"temperature,omitempty"`
	TemperatureWarning  *float64  `json:"temperatureWarning,omitempty"`
	TemperatureCritical *float64  `json:"temperatureCritical,omitempty"`
	Life                *float64  `json:"life,omitempty"`
	State               string    `json:"state,omitempty"`
	UpdatedAt           time.Time `json:"updatedAt,omitempty"`
}

type hardwareSnapshot struct {
	Enabled               bool              `json:"enabled"`
	Connected             bool              `json:"connected"`
	Managed               bool              `json:"managed"`
	Paused                bool              `json:"paused,omitempty"`
	Notice                string            `json:"notice,omitempty"`
	UpdatedAt             time.Time         `json:"updatedAt,omitempty"`
	Error                 string            `json:"error,omitempty"`
	Temperatures          []hardwareReading `json:"temperatures"`
	Fans                  []hardwareReading `json:"fans"`
	Powers                []hardwareReading `json:"powers"`
	Batteries             []hardwareBattery `json:"batteries"`
	CPUWatts              *float64          `json:"cpuWatts,omitempty"`
	PowerUpdatedAt        time.Time         `json:"powerUpdatedAt,omitempty"`
	PowerSampleSeconds    float64           `json:"powerSampleSeconds,omitempty"`
	PowerError            string            `json:"powerError,omitempty"`
	PowerCollectorVersion int               `json:"powerCollectorVersion,omitempty"`
	FrequencyGHz          *float64          `json:"frequencyGHz,omitempty"`
	PowerPending          bool              `json:"powerPending"`
	Disks                 []hardwareDisk    `json:"disks"`
	DisksUpdatedAt        time.Time         `json:"disksUpdatedAt,omitempty"`
	SmartAuto             bool              `json:"smartAuto"`
	SmartCollectorVersion int               `json:"smartCollectorVersion,omitempty"`
	CollectorErrors       []string          `json:"collectorErrors,omitempty"`
	energy                map[string]float64
}

type metricSample struct {
	name   string
	labels map[string]string
	value  float64
}

var metricLine = regexp.MustCompile(`^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})?\s+([^\s]+)(?:\s+[^\s]+)?$`)
var metricLabel = regexp.MustCompile(`^\s*([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\[\\"n])*)"\s*(?:,|$)`)

// Only the small set of node_exporter hardware metrics is interpreted. Invalid
// values never become zero readings, and untrusted labels are plain text.
func parseHardwareMetrics(raw string, previous *hardwareSnapshot, now time.Time) (hardwareSnapshot, error) {
	s := hardwareSnapshot{Connected: true, UpdatedAt: now, Temperatures: []hardwareReading{}, Fans: []hardwareReading{}, Powers: []hardwareReading{}, Batteries: []hardwareBattery{}, Disks: []hardwareDisk{}, energy: map[string]float64{}}
	var samples []metricSample
	scan := bufio.NewScanner(strings.NewReader(raw))
	scan.Buffer(make([]byte, 4096), 128<<10)
	valid := false
	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if !strings.HasPrefix(line, "node_") {
			continue
		}
		m := metricLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		v, e := strconv.ParseFloat(m[3], 64)
		if e != nil || math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		labels := map[string]string{}
		if m[2] != "" {
			rest := m[2][1 : len(m[2])-1]
			for rest != "" {
				l := metricLabel.FindStringSubmatch(rest)
				if l == nil {
					return s, errors.New("采集服务返回了无效的指标标签")
				}
				value, e := strconv.Unquote(`"` + l[2] + `"`)
				if e != nil {
					return s, e
				}
				labels[l[1]] = value
				rest = rest[len(l[0]):]
			}
		}
		if m[1] == "node_exporter_build_info" {
			valid = true
		}
		samples = append(samples, metricSample{m[1], labels, v})
	}
	if err := scan.Err(); err != nil {
		return s, err
	}
	if !valid {
		return s, errors.New("目标没有返回 node_exporter 指标")
	}
	parseHardwareSMART(samples, &s, now)
	chips, labels, limits := map[string]string{}, map[string]string{}, map[string]float64{}
	warnings := map[string]float64{}
	batteries := map[string]*hardwareBattery{}
	key := func(m metricSample) string { return m.labels["chip"] + "/" + m.labels["sensor"] }
	for _, m := range samples {
		switch m.name {
		case "node_hwmon_chip_names":
			chips[m.labels["chip"]] = m.labels["chip_name"]
		case "node_hwmon_sensor_label":
			labels[key(m)] = m.labels["label"]
		case "node_hwmon_temp_crit_celsius":
			limits[key(m)] = m.value
		case "node_hwmon_temp_max_celsius":
			warnings[key(m)] = m.value
		}
	}
	var freq float64
	var freqCount int
	var thermal []hardwareReading
	for _, m := range samples {
		name := labels[key(m)]
		if name == "" {
			name = m.labels["sensor"]
		}
		chip := chips[m.labels["chip"]]
		if chip == "" {
			chip = m.labels["chip"]
		}
		if chip != "" {
			name = chip + " · " + name
		}
		r := hardwareReading{ID: key(m), Name: name, Value: m.value}
		switch m.name {
		case "node_thermal_zone_temp":
			if m.value >= -50 && m.value <= 200 {
				thermal = append(thermal, hardwareReading{ID: "thermal/" + m.labels["zone"], Name: m.labels["type"] + " · " + m.labels["zone"], Value: m.value})
			}
		case "node_hwmon_temp_celsius":
			if m.value < -50 || m.value > 200 {
				continue
			}
			if v, ok := limits[key(m)]; ok && v > 0 && v <= 200 {
				r.Limit = &v
			}
			// NVMe exposes its current over-temperature threshold via hwmon.
			// Do not apply a controller's composite threshold to other sensors.
			if chip == "nvme" {
				if v, ok := warnings[key(m)]; ok && v > 0 && v <= 200 && (r.Limit == nil || v <= *r.Limit) {
					r.WarningLimit = &v
				}
			}
			s.Temperatures = append(s.Temperatures, r)
		case "node_hwmon_fan_rpm":
			if m.value >= 0 && m.value < 100000 {
				s.Fans = append(s.Fans, r)
			}
		case "node_tiller_power_collector_version":
			// Legacy sampler detection only, never use its cached watts.
			if m.value >= 1 && m.value < 100 {
				s.PowerCollectorVersion = int(m.value)
			}
		case "node_hwmon_power_watt":
			if m.value >= 0 {
				s.Powers = append(s.Powers, r)
			}
		case "node_cpu_scaling_frequency_hertz":
			if m.value > 0 {
				freq += m.value
				freqCount++
			}
		case "node_scrape_collector_success":
			if m.value == 0 {
				switch m.labels["collector"] {
				case "hwmon", "rapl", "cpufreq", "powersupplyclass":
					s.CollectorErrors = append(s.CollectorErrors, m.labels["collector"])
				}
			}
		}
		// Package counters only: summing the cores/DRAM subzones would double
		// count CPU energy. Negative deltas (wrap/reset) require a new baseline.
		if m.name == "node_rapl_package_joules_total" || (m.name == "node_rapl_joules_total" && strings.HasPrefix(m.labels["rapl_zone"], "package")) {
			s.energy[m.labels["path"]+"/"+m.labels["index"]] = m.value
		}
		if strings.HasPrefix(m.name, "node_power_supply_") {
			n := m.labels["power_supply"]
			if n == "" {
				continue
			}
			b := batteries[n]
			if b == nil {
				b = &hardwareBattery{Name: n, Source: "battery"}
				batteries[n] = b
			}
			switch m.name {
			case "node_power_supply_info":
				b.Status = m.labels["status"]
				if model := m.labels["model_name"]; model != "" {
					b.Name = n + " · " + model
				}
			case "node_power_supply_capacity":
				if m.value >= 0 && m.value <= 100 {
					v := m.value
					b.Charge = &v
				}
			case "node_power_supply_time_to_empty_seconds":
				if m.value >= 0 {
					v := m.value
					b.Runtime = &v
				}
			case "node_power_supply_voltage_volt":
				v := m.value
				b.Voltage = &v
			case "node_power_supply_status":
				if m.value == 1 {
					b.Status = m.labels["status"]
				}
			}
		}
	}
	if freqCount > 0 {
		v := freq / float64(freqCount) / 1e9
		s.FrequencyGHz = &v
	}
	if len(s.Temperatures) == 0 {
		s.Temperatures = thermal
	}
	calculateHardwarePower(&s, previous, now)
	for _, b := range batteries {
		if b.Charge != nil {
			s.Batteries = append(s.Batteries, *b)
		}
	}
	sort.Slice(s.Batteries, func(i, j int) bool { return s.Batteries[i].Name < s.Batteries[j].Name })
	for _, readings := range [][]hardwareReading{s.Temperatures, s.Fans, s.Powers} {
		sort.Slice(readings, func(i, j int) bool { return readings[i].Name < readings[j].Name })
	}
	return s, nil
}

// SMART is read from the collector's atomic cache file, not from a request-time
// disk command. Each disk retains its own last successful sample timestamp.
func parseHardwareSMART(samples []metricSample, s *hardwareSnapshot, now time.Time) {
	disks := map[string]*hardwareDisk{}
	stamp := func(v float64) time.Time {
		if v > 0 && v <= float64(now.Unix()+300) {
			return time.Unix(int64(v), 0).UTC()
		}
		return time.Time{}
	}
	for _, m := range samples {
		switch m.name {
		case "node_tiller_smart_collector_version":
			s.SmartAuto = m.value >= 1
			if m.value >= 1 && m.value <= 1000 {
				s.SmartCollectorVersion = int(m.value)
			}
		case "node_tiller_smart_collection_timestamp_seconds":
			s.DisksUpdatedAt = stamp(m.value)
		case "node_tiller_smart_disk_info":
			device := m.labels["device"]
			if !regexp.MustCompile(`^/dev/(sd[a-z]+|nvme[0-9]+n[0-9]+)$`).MatchString(device) {
				continue
			}
			state := m.labels["state"]
			switch state {
			case "online", "sleeping", "unsupported", "error":
			default:
				state = "error"
			}
			disks[device] = &hardwareDisk{Device: device, Model: m.labels["model"], State: state, Health: "UNKNOWN"}
		}
	}
	for _, m := range samples {
		d := disks[m.labels["device"]]
		if d == nil {
			continue
		}
		switch m.name {
		case "node_tiller_smart_disk_sample_timestamp_seconds":
			d.UpdatedAt = stamp(m.value)
		case "node_tiller_smart_disk_temperature_celsius":
			if m.value >= -50 && m.value <= 150 {
				v := m.value
				d.Temperature = &v
			}
		case "node_tiller_smart_disk_temperature_warning_celsius", "node_tiller_smart_disk_temperature_critical_celsius":
			if strings.HasPrefix(d.Device, "/dev/nvme") && m.value > 0 && m.value <= 200 {
				v := m.value
				if m.name == "node_tiller_smart_disk_temperature_warning_celsius" {
					d.TemperatureWarning = &v
				} else {
					d.TemperatureCritical = &v
				}
			}
		case "node_tiller_smart_disk_life_remaining_percent":
			if m.value >= 0 && m.value <= 100 {
				v := m.value
				d.Life = &v
			}
		case "node_tiller_smart_disk_health_passed":
			if m.value == 1 {
				d.Health = "PASSED"
			} else if m.value == 0 {
				d.Health = "FAILED"
			}
		}
	}
	for _, d := range disks {
		if d.TemperatureWarning != nil && d.TemperatureCritical != nil && *d.TemperatureWarning > *d.TemperatureCritical {
			d.TemperatureWarning = nil
		}
		s.Disks = append(s.Disks, *d)
	}
	sort.Slice(s.Disks, func(i, j int) bool { return s.Disks[i].Device < s.Disks[j].Device })
}
