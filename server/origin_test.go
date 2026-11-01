package main

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCrossOriginReason(t *testing.T) {
	_, proxyNet, _ := net.ParseCIDR("10.0.0.0/8")
	trusted := []*net.IPNet{proxyNet}
	cases := []struct {
		name   string
		method string
		host   string
		remote string
		hdr    map[string]string
		reject bool
	}{
		{"same origin POST", "POST", "pve-web.lan:8080", "192.168.1.5:1", map[string]string{"Origin": "http://pve-web.lan:8080"}, false},
		{"default port omitted", "PUT", "pve-web.lan", "192.168.1.5:1", map[string]string{"Origin": "https://PVE-WEB.lan:443"}, false},
		{"no Origin (API client)", "DELETE", "pve-web.lan", "192.168.1.5:1", nil, false},
		{"GET from another origin", "GET", "pve-web.lan", "192.168.1.5:1", map[string]string{"Origin": "https://evil.lan"}, false},
		{"other port, same host", "POST", "pve-web.lan:8080", "192.168.1.5:1", map[string]string{"Origin": "http://pve-web.lan:9000"}, true},
		{"sibling subdomain", "POST", "pve.example.com", "192.168.1.5:1", map[string]string{"Origin": "https://blog.example.com"}, true},
		{"opaque origin", "POST", "pve-web.lan", "192.168.1.5:1", map[string]string{"Origin": "null"}, true},
		{"cross-site fetch metadata", "POST", "pve-web.lan", "192.168.1.5:1", map[string]string{"Sec-Fetch-Site": "cross-site"}, true},
		{"websocket from another port", "GET", "pve-web.lan:8080", "192.168.1.5:1",
			map[string]string{"Upgrade": "websocket", "Origin": "http://pve-web.lan:8081"}, true},
		{"websocket same origin", "GET", "pve-web.lan:8080", "192.168.1.5:1",
			map[string]string{"Upgrade": "websocket", "Origin": "http://pve-web.lan:8080"}, false},
		{"trusted proxy forwards the public host", "POST", "127.0.0.1:8080", "10.1.2.3:1",
			map[string]string{"Origin": "https://pve.example.com", "X-Forwarded-Host": "pve.example.com"}, false},
		{"untrusted client cannot claim a host", "POST", "127.0.0.1:8080", "192.168.1.5:1",
			map[string]string{"Origin": "https://evil.lan", "X-Forwarded-Host": "evil.lan"}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(c.method, "http://"+c.host+"/api2/json/nodes", nil)
			r.Host = c.host
			r.RemoteAddr = c.remote
			for k, v := range c.hdr {
				r.Header.Set(k, v)
			}
			got := crossOriginReason(r, trusted)
			if (got != "") != c.reject {
				t.Errorf("crossOriginReason = %q, want reject=%v", got, c.reject)
			}
		})
	}
}

func TestCrossOriginRequestsNeverReachPVE(t *testing.T) {
	seen := make(chan seenRequest, 4)
	backend := recordingBackend(t, seen)
	cfg := &Config{PVE: mustURL(t, backend.URL), Fingerprint: fingerprintOf(backend.Certificate())}
	front := newFront(t, cfg)
	host := mustURL(t, front.URL).Host
	foreign := "http://" + strings.Split(host, ":")[0] + ":1" // same host, another port

	do := func(method, path, origin string) *http.Response {
		t.Helper()
		req, _ := http.NewRequest(method, front.URL+path, strings.NewReader("x=1"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("Cookie", "PVEAuthCookie=ticket")
		req.Header.Set("CSRFPreventionToken", "csrf")
		req.Header.Set(ticketModeHeader, ticketModeCookie)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		return resp
	}

	if resp := do(http.MethodPost, "/api2/json/nodes/pve/qemu/100/status/start", foreign); resp.StatusCode != http.StatusForbidden {
		t.Errorf("cross-origin POST: status %d, want 403", resp.StatusCode)
	}
	if resp := do(http.MethodPost, "/api/logout", foreign); resp.StatusCode != http.StatusForbidden {
		t.Errorf("cross-origin logout: status %d, want 403", resp.StatusCode)
	}
	select {
	case s := <-seen:
		t.Fatalf("PVE received a cross-origin request: %s %s", s.Method, s.Path)
	default:
	}
	if resp := do(http.MethodPost, "/api2/json/nodes/pve/qemu/100/status/start", front.URL); resp.StatusCode != http.StatusOK {
		t.Errorf("same-origin POST: status %d, want 200", resp.StatusCode)
	}
	<-seen

	// Websocket upgrade from another origin: refused before the upgrade.
	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	req := strings.Replace(upgradeRequest(host, "/api2/json/nodes/pve/vncwebsocket?port=5900&vncticket=x"),
		"\r\n\r\n", "\r\nOrigin: "+foreign+"\r\n\r\n", 1)
	if _, err := io.WriteString(conn, req); err != nil {
		t.Fatal(err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("cross-origin websocket: status %d, want 403", resp.StatusCode)
	}
	select {
	case s := <-seen:
		t.Fatalf("PVE received a cross-origin upgrade: %s", s.Path)
	default:
	}
}
