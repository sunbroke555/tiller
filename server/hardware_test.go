package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const hardwareFixture = `node_exporter_build_info{version="1.9.0"} 1
node_hwmon_chip_names{chip="cpu0",chip_name="coretemp"} 1
node_hwmon_sensor_label{chip="cpu0",sensor="temp1",label="Package id 0"} 1
node_hwmon_temp_celsius{chip="cpu0",sensor="temp1"} 48.5
node_hwmon_temp_crit_celsius{chip="cpu0",sensor="temp1"} 100
node_hwmon_temp_celsius{chip="broken",sensor="temp1"} NaN
node_hwmon_temp_celsius{chip="broken",sensor="temp2"} +Inf
node_hwmon_fan_rpm{chip="board",sensor="fan1"} 0
node_hwmon_fan_rpm{chip="board",sensor="fan2"} 1100
node_cpu_scaling_frequency_hertz{cpu="0"} 2000000000
node_cpu_scaling_frequency_hertz{cpu="1"} 4000000000
node_power_supply_capacity{power_supply="BAT0"} 0
node_power_supply_info{power_supply="BAT0",status="Discharging",model_name="Test battery"} 1
node_scrape_collector_success{collector="hwmon"} 1
node_scrape_collector_success{collector="rapl"} 0
`

func TestHardwareMetrics(t *testing.T) {
	now := time.Now()
	s, e := parseHardwareMetrics(hardwareFixture, nil, now)
	if e != nil {
		t.Fatal(e)
	}
	if len(s.Temperatures) != 1 || s.Temperatures[0].Value != 48.5 || s.Temperatures[0].Name != "coretemp · Package id 0" || *s.Temperatures[0].Limit != 100 {
		t.Fatalf("temperatures: %+v", s.Temperatures)
	}
	if len(s.Fans) != 2 || s.Fans[0].Value != 0 {
		t.Fatalf("stopped fan lost: %+v", s.Fans)
	}
	if s.FrequencyGHz == nil || *s.FrequencyGHz != 3 {
		t.Fatal("incorrect frequency unit")
	}
	if len(s.Batteries) != 1 || *s.Batteries[0].Charge != 0 || s.Batteries[0].Status != "Discharging" {
		t.Fatalf("battery: %+v", s.Batteries)
	}
	if len(s.CollectorErrors) != 1 || s.CollectorErrors[0] != "rapl" {
		t.Fatal("collector error not reported")
	}
	if _, e = json.Marshal(s); e != nil {
		t.Fatal(e)
	}
	for _, invalid := range []string{"", "go_threads 7", `node_exporter_build_info{bad="\q"} 1`} {
		if _, e := parseHardwareMetrics(invalid, nil, now); e == nil {
			t.Fatalf("accepted %q", invalid)
		}
	}
	thermal, _ := parseHardwareMetrics("node_exporter_build_info 1\nnode_thermal_zone_temp{zone=\"0\",type=\"x86_pkg_temp\"} 43", nil, now)
	if len(thermal.Temperatures) != 1 || thermal.Temperatures[0].Value != 43 {
		t.Fatal("thermal zone fallback missing")
	}
	for _, text := range []string{"NaN", "+Inf", "", "unknown"} {
		if firstHardwareNumber(text) != nil {
			t.Fatalf("accepted %q", text)
		}
	}
}

func TestHardwareRAPL(t *testing.T) {
	now := time.Now()
	sample := func(a, b int) string {
		return fmt.Sprintf("node_exporter_build_info 1\nnode_rapl_package_joules_total{path=\"socket0\",index=\"0\"} %d\nnode_rapl_joules_total{path=\"socket1\",index=\"1\",rapl_zone=\"package\"} %d\nnode_rapl_joules_total{path=\"socket0/dram\",rapl_zone=\"dram\"} 999999\n", a, b)
	}
	first, _ := parseHardwareMetrics(sample(1000, 2000), nil, now)
	if first.CPUWatts != nil || !first.PowerPending {
		t.Fatal("first sample must wait for rate")
	}
	next, _ := parseHardwareMetrics(sample(1050, 2100), &first, now.Add(5*time.Second))
	if next.CPUWatts == nil || *next.CPUWatts != 30 || next.PowerPending {
		t.Fatalf("wrong package-only watts: %+v", next.CPUWatts)
	}
	for _, tc := range []struct {
		raw string
		at  time.Time
	}{{sample(10, 2600), now.Add(30 * time.Second)}, {sample(1300, 2600), now.Add(5 * time.Minute)}, {sample(1300, 2600), now}} {
		result, _ := parseHardwareMetrics(tc.raw, &first, tc.at)
		if result.CPUWatts != nil || !result.PowerPending {
			t.Fatal("reset/stale/zero interval must reset baseline")
		}
	}
}

