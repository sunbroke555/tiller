package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Execute the actual node scripts in an isolated filesystem with package and
// systemd commands simulated. No host service or package manager is invoked.
func TestHardwareControlScripts(t *testing.T) {
	for _, tc := range []struct {
		name, operation, owner, packages, plan, missing string
		ok, unknown                                     bool
	}{
		{name: "stop", operation: "stop", owner: "one:lab", ok: true},
		{name: "stop-legacy-without-smart", operation: "stop", owner: "one:lab", missing: "tiller-smart-collector", ok: true},
		{name: "stop-legacy-without-power", operation: "stop", owner: "one:lab", missing: "tiller-power-collector", ok: true},
		{name: "resume", operation: "resume", owner: "one:lab", ok: true},
		{name: "uninstall-owned", operation: "uninstall", owner: "one:lab", packages: "prometheus-node-exporter\n", plan: "Purg prometheus-node-exporter [1.9]\n", ok: true},
		{name: "dependency-conflict", operation: "uninstall", owner: "one:lab", packages: "smartmontools\n", plan: "Remv pve-manager [9.2]\nPurg smartmontools [7.5]\n"},
		{name: "wrong-owner", operation: "stop", owner: "another:lab"},
		{name: "legacy-uninstall", operation: "uninstall", owner: "one:lab", ok: true, unknown: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			config := filepath.Join(dir, "config")
			units := filepath.Join(dir, "units")
			bin := filepath.Join(dir, "bin")
			for _, p := range []string{config, units, bin, filepath.Join(dir, "run")} {
				if err := os.MkdirAll(p, 0700); err != nil {
					t.Fatal(err)
				}
			}
			os.WriteFile(filepath.Join(config, "owner"), []byte(tc.owner), 0600)
			if !tc.unknown {
				os.WriteFile(filepath.Join(config, "packages"), []byte(tc.packages), 0600)
			}
			for _, unit := range []string{"tiller-node-exporter.service", "tiller-smart-collector.timer", "tiller-smart-collector.service", "tiller-power-collector.service"} {
				os.WriteFile(filepath.Join(units, unit), []byte("fixture"), 0600)
			}
			state := map[string]any{"active": true, "enabled": true, "purged": []string{}, "calls": []string{}}
			raw, _ := json.Marshal(state)
			stateFile := filepath.Join(dir, "state.json")
			os.WriteFile(stateFile, raw, 0600)
			runner := filepath.Join(bin, "runner")
			os.WriteFile(runner, []byte(hardwareControlCommandStub), 0700)
			for _, name := range []string{"id", "systemctl", "dpkg-query", "apt-get", "dpkg"} {
				if err := os.Symlink(runner, filepath.Join(bin, name)); err != nil {
					t.Fatal(err)
				}
			}
			h := &hardwareService{instance: InstanceConfig{ID: "one"}}
			script := h.hardwareControlScript("lab", tc.operation, true)
			script = strings.NewReplacer("/etc/tiller-node-exporter", config, "/etc/systemd/system", units, "/run/tiller-node-exporter", filepath.Join(dir, "run"), "/tmp/tiller-uninstall", filepath.Join(dir, "uninstall")).Replace(script)
			cmd := exec.Command("bash", "-s")
			cmd.Stdin = strings.NewReader(script)
			cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "CONTROL_STATE="+stateFile, "CONTROL_PLAN="+tc.plan, "CONTROL_ABSENT_UNIT="+tc.missing)
			out, err := cmd.CombinedOutput()
			if (err == nil) != tc.ok {
				t.Fatalf("success=%v: %v\n%s", tc.ok, err, out)
			}
			raw, _ = os.ReadFile(stateFile)
			var result struct {
				Active, Enabled bool
				Purged, Calls   []string
			}
			if err := json.Unmarshal(raw, &result); err != nil {
				t.Fatal(err)
			}
			for _, call := range result.Calls {
				if strings.Contains(call, "smartmontools.service") || strings.Contains(call, "smartd.service") {
					t.Fatal("modified system SMART daemon")
				}
			}
			if !tc.ok {
				if !result.Active || !result.Enabled || len(result.Purged) != 0 {
					t.Fatalf("failed preflight changed the node: %s", raw)
				}
				if _, err := os.Stat(filepath.Join(config, "owner")); err != nil {
					t.Fatal("failed preflight removed config")
				}
			} else if tc.operation == "resume" {
				if !result.Active || !result.Enabled {
					t.Fatal("services not restored")
				}
			} else {
				if result.Active || result.Enabled {
					t.Fatal("collector or boot activation left running")
				}
				if tc.operation == "uninstall" {
					if _, err := os.Stat(config); !os.IsNotExist(err) {
						t.Fatal("collector config not removed")
					}
					if tc.unknown && len(result.Purged) != 0 {
						t.Fatal("removed untracked packages")
					}
					if !tc.unknown && (len(result.Purged) != 1 || result.Purged[0] != "prometheus-node-exporter") {
						t.Fatalf("incorrect package removal: %s", raw)
					}
				}
			}
		})
	}
}

