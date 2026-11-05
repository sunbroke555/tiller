package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func raplMetrics(joules float64) string {
	return fmt.Sprintf("node_exporter_build_info 1\nnode_rapl_package_joules_total{path=\"socket0\",index=\"0\"} %f\n", joules)
}

func TestHardwarePowerIntervalAndCache(t *testing.T) {
	now := time.Now()
	first, _ := parseHardwareMetrics(raplMetrics(100), nil, now)
	second, _ := parseHardwareMetrics(raplMetrics(125), &first, now.Add(5*time.Second))
	if second.CPUWatts == nil || *second.CPUWatts != 5 || second.PowerPending || second.PowerSampleSeconds != 5 || !second.PowerUpdatedAt.Equal(now.Add(5*time.Second)) {
		t.Fatalf("wrong interval power: %+v", second)
	}
	for _, tc := range []struct {
		name    string
		joules  float64
		elapsed time.Duration
		want    *float64
	}{
		{"early-refresh-retains-cache", 126, 500 * time.Millisecond, second.CPUWatts},
		{"zero-is-valid", 125, 5 * time.Second, new(float64)},
		{"expired-baseline", 200, 16 * time.Second, nil},
		{"clock-went-back", 130, -time.Second, nil},
		{"counter-wrap-retains-cache", 2, 5 * time.Second, second.CPUWatts},
		{"negative-counter-retains-cache", -1, 5 * time.Second, second.CPUWatts},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := parseHardwareMetrics(raplMetrics(tc.joules), &second, second.UpdatedAt.Add(tc.elapsed))
			if (s.CPUWatts == nil) != (tc.want == nil) || (s.CPUWatts != nil && *s.CPUWatts != *tc.want) {
				t.Fatalf("%+v", s)
			}
			if tc.want == second.CPUWatts && (!s.PowerUpdatedAt.Equal(second.PowerUpdatedAt) || s.PowerSampleSeconds != 5 || s.PowerPending) {
				t.Fatal("retained value falsely renewed cache")
			}
		})
	}
	wrapped, _ := parseHardwareMetrics(raplMetrics(2), &second, second.UpdatedAt.Add(5*time.Second))
	after, _ := parseHardwareMetrics(raplMetrics(52), &wrapped, wrapped.UpdatedAt.Add(5*time.Second))
	if after.CPUWatts == nil || *after.CPUWatts != 10 || !after.PowerUpdatedAt.Equal(wrapped.UpdatedAt.Add(5*time.Second)) {
		t.Fatalf("poll after wrap did not resume from the new baseline: %+v", after)
	}
	expireHardwarePower(&second, now.Add(19*time.Second))
	if second.CPUWatts == nil {
		t.Fatal("fresh cache expired")
	}
	expireHardwarePower(&second, now.Add(21*time.Second))
	if second.CPUWatts != nil || second.PowerError == "" || !second.PowerPending {
		t.Fatal("expired cache shown as current")
	}
	unsupported, _ := parseHardwareMetrics("node_exporter_build_info 1\n", nil, now)
	if unsupported.PowerPending || unsupported.CPUWatts != nil {
		t.Fatal("missing counters fabricated power")
	}
	legacy, _ := parseHardwareMetrics(raplMetrics(100)+"node_tiller_power_collector_version 1\nnode_tiller_power_watts 999\n", nil, now)
	if legacy.PowerCollectorVersion != 1 || legacy.CPUWatts != nil || !legacy.PowerPending {
		t.Fatal("legacy local watts replaced interval calculation")
	}
}