func TestHardwareCachePermissionsAndManualSMART(t *testing.T) {
	var reads, smart atomic.Int32
	var denied atomic.Bool
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads.Add(1)
		collectors := r.URL.Query()["collect[]"]
		if len(collectors) != 6 || strings.Contains(strings.Join(collectors, ","), "filesystem") {
			t.Error("scrape must only request hardware collectors")
		}
		fmt.Fprint(w, hardwareFixture)
	}))
	defer exporter.Close()
	pve := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if denied.Load() {
			w.WriteHeader(403)
			return
		}
		switch r.URL.Path {
		case "/api2/json/nodes/lab/status":
			fmt.Fprint(w, `{"data":{"uptime":1}}`)
		case "/api2/json/nodes/lab/disks/list":
			if r.URL.Query().Get("skipsmart") != "1" {
				t.Error("disk list must skip SMART")
			}
			fmt.Fprint(w, `{"data":[{"devpath":"/dev/sda","model":"ATA disk"},{"devpath":"/dev/sda1","parent":"/dev/sda"},{"devpath":"/dev/nvme0n1","model":"NVMe disk"}]}`)
		case "/api2/json/nodes/lab/disks/smart":
			smart.Add(1)
			if r.URL.Query().Get("disk") == "/dev/sda" {
				fmt.Fprint(w, `{"data":{"health":"PASSED","attributes":[{"id":"194","name":"Temperature_Celsius","raw":"35 (Min/Max 20/40)"}]}}`)
			} else {
				fmt.Fprint(w, `{"data":{"health":"PASSED","text":"Temperature: 42 Celsius\nPercentage Used: 12%"}}`)
			}
		default:
			t.Errorf("unexpected PVE request: %s", r.URL)
			w.WriteHeader(404)
		}
	}))
	defer pve.Close()
	dir := t.TempDir()
	cfg := &Config{InstancesFile: filepath.Join(dir, "instances.json")}
	h := newHardwareService(cfg, InstanceConfig{ID: "one", Version: "v1", URL: pve.URL}, http.DefaultTransport, http.DefaultTransport.(*http.Transport))
	conn := hardwareConnection{Enabled: true, URL: exporter.URL}
	if _, e := h.connection("lab", &conn); e != nil {
		t.Fatal(e)
	}
	call := func(method, action string, authorized bool, want int) hardwareSnapshot {
		t.Helper()
		r := httptest.NewRequest(method, "/api/hardware/lab"+action, nil)
		if authorized {
			r = r.WithContext(context.WithValue(r.Context(), adminContextKey{}, &adminSession{}))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, action, w.Code, w.Body.String())
		}
		var s hardwareSnapshot
		if want == 200 {
			if e := json.Unmarshal(w.Body.Bytes(), &s); e != nil {
				t.Fatal(e)
			}
		}
		return s
	}
	call("GET", "", false, 401)
	s := call("GET", "", true, 200)
	if !s.Enabled || !s.Connected {
		t.Fatal("did not connect")
	}
	call("GET", "", true, 200)
	if reads.Load() != 1 || smart.Load() != 0 {
		t.Fatal("cache missed or automatic SMART read")
	}
	s = call("POST", "/disks", true, 200)
	if len(s.Disks) != 2 || *s.Disks[0].Temperature != 35 || *s.Disks[1].Life != 88 {
		t.Fatalf("SMART parse: %+v", s.Disks)
	}
	call("POST", "/disks", true, 200)
	if smart.Load() != 2 {
		t.Fatal("repeated SMART read within cache window")
	}
	denied.Store(true)
	call("GET", "", true, 403)
	denied.Store(false)
	call("DELETE", "", true, 200)
	s = call("GET", "", true, 200)
	if s.Enabled || reads.Load() != 1 {
		t.Fatal("paused monitoring still scrapes")
	}
	h.instance.Version = "v2"
	other, e := h.connection("lab", nil)
	if e != nil || other.URL != "" {
		t.Fatal("connection crossed instance version")
	}
	info, _ := os.Stat(h.file)
	if info.Mode().Perm() != 0600 {
		t.Fatal("connection file must be private")
	}
}