const hardwareControlCommandStub = `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
name=Path(sys.argv[0]).name
args=sys.argv[1:]
p=Path(os.environ['CONTROL_STATE'])
s=json.loads(p.read_text())
s['calls'].append(name+' '+' '.join(args))
rc=0
if name=='id': print('0')
elif name=='dpkg-query':
 if args[-1]==os.environ.get('CONTROL_MISSING') and not Path(os.environ.get('CONTROL_INSTALLED','/nonexistent')).exists(): rc=1
 else: print('install ok installed')
elif name=='apt-get':
 assert args[:2]==['-s','purge']
 print(os.environ['CONTROL_PLAN'])
elif name=='dpkg':
 assert args[0]=='--purge'
 s['purged']+=args[1:]
elif name=='systemctl':
 action=args[0]
 absent=os.environ.get('CONTROL_ABSENT_UNIT','')
 missing=bool(absent and args[-1].startswith(absent))
 if action=='show': print('not-found' if missing else 'loaded')
 elif missing: raise AssertionError('attempted to control missing unit: '+str(args))
 elif action in ('disable','stop'): s['active']=False; s['enabled']=False
 elif action in ('enable','start'): s['active']=True; s['enabled']=True
 elif action=='is-active':
  if '--quiet' not in args: print('active' if s['active'] else 'inactive')
  rc=0 if s['active'] else 3
 elif action=='is-enabled':
  print('enabled' if s['enabled'] else 'disabled'); rc=0 if s['enabled'] else 1
 elif action!='daemon-reload': raise AssertionError(args)
p.write_text(json.dumps(s))
sys.exit(rc)
`

func TestHardwarePackageInventoryTracksOnlyNewPackages(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "new", true: "legacy"}[legacy], func(t *testing.T) {
			dir := t.TempDir()
			config := filepath.Join(dir, "config")
			bin := filepath.Join(dir, "bin")
			os.MkdirAll(bin, 0700)
			if legacy {
				os.MkdirAll(config, 0700)
				os.WriteFile(filepath.Join(config, "owner"), []byte("one:lab"), 0600)
			}
			state := filepath.Join(dir, "state.json")
			os.WriteFile(state, []byte(`{"active":true,"enabled":true,"calls":[],"purged":[]}`), 0600)
			runner := filepath.Join(bin, "dpkg-query")
			os.WriteFile(runner, []byte(hardwareControlCommandStub), 0700)
			installed := filepath.Join(dir, "installed")
			start := strings.Index(hardwareInstallScript, "umask 077")
			end := strings.Index(hardwareInstallScript, "printf 'TILLER_STAGE:安装软件包")
			script := strings.NewReplacer("/etc/tiller-node-exporter", config, "@OWNER@", "one:lab").Replace(hardwareInstallScript[start:end])
			cmd := exec.Command("bash", "-s")
			cmd.Stdin = strings.NewReader("set -eu\n" + script + "\ntouch \"$CONTROL_INSTALLED\"\n")
			cmd.Env = append(os.Environ(), "PATH="+bin+":"+os.Getenv("PATH"), "CONTROL_STATE="+state, "CONTROL_MISSING=prometheus-node-exporter", "CONTROL_INSTALLED="+installed)
			out, runErr := cmd.CombinedOutput()
			if runErr != nil {
				t.Fatalf("%v: %s", runErr, out)
			}
			packages, err := os.ReadFile(filepath.Join(config, "packages"))
			if err != nil || string(packages) != "prometheus-node-exporter\n" {
				calls, _ := os.ReadFile(state)
				t.Fatalf("incorrect package ownership: %s %v; calls=%s\n%s", packages, err, calls, out)
			}
			_, unknown := os.Stat(filepath.Join(config, "packages.unknown"))
			if (unknown == nil) != legacy {
				t.Fatal("legacy inventory was incorrectly marked complete")
			}
		})
	}
}

func TestHardwareStopRequiresAuthorizationAndPreservesStateOnFailure(t *testing.T) {
	pve := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api2/json/access/ticket" {
			w.Write([]byte(`{"data":{"ticket":"PVE:root@pam:time::sig","CSRFPreventionToken":"csrf"}}`))
			return
		}
		w.WriteHeader(403)
	}))
	defer pve.Close()
	h := newHardwareService(&Config{InstancesFile: filepath.Join(t.TempDir(), "instances.json")}, InstanceConfig{ID: "one", Version: "v1", URL: pve.URL}, pve.Client().Transport, pve.Client().Transport.(*http.Transport))
	conn := hardwareConnection{Enabled: true, Managed: true, URL: "https://127.0.0.1:19100/metrics", Version: 2}
	h.connection("lab", &conn)
	for _, tc := range []struct {
		body   string
		status int
	}{{"", 409}, {`{"password":"fixture"}`, 502}} {
		r := httptest.NewRequest("DELETE", "/api/hardware/lab", strings.NewReader(tc.body))
		w := httptest.NewRecorder()
		h.controlHardware(w, r, "lab", h.cache("lab"), conn, "stop")
		if w.Code != tc.status {
			t.Fatalf("%d: %s", w.Code, w.Body.String())
		}
		saved, err := h.connection("lab", nil)
		if err != nil || !saved.Enabled || saved.Paused {
			t.Fatal("failed stop was recorded as successful")
		}
	}
}