func TestHardwarePowerSharesNormalPollCache(t *testing.T) {
	var reads atomic.Int32
	var fail atomic.Bool
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := reads.Add(1)
		if strings.Join(r.URL.Query()["collect[]"], ",") != "hwmon,rapl,cpufreq,powersupplyclass,uname,thermal_zone,textfile" {
			t.Error("unexpected power-only request")
		}
		if fail.Load() {
			w.WriteHeader(503)
			return
		}
		fmt.Fprint(w, raplMetrics(float64(n)*100))
	}))
	defer exporter.Close()
	pve := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, `{"data":{}}`) }))
	defer pve.Close()
	h := newHardwareService(&Config{InstancesFile: filepath.Join(t.TempDir(), "instances.json")}, InstanceConfig{ID: "one", Version: "v1", URL: pve.URL}, http.DefaultTransport, http.DefaultTransport.(*http.Transport))
	conn := hardwareConnection{Enabled: true, Managed: true, Version: 4, URL: exporter.URL}
	if _, err := h.connection("lab", &conn); err != nil {
		t.Fatal(err)
	}
	get := func() hardwareSnapshot {
		r := httptest.NewRequest("GET", "/api/hardware/lab", nil)
		r = r.WithContext(context.WithValue(r.Context(), adminContextKey{}, &adminSession{}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		var s hardwareSnapshot
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &s) != nil {
			t.Fatalf("GET: %s", w.Body.String())
		}
		return s
	}
	for i := 0; i < 10; i++ {
		s := get()
		if s.CPUWatts != nil || !s.PowerPending {
			t.Fatal("cold read needs normal next poll")
		}
	}
	if reads.Load() != 1 {
		t.Fatal("cold viewers triggered extra samples")
	}
	c := h.cache("lab")
	c.mu.Lock()
	c.checked = time.Now().Add(-6 * time.Second)
	c.snapshot.UpdatedAt = time.Now().Add(-5 * time.Second)
	c.mu.Unlock()
	s := get()
	if s.CPUWatts == nil || math.Abs(*s.CPUWatts-20) > 1 || s.PowerPending {
		t.Fatalf("second normal poll missing watts: %+v", s)
	}
	at := s.PowerUpdatedAt
	for i := 0; i < 10; i++ {
		s = get()
		if s.CPUWatts == nil || !s.PowerUpdatedAt.Equal(at) {
			t.Fatal("reopened page did not reuse fresh cache")
		}
	}
	if reads.Load() != 2 {
		t.Fatal("reopened pages made extra exporter calls")
	}
	fail.Store(true)
	c.mu.Lock()
	c.checked = time.Now().Add(-6 * time.Second)
	c.mu.Unlock()
	if s = get(); s.Connected || s.CPUWatts == nil {
		t.Fatal("brief outage should preserve fresh cache with disconnected status")
	}
	c.mu.Lock()
	c.snapshot.PowerUpdatedAt = time.Now().Add(-16 * time.Second)
	c.mu.Unlock()
	if s = get(); s.CPUWatts != nil || s.PowerError == "" {
		t.Fatal("outage served expired watts")
	}
	fail.Store(false)
	c.mu.Lock()
	c.checked = time.Now().Add(-6 * time.Second)
	c.snapshot.UpdatedAt = time.Now().Add(-time.Minute)
	c.mu.Unlock()
	if s = get(); s.CPUWatts != nil || !s.PowerPending {
		t.Fatal("long absence must reset baseline")
	}
	c.mu.Lock()
	c.checked = time.Now().Add(-6 * time.Second)
	c.snapshot.UpdatedAt = time.Now().Add(-5 * time.Second)
	c.mu.Unlock()
	if s = get(); s.CPUWatts == nil || s.PowerPending {
		t.Fatal("next normal poll should restore watts")
	}
}

func TestHardwarePowerMigrationScripts(t *testing.T) {
	for _, owner := range []string{"one:lab", "another:lab"} {
		t.Run(owner, func(t *testing.T) {
			dir := t.TempDir()
			config := filepath.Join(dir, "config")
			units := filepath.Join(dir, "units")
			run := filepath.Join(dir, "run")
			bin := filepath.Join(dir, "bin")
			for _, p := range []string{config, units, run, bin} {
				os.MkdirAll(p, 0700)
			}
			os.WriteFile(filepath.Join(config, "owner"), []byte(owner), 0600)
			for _, p := range []string{filepath.Join(config, "power.py"), filepath.Join(run, "power.prom"), filepath.Join(units, "tiller-power-collector.service"), filepath.Join(units, "tiller-node-exporter.service")} {
				os.WriteFile(p, []byte("fixture"), 0600)
			}
			state := filepath.Join(dir, "state.json")
			os.WriteFile(state, []byte(`{"active":true,"enabled":true,"calls":[],"purged":[]}`), 0600)
			runner := filepath.Join(bin, "runner")
			os.WriteFile(runner, []byte(hardwareControlCommandStub), 0700)
			for _, name := range []string{"id", "systemctl"} {
				os.Symlink(runner, filepath.Join(bin, name))
			}
			h := &hardwareService{instance: InstanceConfig{ID: "one"}}
			script := h.hardwareScriptsUpgrade("lab")
			for _, bad := range []string{"apt-get", "dpkg", "turbostat", "cert.pem", "key.pem", "web.yml", "restart tiller-node-exporter", "@SMART_COLLECTOR@"} {
				if strings.Contains(script, bad) {
					t.Fatalf("migration contains %q", bad)
				}
			}
			script = strings.NewReplacer("/etc/tiller-node-exporter", config, "/etc/systemd/system", units, "/run/tiller-node-exporter", run).Replace(script)
			cmd := exec.Command("bash", "-s")
			cmd.Stdin = strings.NewReader(script)
			cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "CONTROL_STATE="+state)
			out, err := cmd.CombinedOutput()
			if owner != "one:lab" {
				if err == nil {
					t.Fatal("wrong owner accepted")
				}
				if _, e := os.Stat(filepath.Join(config, "power.py")); e != nil {
					t.Fatal("wrong owner's sampler changed")
				}
				return
			}
			if err != nil {
				t.Fatalf("%v\n%s", err, out)
			}
			for _, p := range []string{filepath.Join(config, "power.py"), filepath.Join(run, "power.prom"), filepath.Join(units, "tiller-power-collector.service")} {
				if _, e := os.Stat(p); !os.IsNotExist(e) {
					t.Fatalf("legacy sampler remains: %s", p)
				}
			}
			data, _ := os.ReadFile(filepath.Join(units, "tiller-node-exporter.service"))
			if string(data) != "fixture" {
				t.Fatal("exporter unit changed")
			}
			var result struct {
				Active, Enabled bool
				Calls           []string
			}
			data, _ = os.ReadFile(state)
			json.Unmarshal(data, &result)
			if result.Active || result.Enabled {
				t.Fatal("sampler remains enabled")
			}
		})
	}
}