func TestHardwarePinnedTLSAndCredentialScope(t *testing.T) {
	auth := &localAuth{key: make([]byte, 32)}
	h := &hardwareService{auth: auth, instance: InstanceConfig{ID: "one", Version: "v1"}}
	encrypted, e := auth.seal("test-secret", "hardware:"+h.scope("lab"))
	if e != nil {
		t.Fatal(e)
	}
	exporter := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "tiller" || pass != "test-secret" {
			w.WriteHeader(401)
			return
		}
		fmt.Fprint(w, hardwareFixture)
	}))
	defer exporter.Close()
	sha := sha256.Sum256(exporter.Certificate().Raw)
	conn := hardwareConnection{URL: exporter.URL, Secret: encrypted, Fingerprint: hex.EncodeToString(sha[:]), Managed: true}
	if _, e = h.scrape(context.Background(), "lab", conn, nil); e != nil {
		t.Fatal(e)
	}
	if _, e = h.scrape(context.Background(), "another-node", conn, nil); e == nil {
		t.Fatal("credential crossed node scope")
	}
	conn.Fingerprint = strings.Repeat("00", 32)
	if _, e = h.scrape(context.Background(), "lab", conn, nil); e == nil {
		t.Fatal("accepted changed certificate")
	}
}

func TestHardwareAutomaticSMARTReadsCacheOnly(t *testing.T) {
	now := time.Now()
	last := now.Add(-2 * time.Hour).Unix()
	raw := fmt.Sprintf(`node_exporter_build_info 1
node_tiller_smart_collector_version 1
node_tiller_smart_collection_timestamp_seconds %d
node_tiller_smart_disk_info{device="/dev/sda",model="Sleeping HDD",state="sleeping"} 1
node_tiller_smart_disk_temperature_celsius{device="/dev/sda"} 33
node_tiller_smart_disk_health_passed{device="/dev/sda"} 1
node_tiller_smart_disk_sample_timestamp_seconds{device="/dev/sda"} %d
node_tiller_smart_disk_info{device="/dev/sdb",model="USB",state="unsupported"} 1
node_tiller_smart_disk_info{device="/dev/nvme0n1",model="SSD",state="online"} 1
node_tiller_smart_disk_health_passed{device="/dev/nvme0n1"} 0
node_tiller_smart_disk_life_remaining_percent{device="/dev/nvme0n1"} 0
`, now.Unix(), last)
	exporter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.RawQuery, "textfile") {
			t.Error("automatic SMART cache collector not requested")
		}
		fmt.Fprint(w, raw)
	}))
	defer exporter.Close()
	pve := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api2/json/nodes/lab/status" {
			t.Errorf("automatic refresh issued disk command: %s", r.URL)
		}
		fmt.Fprint(w, `{"data":{}}`)
	}))
	defer pve.Close()
	h := newHardwareService(&Config{InstancesFile: filepath.Join(t.TempDir(), "instances.json")}, InstanceConfig{ID: "one", Version: "v1", URL: pve.URL}, http.DefaultTransport, http.DefaultTransport.(*http.Transport))
	conn := hardwareConnection{Enabled: true, URL: exporter.URL, Managed: true, Version: 2}
	if _, e := h.connection("lab", &conn); e != nil {
		t.Fatal(e)
	}
	for _, method := range []string{"GET", "POST"} {
		path := "/api/hardware/lab"
		if method == "POST" {
			path += "/disks"
		}
		r := httptest.NewRequest(method, path, nil)
		r = r.WithContext(context.WithValue(r.Context(), adminContextKey{}, &adminSession{}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%d: %s", w.Code, w.Body.String())
		}
		var s hardwareSnapshot
		if e := json.Unmarshal(w.Body.Bytes(), &s); e != nil {
			t.Fatal(e)
		}
		if !s.SmartAuto || len(s.Disks) != 3 || s.DisksUpdatedAt.Unix() != now.Unix() {
			t.Fatalf("missing automatic SMART: %+v", s)
		}
		if s.Disks[0].Health != "FAILED" || *s.Disks[0].Life != 0 {
			t.Fatal("failing NVMe status lost")
		}
		if s.Disks[1].State != "sleeping" || s.Disks[1].UpdatedAt.Unix() != last || *s.Disks[1].Temperature != 33 {
			t.Fatal("sleeping disk lost its original sample time")
		}
		if s.Disks[2].Health != "UNKNOWN" || s.Disks[2].Temperature != nil {
			t.Fatal("unsupported disk was reported healthy or zero degrees")
		}
	}
}

