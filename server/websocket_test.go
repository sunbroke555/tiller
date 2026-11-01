package main

import (
	"bufio"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

// Console websockets (noVNC, xterm.js) go through the proxy as plain HTTP/1.1
// upgrades: GET …/vncwebsocket?port=…&vncticket=… with the PVEAuthCookie and
// Sec-WebSocket-Protocol: binary. These tests cover what the browser relies
// on beyond the basic passthrough in proxy_test.go.

type wsBackendSeen struct {
	protocol string
	closed   chan struct{}
}

// wsEchoBackend answers every upgrade with 101 (echoing the subprotocol, as
// PVE does) and echoes bytes until the client side goes away.
func wsEchoBackend(t *testing.T) (*httptest.Server, chan wsBackendSeen) {
	t.Helper()
	seen := make(chan wsBackendSeen, 1)
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
			http.Error(w, "expected upgrade", http.StatusBadRequest)
			return
		}
		proto := r.Header.Get("Sec-WebSocket-Protocol")
		closed := make(chan struct{})
		seen <- wsBackendSeen{protocol: proto, closed: closed}
		conn, rw, err := http.NewResponseController(w).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		defer close(closed)
		hdr := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
		if proto != "" {
			hdr += "Sec-WebSocket-Protocol: " + proto + "\r\n"
		}
		_, _ = rw.WriteString(hdr + "\r\n")
		_ = rw.Flush()
		buf := make([]byte, 256)
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
	return backend, seen
}

func upgradeRequest(host, path string) string {
	return "GET " + path + " HTTP/1.1\r\n" +
		"Host: " + host + "\r\n" +
		"Connection: Upgrade\r\nUpgrade: websocket\r\n" +
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Protocol: binary\r\n" +
		"Cookie: PVEAuthCookie=PVE%3Aroot%40pam%3A1234\r\n\r\n"
}

// echoRoundTrip upgrades conn and checks one echo round trip.
func echoRoundTrip(t *testing.T, conn net.Conn, host string) *bufio.Reader {
	t.Helper()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	path := "/api2/json/nodes/pve/vncwebsocket?port=5900&vncticket=PVEVNC%3Aabc"
	if _, err := io.WriteString(conn, upgradeRequest(host, path)); err != nil {
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
	if got := resp.Header.Get("Sec-WebSocket-Protocol"); got != "binary" {
		t.Errorf("Sec-WebSocket-Protocol in 101 = %q, want binary (browsers drop the socket otherwise)", got)
	}
	msg := "0:3:ls\r"
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
	return br
}

func TestWebsocketSubprotocolAndCloseReachPVE(t *testing.T) {
	backend, seen := wsEchoBackend(t)
	cfg := &Config{PVE: mustURL(t, backend.URL), Fingerprint: fingerprintOf(backend.Certificate())}
	front := newFront(t, cfg)
	host := mustURL(t, front.URL).Host

	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	echoRoundTrip(t, conn, host)
	s := <-seen
	if s.protocol != "binary" {
		t.Errorf("upstream Sec-WebSocket-Protocol = %q, want binary", s.protocol)
	}

	// Closing the console in the browser must close the PVE side too, so
	// termproxy / vncproxy processes on the node end.
	_ = conn.Close()
	select {
	case <-s.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream websocket still open after the client closed")
	}
}

func TestWebsocketUpgradeOverTLSFrontWithHTTP2(t *testing.T) {
	backend, seen := wsEchoBackend(t)
	cfg := &Config{PVE: mustURL(t, backend.URL), Fingerprint: fingerprintOf(backend.Certificate())}
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>t</title>")}}
	front := httptest.NewUnstartedServer(NewHandler(cfg, web, true, NewUpstreamTransport(cfg), quietLogger()))
	front.EnableHTTP2 = true // like TLS_CERT_FILE: the page itself may use h2
	front.StartTLS()
	t.Cleanup(front.Close)
	host := mustURL(t, front.URL).Host

	// Browsers open websockets on their own HTTP/1.1 connection unless the
	// server offers RFC 8441 (Go does not by default).
	conn, err := tls.Dial("tcp", host, &tls.Config{InsecureSkipVerify: true, NextProtos: []string{"http/1.1"}})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if p := conn.ConnectionState().NegotiatedProtocol; p != "" && p != "http/1.1" {
		t.Fatalf("negotiated %q, want http/1.1", p)
	}
	echoRoundTrip(t, conn, host)
	if s := <-seen; s.protocol != "binary" {
		t.Errorf("upstream Sec-WebSocket-Protocol = %q, want binary", s.protocol)
	}

	// The same listener still serves the API over h2 to clients that ask.
	client := front.Client()
	resp, err := client.Get(front.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.ProtoMajor != 2 {
		t.Errorf("healthz over %s, want HTTP/2", resp.Proto)
	}
}
