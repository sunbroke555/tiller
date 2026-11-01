package main

import (
	"bytes"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func envMap(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadConfigDefaults(t *testing.T) {
	cfg, err := LoadConfig(envMap(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Listen != ":8080" || cfg.PVE.String() != defaultPVEURL || cfg.InsecureTLS || cfg.Fingerprint != nil {
		t.Fatalf("unexpected defaults %+v", cfg)
	}
}

func TestLoadConfig(t *testing.T) {
	fp := "4F:04:C3:DA:F6:54:08:1A:C4:62:29:60:FA:91:DF:1F:AE:1F:C7:7E:77:42:25:32:53:99:37:17:13:F4:6E:17"
	cfg, err := LoadConfig(envMap(map[string]string{
		"PVE_URL":             "https://192.168.0.6:8006/",
		"LISTEN":              "127.0.0.1:9000",
		"PVE_TLS_FINGERPRINT": fp,
		"WEB_DIR":             "/srv/web",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PVE.String() != "https://192.168.0.6:8006" || cfg.Listen != "127.0.0.1:9000" || cfg.WebDir != "/srv/web" {
		t.Fatalf("got %+v", cfg)
	}
	if FormatFingerprint(cfg.Fingerprint) != fp {
		t.Fatalf("fingerprint round trip: %s", FormatFingerprint(cfg.Fingerprint))
	}
}

func TestLoadConfigErrors(t *testing.T) {
	cases := map[string]map[string]string{
		"bad scheme":        {"PVE_URL": "ftp://pve"},
		"with path":         {"PVE_URL": "https://pve:8006/api2/json"},
		"no host":           {"PVE_URL": "https://"},
		"short fingerprint": {"PVE_TLS_FINGERPRINT": "AA:BB"},
		"not hex":           {"PVE_TLS_FINGERPRINT": strings.Repeat("zz", 32)},
		"both tls modes":    {"PVE_TLS_FINGERPRINT": strings.Repeat("ab", 32), "PVE_INSECURE_TLS": "1"},
		"cert without key":  {"TLS_CERT_FILE": "/x.pem"},
		"missing CA file":   {"PVE_CA_FILE": "/nonexistent/ca.pem"},
		"plain http to LAN": {"PVE_URL": "http://192.168.0.6:8006"},
		"bad allow list":    {"ALLOW_FROM": "10.0.0.0/8,nope"},
		"bad proxy list":    {"TRUSTED_PROXIES": "300.1.1.1"},
	}
	for name, env := range cases {
		if _, err := LoadConfig(envMap(env)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestParseFingerprintFormats(t *testing.T) {
	want := bytes.Repeat([]byte{0xab}, 32)
	for _, in := range []string{
		strings.Repeat("ab", 32),
		strings.Repeat("AB:", 31) + "AB",
		"sha256:" + strings.Repeat("Ab", 32),
		" " + strings.Repeat("ab ", 32),
	} {
		got, err := ParseFingerprint(in)
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("ParseFingerprint(%q) = %x, %v", in, got, err)
		}
	}
}

func TestInsecureTLSValues(t *testing.T) {
	for v, want := range map[string]bool{"1": true, "true": true, "YES": true, "0": false, "": false, "no": false} {
		cfg, err := LoadConfig(envMap(map[string]string{"PVE_INSECURE_TLS": v}))
		if err != nil {
			t.Fatalf("PVE_INSECURE_TLS=%q: %v", v, err)
		}
		if cfg.InsecureTLS != want {
			t.Errorf("PVE_INSECURE_TLS=%q: got %v", v, cfg.InsecureTLS)
		}
	}
}

func TestCAFileWithoutCertificates(t *testing.T) {
	p := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(p, []byte("not a cert"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadConfig(envMap(map[string]string{"PVE_CA_FILE": p})); err == nil {
		t.Fatal("expected error for CA file without certificates")
	}
}

func TestPlainHTTPUpstreamOnlyLoopbackOrOptIn(t *testing.T) {
	for _, env := range []map[string]string{
		{"PVE_URL": "http://127.0.0.1:8006"},
		{"PVE_URL": "http://localhost:8006"},
		{"PVE_URL": "http://192.168.0.6:8006", "PVE_ALLOW_HTTP": "1"},
	} {
		if _, err := LoadConfig(envMap(env)); err != nil {
			t.Errorf("%v: %v", env, err)
		}
	}
}

func TestAccessLists(t *testing.T) {
	cfg, err := LoadConfig(envMap(map[string]string{"ALLOW_FROM": "10.0.0.0/8, 192.168.1.5", "TRUSTED_PROXIES": "::1"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.AllowFrom) != 2 || !cfg.AllowFrom[1].Contains(net.ParseIP("192.168.1.5")) || cfg.AllowFrom[1].Contains(net.ParseIP("192.168.1.6")) {
		t.Fatalf("allow list %v", cfg.AllowFrom)
	}
	if len(cfg.TrustedProxies) != 1 || !cfg.TrustedProxies[0].Contains(net.ParseIP("::1")) {
		t.Fatalf("trusted proxies %v", cfg.TrustedProxies)
	}
}

func TestPlainHTTPExposed(t *testing.T) {
	cases := map[string]bool{":8080": true, "0.0.0.0:8080": true, "192.168.0.32:8121": true, "127.0.0.1:8080": false, "[::1]:8080": false, "localhost:8080": false}
	for listen, want := range cases {
		if got := (&Config{Listen: listen}).PlainHTTPExposed(); got != want {
			t.Errorf("%s: got %v, want %v", listen, got, want)
		}
	}
	if (&Config{Listen: ":8443", TLSCert: "c.pem"}).PlainHTTPExposed() {
		t.Error("TLS listener reported as plain HTTP")
	}
}