func TestHardwareInstallationTerminalAndTFA(t *testing.T) {
	const challenge = "PVE:!tfa!challenge:time::signature"
	const script = "echo 'fixed installer'\n" // Never a browser-supplied command.
	upgrader := websocket.Upgrader{Subprotocols: []string{"binary"}}
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api2/json/access/ticket":
			r.ParseForm()
			if r.Form.Get("username") != "root@pam" {
				t.Error("wrong installation identity")
			}
			if r.Form.Get("tfa-challenge") != "" && (r.Form.Get("tfa-challenge") != challenge || r.Form.Get("password") != "totp:123456") {
				t.Error("incorrect TFA completion")
			}
			json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"ticket": challenge}})
		case "/api2/json/nodes/lab/termproxy":
			if r.Header.Get("CSRFPreventionToken") != "csrf" || !strings.HasPrefix(r.Header.Get("Cookie"), "PVEAuthCookie=") {
				t.Error("root ticket/CSRF missing")
			}
			fmt.Fprint(w, `{"data":{"user":"root@pam","ticket":"terminal","port":"5900"}}`)
		case "/api2/json/nodes/lab/vncwebsocket":
			if r.URL.Query().Get("port") != "5900" {
				t.Error("string port not decoded")
			}
			ws, e := upgrader.Upgrade(w, r, nil)
			if e != nil {
				t.Error(e)
				return
			}
			defer ws.Close()
			_, auth, e := ws.ReadMessage()
			if e != nil || string(auth) != "root@pam:terminal\n" {
				t.Error("incorrect terminal authentication")
				return
			}
			ws.WriteMessage(websocket.BinaryMessage, []byte("OK"))
			payload := ""
			for {
				_, command, e := ws.ReadMessage()
				if e != nil {
					t.Error(e)
					return
				}
				if len(command) > 1024 {
					t.Error("terminal input exceeds safe frame/line length")
				}
				payload += string(command)
				marker := regexp.MustCompile(`TILLER_(?:READY|PART|DONE)_[a-f0-9_]+`).FindString(string(command))
				if marker == "" {
					t.Error("shell acknowledgement missing")
					return
				}
				if strings.HasPrefix(marker, "TILLER_DONE_") {
					if !strings.Contains(payload, base64.StdEncoding.EncodeToString([]byte(script))) {
						t.Error("installer payload missing")
					}
					if !strings.Contains(payload, "HISTFILE=/dev/null") || !strings.Contains(payload, "--noprofile --norc +i") || !strings.Contains(payload, "stty -echo") {
						t.Error("payload would enter history or be echoed")
					}
					ws.WriteMessage(websocket.BinaryMessage, []byte("\nTILLER_STAGE:安装软件包\r\nTILLER_STA"))
					ws.WriteMessage(websocket.BinaryMessage, []byte("GE:写入配置\r\nTILLER_STAGE:采集服务已启动\r\n"))
					ws.WriteMessage(websocket.BinaryMessage, []byte("\n"+marker+":0\n"))
					return
				}
				ws.WriteMessage(websocket.BinaryMessage, []byte("\n"+marker+"\n"))
			}
		default:
			t.Errorf("unexpected root API %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	h := &hardwareService{instance: InstanceConfig{URL: upstream.URL}, transport: upstream.Client().Transport.(*http.Transport)}
	for _, body := range []string{`{"password":"one-time-password"}`, `{"challenge":"` + challenge + `","code":"123456"}`} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/install", strings.NewReader(body))
		h.install(w, r, "lab", &hardwareNodeCache{})
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"requiresTFA":true`) {
			t.Fatalf("TFA flow: %d %s", w.Code, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "one-time-password") {
			t.Fatal("password leaked")
		}
	}
	var progress []string
	ctx := context.WithValue(context.Background(), hardwareProgressKey{}, func(message string) { progress = append(progress, message) })
	if e := h.runInstaller(ctx, "lab", "PVE:root@pam:time::signature", "csrf", script); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(strings.Join(progress, "\n"), "节点采集服务已启动") {
		t.Fatalf("terminal milestones did not reach progress stream: %v", progress)
	}
}
