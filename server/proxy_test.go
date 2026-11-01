package main

import (
	"bufio"
	"crypto/sha256"
	"crypto/x509"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func quietLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return u
}

// newFront starts the full pve-web handler in front of backend.
func newFront(t *testing.T, cfg *Config) *httptest.Server {
	t.Helper()
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>t</title>")}}
	front := httptest.NewServer(NewHandler(cfg, web, true, NewUpstreamTransport(cfg), quietLogger()))
	t.Cleanup(front.Close)
	return front
}

func fingerprintOf(cert *x509.Certificate) []byte {
	sum := sha256.Sum256(cert.Raw)
	return sum[:]
}

type seenRequest struct {
	Method, Path, RawQuery, Host, Origin, Referer, Cookie, CSRF, Body, ContentType string
	ForwardedFor                                                                   string
}

func recordingBackend(t *testing.T, seen chan<- seenRequest) *httptest.Server {
	t.Helper()
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		seen <- seenRequest{
			Method: r.Method, Path: r.URL.Path, RawQuery: r.URL.RawQuery, Host: r.Host,
			Origin: r.Header.Get("Origin"), Referer: r.Header.Get("Referer"),
			Cookie: r.Header.Get("Cookie"), CSRF: r.Header.Get("CSRFPreventionToken"),
			Body: string(body), ContentType: r.Header.Get("Content-Type"),
			ForwardedFor: r.Header.Get("X-Forwarded-For"),
		}
		if r.URL.Path == "/api2/json/fail" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"data":null,"message":"Parameter verification failed.","errors":{"vmid":"bad"}}`)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN") // must not be duplicated
		_, _ = io.WriteString(w, `{"data":{"ok":1}}`)
	}))
	t.Cleanup(backend.Close)
	return backend
}

func TestProxyForwardsRequestsAndRewritesHeaders(t *testing.T) {
	seen := make(chan seenRequest, 1)
	backend := recordingBackend(t, seen)
	cfg := &Config{PVE: mustURL(t, backend.URL), Fingerprint: fingerprintOf(backend.Certificate())}
	front := newFront(t, cfg)

	form := "vmid=100&start=1"
	req, _ := http.NewRequest(http.MethodPost, front.URL+"/api2/json/nodes/pve/qemu?x=1&y=%2F", strings.NewReader(form))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", front.URL)
	req.Header.Set("Referer", front.URL+"/guest/pve/qemu/100?tab=1")
	req.Header.Set("Cookie", "PVEAuthCookie=PVE%3Aroot%40pam%3A1234")
	req.Header.Set("CSRFPreventionToken", "csrf-token")
	req.Header.Set("X-Forwarded-For", "6.6.6.6") // client supplied: must be dropped

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(body) != `{"data":{"ok":1}}` {
		t.Fatalf("got %d %q", resp.StatusCode, body)
	}
	if got := resp.Header.Values("X-Frame-Options"); len(got) != 1 || got[0] != "DENY" {
		t.Errorf("X-Frame-Options = %v, want single DENY", got)
	}

	s := <-seen
	backendURL := mustURL(t, backend.URL)
	checks := map[string][2]string{
		"method":       {s.Method, "POST"},
		"path":         {s.Path, "/api2/json/nodes/pve/qemu"},
		"query":        {s.RawQuery, "x=1&y=%2F"},
		"host":         {s.Host, backendURL.Host},
		"origin":       {s.Origin, backend.URL},
		"referer":      {s.Referer, backend.URL + "/guest/pve/qemu/100?tab=1"},
		"cookie":       {s.Cookie, "PVEAuthCookie=PVE%3Aroot%40pam%3A1234"},
		"csrf":         {s.CSRF, "csrf-token"},
		"body":         {s.Body, form},
		"content-type": {s.ContentType, "application/x-www-form-urlencoded"},
	}
	for name, c := range checks {
		if c[0] != c[1] {
			t.Errorf("%s = %q, want %q", name, c[0], c[1])
		}
	}
	if s.ForwardedFor != "127.0.0.1" {
		t.Errorf("X-Forwarded-For = %q, want the client address only (not the forged 6.6.6.6)", s.ForwardedFor)
	}
	if csp := resp.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "sandbox") || !strings.Contains(csp, "default-src 'none'") {
		t.Errorf("proxied response CSP = %q", csp)
	}
}

func TestProxyForwardsOnlyTheJSONAPI(t *testing.T) {
	seen := make(chan seenRequest, 4)
	backend := recordingBackend(t, seen)
	cfg := &Config{PVE: mustURL(t, backend.URL), InsecureTLS: true}
	front := newFront(t, cfg)
	for _, path := range []string{"/api2/html/access/ticket", "/api2/extjs/version", "/api2/png/x", "/api2/spiceconfig/x"} {
		resp, err := http.Get(front.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s: status %d, want 404", path, resp.StatusCode)
		}
	}
	select {
	case s := <-seen:
		t.Fatalf("non-JSON formatter reached PVE: %+v", s)
	default:
	}
}

func TestProxyErrorHidesUpstreamDetails(t *testing.T) {
	// A closed port: the dial error names the address.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	l.Close()
	cfg := &Config{PVE: mustURL(t, "https://"+addr), InsecureTLS: true}
	front := newFront(t, cfg)
	resp, err := http.Get(front.URL + "/api2/json/version")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status %d", resp.StatusCode)
	}
	_, port, _ := net.SplitHostPort(addr)
	if strings.Contains(string(body), addr) || strings.Contains(string(body), port) || strings.Contains(string(body), "dial") {
		t.Fatalf("error body leaks upstream details: %s", body)
	}
}

func TestProxyPassesErrorResponsesThrough(t *testing.T) {
	seen := make(chan seenRequest, 1)
	backend := recordingBackend(t, seen)
	cfg := &Config{PVE: mustURL(t, backend.URL), InsecureTLS: true}
	front := newFront(t, cfg)

	resp, err := http.Get(front.URL + "/api2/json/fail")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	<-seen
	var body struct {
		Message string            `json:"message"`
		Errors  map[string]string `json:"errors"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	if resp.StatusCode != 400 || body.Message != "Parameter verification failed." || body.Errors["vmid"] != "bad" {
		t.Fatalf("got %d %+v", resp.StatusCode, body)
	}
}

