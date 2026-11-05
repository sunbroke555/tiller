package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestHardwareNVMeTemperatureThresholds(t *testing.T) {
	for _, tc := range []struct {
		name, metrics     string
		warning, critical float64
	}{
		{"both", "temperature_warning_celsius 82\ntemperature_critical_celsius 90", 82, 90},
		{"warning only", "temperature_warning_celsius 82", 82, 0},
		{"critical only", "temperature_critical_celsius 90", 0, 90},
		{"reversed", "temperature_warning_celsius 95\ntemperature_critical_celsius 90", 0, 90},
		{"equal", "temperature_warning_celsius 80\ntemperature_critical_celsius 80", 80, 80},
		{"invalid", "temperature_warning_celsius NaN\ntemperature_critical_celsius 65535", 0, 0},
		{"unreported", "temperature_warning_celsius 0\ntemperature_critical_celsius -273", 0, 0},
		{"old collector", "", 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw := "node_exporter_build_info 1\nnode_tiller_smart_collector_version 2\n"
			for _, device := range []string{"/dev/nvme0n1", "/dev/sda"} {
				raw += fmt.Sprintf("node_tiller_smart_disk_info{device=%q,state=\"online\"} 1\n", device)
				for _, line := range strings.Split(tc.metrics, "\n") {
					fields := strings.Fields(line)
					if len(fields) == 2 {
						raw += fmt.Sprintf("node_tiller_smart_disk_%s{device=%q} %s\n", fields[0], device, fields[1])
					}
				}
			}
			if tc.name == "old collector" {
				raw = strings.Replace(raw, "collector_version 2", "collector_version 1", 1)
			}
			s, err := parseHardwareMetrics(raw, nil, time.Now())
			if err != nil {
				t.Fatal(err)
			}
			if !s.SmartAuto || len(s.Disks) != 2 {
				t.Fatalf("snapshot: %+v", s)
			}
			if tc.name != "old collector" && s.SmartCollectorVersion != 2 {
				t.Fatal("collector version lost")
			}
			for _, pair := range []struct {
				got  *float64
				want float64
			}{
				{s.Disks[0].TemperatureWarning, tc.warning}, {s.Disks[0].TemperatureCritical, tc.critical},
				{s.Disks[1].TemperatureWarning, 0}, {s.Disks[1].TemperatureCritical, 0},
			} {
				if pair.want == 0 && pair.got != nil || pair.want != 0 && (pair.got == nil || *pair.got != pair.want) {
					t.Fatalf("threshold: got %v, want %v", pair.got, pair.want)
				}
			}
			encoded, err := json.Marshal(s.Disks[0])
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(encoded), `"temperatureWarning"`) != (tc.warning != 0) || strings.Contains(string(encoded), `"temperatureCritical"`) != (tc.critical != 0) {
				t.Fatalf("threshold API fields: %s", encoded)
			}
		})
	}
}

func TestHardwareNVMeHwmonThresholdsStayWithTheirSensor(t *testing.T) {
	s, err := parseHardwareMetrics(`node_exporter_build_info 1
node_hwmon_chip_names{chip="pci0",chip_name="nvme"} 1
node_hwmon_sensor_label{chip="pci0",sensor="temp1",label="Composite"} 1
node_hwmon_temp_celsius{chip="pci0",sensor="temp1"} 81
node_hwmon_temp_max_celsius{chip="pci0",sensor="temp1"} 82
node_hwmon_temp_crit_celsius{chip="pci0",sensor="temp1"} 90
node_hwmon_temp_celsius{chip="pci0",sensor="temp2"} 82
node_hwmon_temp_max_celsius{chip="pci0",sensor="temp2"} 65261
node_hwmon_chip_names{chip="cpu0",chip_name="coretemp"} 1
node_hwmon_temp_celsius{chip="cpu0",sensor="temp1"} 70
node_hwmon_temp_max_celsius{chip="cpu0",sensor="temp1"} 80
node_hwmon_temp_crit_celsius{chip="cpu0",sensor="temp1"} 100
`, nil, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Temperatures) != 3 {
		t.Fatalf("temperatures: %+v", s.Temperatures)
	}
	for _, r := range s.Temperatures {
		if r.ID == "pci0/temp1" {
			if r.WarningLimit == nil || *r.WarningLimit != 82 || r.Limit == nil || *r.Limit != 90 {
				t.Fatalf("NVMe composite thresholds lost: %+v", r)
			}
		} else if r.WarningLimit != nil {
			t.Fatalf("threshold incorrectly applied to %s", r.ID)
		}
	}
}