func TestFingerprintPinning(t *testing.T) {
	seen := make(chan seenRequest, 10)
	backend := recordingBackend(t, seen)
	good := fingerprintOf(backend.Certificate())
	bad := make([]byte, 32)

	pool := x509.NewCertPool()
	pool.AddCert(backend.Certificate())

	cases := []struct {
		name       string
		cfg        Config
		wantStatus int
		wantMsg    string
	}{
		{"matching fingerprint", Config{Fingerprint: good}, 200, ""},
		{"wrong fingerprint", Config{Fingerprint: bad}, 502, "证书指纹不匹配，请联系管理员"},
		{"default verification rejects self-signed", Config{}, 502, "无法连接 PVE"},
		{"insecure", Config{InsecureTLS: true}, 200, ""},
		{"custom CA", Config{RootCAs: pool}, 200, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := tc.cfg
			cfg.PVE = mustURL(t, backend.URL)
			front := newFront(t, &cfg)
			resp, err := http.Get(front.URL + "/api2/json/version")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != tc.wantStatus {
				t.Fatalf("status %d, want %d (%s)", resp.StatusCode, tc.wantStatus, body)
			}
			if tc.wantMsg != "" {
				var e struct {
					Message string `json:"message"`
				}
				if err := json.Unmarshal(body, &e); err != nil || !strings.Contains(e.Message, tc.wantMsg) {
					t.Fatalf("message %q does not contain %q", body, tc.wantMsg)
				}
				if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
					t.Errorf("error content-type %q", ct)
				}
				if strings.Contains(string(body), FormatFingerprint(good)) {
					t.Errorf("error body reveals the presented fingerprint: %s", body)
				}
			}
		})
	}
}

func TestWebsocketPassthrough(t *testing.T) {
	type upgradeSeen struct{ path, query, origin, cookie, host string }
	seen := make(chan upgradeSeen, 1)
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") ||
			!strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") {
			http.Error(w, "expected upgrade", http.StatusBadRequest)
			return
		}
		seen <- upgradeSeen{r.URL.Path, r.URL.RawQuery, r.Header.Get("Origin"), r.Header.Get("Cookie"), r.Host}
		conn, rw, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_, _ = rw.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = rw.Flush()
		// Echo everything back, like a VNC/terminal stream would carry data.
		buf := make([]byte, 64)
		for {
			n, err := rw.Read(buf)
			if n > 0 {
				_, _ = conn.Write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}))
	t.Cleanup(backend.Close)

	cfg := &Config{PVE: mustURL(t, backend.URL), Fingerprint: fingerprintOf(backend.Certificate())}
	front := newFront(t, cfg)
	frontURL := mustURL(t, front.URL)

	conn, err := net.Dial("tcp", frontURL.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	path := "/api2/json/nodes/pve/qemu/100/vncwebsocket?port=5900&vncticket=PVEVNC%3Aabc"
	req := "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + frontURL.Host + "\r\n" +
		"Connection: Upgrade\r\nUpgrade: websocket\r\n" +
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Origin: " + front.URL + "\r\n" +
		"Cookie: PVEAuthCookie=ticket\r\n\r\n"
	if _, err := io.WriteString(conn, req); err != nil {
		t.Fatal(err)
	}
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("status %d, want 101", resp.StatusCode)
	}

	s := <-seen
	if s.path != "/api2/json/nodes/pve/qemu/100/vncwebsocket" || s.query != "port=5900&vncticket=PVEVNC%3Aabc" {
		t.Errorf("upstream got %s?%s", s.path, s.query)
	}
	if s.origin != backend.URL || s.cookie != "PVEAuthCookie=ticket" || s.host != mustURL(t, backend.URL).Host {
		t.Errorf("upstream headers origin=%q cookie=%q host=%q", s.origin, s.cookie, s.host)
	}

	// Bidirectional traffic over the upgraded connection, several round trips.
	for _, msg := range []string{"hello", "RFB 003.008\n", strings.Repeat("x", 40)} {
		if _, err := io.WriteString(conn, msg); err != nil {
			t.Fatal(err)
		}
		got := make([]byte, len(msg))
		if _, err := io.ReadFull(br, got); err != nil {
			t.Fatal(err)
		}
		if string(got) != msg {
			t.Fatalf("echo %q, want %q", got, msg)
		}
	}
}

func TestProxyOnlyHandlesAPI2(t *testing.T) {
	seen := make(chan seenRequest, 1)
	backend := recordingBackend(t, seen)
	cfg := &Config{PVE: mustURL(t, backend.URL), InsecureTLS: true}
	front := newFront(t, cfg)

	resp, err := http.Get(front.URL + "/api2json/x")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	select {
	case s := <-seen:
		t.Fatalf("request outside /api2/ reached PVE: %+v", s)
	default:
	}
}

func TestHealthz(t *testing.T) {
	cfg := &Config{PVE: mustURL(t, "https://127.0.0.1:1")}
	front := newFront(t, cfg)
	resp, err := http.Get(front.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(body) != "ok\n" {
		t.Fatalf("got %d %q", resp.StatusCode, body)
	}
}

func TestFormatFingerprint(t *testing.T) {
	b := []byte{0x4f, 0x04, 0xc3}
	if got := FormatFingerprint(b); got != "4F:04:C3" {
		t.Fatalf("got %q", got)
	}
}
