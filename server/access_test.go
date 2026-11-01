package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

const realTicket = "PVE:root@pam:6612AB34::c2lnbmF0dXJl+/="

// fakeTicketPVE answers POST /access/ticket like PVE: password "secret" or a
// valid ticket logs root@pam in, "tfa" returns an interim two-factor ticket.
func fakeTicketPVE(t *testing.T, passwords chan<- string) *httptest.Server {
	t.Helper()
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		pw := r.PostForm.Get("password")
		if passwords != nil {
			passwords <- pw
		}
		w.Header().Set("Content-Type", "application/json;charset=UTF-8")
		switch pw {
		case "secret", realTicket:
			_, _ = io.WriteString(w, `{"data":{"username":"root@pam","ticket":"`+realTicket+`","CSRFPreventionToken":"csrf"}}`)
		case "tfa":
			_, _ = io.WriteString(w, `{"data":{"username":"root@pam","ticket":"PVE:!tfa!%7B%7D:6612AB34::sig","CSRFPreventionToken":"csrf"}}`)
		default:
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"data":null}`)
		}
	}))
	t.Cleanup(backend.Close)
	return backend
}

type logBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *logBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *logBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

func frontWithLog(t *testing.T, cfg *Config, logs io.Writer) *httptest.Server {
	t.Helper()
	web := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>t</title>")}}
	logger := slog.New(slog.NewTextHandler(logs, nil))
	front := httptest.NewServer(NewHandler(cfg, web, true, NewUpstreamTransport(cfg), logger))
	t.Cleanup(front.Close)
	return front
}

func postLogin(t *testing.T, front string, form url.Values, cookieMode bool, cookies ...*http.Cookie) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, front+ticketPath, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
	req.Header.Set("Accept-Encoding", "gzip")
	if cookieMode {
		req.Header.Set(ticketModeHeader, ticketModeCookie)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	// The default client would transparently gunzip; this one must not need to.
	resp, err := (&http.Transport{DisableCompression: true}).RoundTrip(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]any
	raw, _ := io.ReadAll(resp.Body)
	_ = json.Unmarshal(raw, &body)
	return resp, body
}

func dataField(body map[string]any, key string) any {
	d, _ := body["data"].(map[string]any)
	return d[key]
}

func TestTicketMovesIntoHttpOnlyCookie(t *testing.T) {
	passwords := make(chan string, 4)
	backend := fakeTicketPVE(t, passwords)
	front := newFront(t, &Config{PVE: mustURL(t, backend.URL), InsecureTLS: true})

	resp, body := postLogin(t, front.URL, url.Values{"username": {"root@pam"}, "password": {"secret"}}, true)
	<-passwords
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if got := dataField(body, "ticket"); got != "" {
		t.Fatalf("ticket left in JSON: %v", got)
	}
	if dataField(body, "CSRFPreventionToken") != "csrf" {
		t.Fatalf("other fields lost: %v", body)
	}
	var cookie *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == authCookieName {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || cookie.Path != "/api2/" || cookie.SameSite != http.SameSiteStrictMode || cookie.MaxAge != 0 || !cookie.Expires.IsZero() {
		t.Fatalf("cookie %+v, want HttpOnly session cookie on /api2/", cookie)
	}
	if v, _ := url.QueryUnescape(cookie.Value); v != realTicket {
		t.Fatalf("cookie value %q", cookie.Value)
	}

	// Renewal: the placeholder password is replaced by the cookie's ticket.
	resp, body = postLogin(t, front.URL, url.Values{"username": {"root@pam"}, "password": {renewPassword}}, true, cookie)
	if pw := <-passwords; pw != realTicket {
		t.Fatalf("PVE got password %q, want the ticket", pw)
	}
	if resp.StatusCode != 200 || dataField(body, "ticket") != "" {
		t.Fatalf("renewal: %d %v", resp.StatusCode, body)
	}
	// Renewal without the cookie never reaches PVE.
	resp, _ = postLogin(t, front.URL, url.Values{"username": {"root@pam"}, "password": {renewPassword}}, true)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("renewal without cookie: %d", resp.StatusCode)
	}
	select {
	case pw := <-passwords:
		t.Fatalf("PVE was asked with %q", pw)
	default:
	}
}

func TestTicketPassthroughForOtherClientsAndTFA(t *testing.T) {
	backend := fakeTicketPVE(t, nil)
	front := newFront(t, &Config{PVE: mustURL(t, backend.URL), InsecureTLS: true})

	// API clients that do not ask for cookie mode get PVE's answer unchanged.
	resp, body := postLogin(t, front.URL, url.Values{"username": {"root@pam"}, "password": {"secret"}}, false)
	if dataField(body, "ticket") != realTicket || len(resp.Cookies()) != 0 {
		t.Fatalf("plain client: %v %v", body, resp.Cookies())
	}
	// The interim two-factor ticket stays in the JSON: the SPA posts it back.
	resp, body = postLogin(t, front.URL, url.Values{"username": {"root@pam"}, "password": {"tfa"}}, true)
	if got, _ := dataField(body, "ticket").(string); !strings.HasPrefix(got, "PVE:!tfa!") || len(resp.Cookies()) != 0 {
		t.Fatalf("tfa: %v %v", body, resp.Cookies())
	}
}

func TestFailedLoginsAreLoggedAndThrottled(t *testing.T) {
	backend := fakeTicketPVE(t, nil)
	logs := &logBuffer{}
	front := frontWithLog(t, &Config{PVE: mustURL(t, backend.URL), InsecureTLS: true}, logs)

	for i := 0; i <= ipLoginPolicy.free; i++ {
		resp, _ := postLogin(t, front.URL, url.Values{"username": {"Root@pam"}, "password": {"wrong-" + string(rune('a'+i))}}, true)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, resp.StatusCode)
		}
	}
	out := logs.String()
	if !strings.Contains(out, "login failed") || !strings.Contains(out, "client=127.0.0.1") || !strings.Contains(out, "user=root@pam") {
		t.Fatalf("log: %s", out)
	}
	if strings.Contains(out, "wrong-") {
		t.Fatalf("password logged: %s", out)
	}
	// Now even the right password waits.
	resp, body := postLogin(t, front.URL, url.Values{"username": {"root@pam"}, "password": {"secret"}}, true)
	if resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("after failures: %d %v", resp.StatusCode, body)
	}
}

func TestLoginLimiterBackoff(t *testing.T) {
	now := time.Unix(1_000_000, 0)
	l := newLoginLimiter()
	l.now = func() time.Time { return now }
	p := loginPolicy{free: 2, base: 10 * time.Second, maximum: 35 * time.Second}
	l.fail("k", p)
	l.fail("k", p)
	if d := l.wait("k"); d != 0 {
		t.Fatalf("within free attempts: %v", d)
	}
	l.fail("k", p)
	if d := l.wait("k", "other"); d != 10*time.Second {
		t.Fatalf("first delay %v", d)
	}
	l.fail("k", p)
	l.fail("k", p)
	if d := l.wait("k"); d != 35*time.Second {
		t.Fatalf("capped delay %v", d)
	}
	now = now.Add(time.Minute)
	if d := l.wait("k"); d != 0 {
		t.Fatalf("after the delay: %v", d)
	}
	l.reset("k")
	l.fail("k", p)
	if d := l.wait("k"); d != 0 {
		t.Fatalf("reset: %v", d)
	}
}

func TestAllowFromAndTrustedProxies(t *testing.T) {
	_, lan, _ := net.ParseCIDR("10.0.0.0/8")
	_, proxy, _ := net.ParseCIDR("192.168.1.1/32")
	cfg := &Config{AllowFrom: []*net.IPNet{lan}, TrustedProxies: []*net.IPNet{proxy}}
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) })
	h := allowFrom(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), ok)
	cases := []struct {
		remote, xff string
		want        int
	}{
		{"10.1.2.3:5000", "", 204},
		{"127.0.0.1:5000", "", 204},
		{"8.8.8.8:5000", "", 403},
		{"8.8.8.8:5000", "10.1.2.3", 403}, // forged header from an untrusted peer
		{"192.168.1.1:5000", "10.1.2.3", 204},
		{"192.168.1.1:5000", "10.9.9.9, 8.8.8.8", 403}, // right-most untrusted entry counts
	}
	for _, c := range cases {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.RemoteAddr = c.remote
		if c.xff != "" {
			r.Header.Set("X-Forwarded-For", c.xff)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s via %q: %d, want %d", c.remote, c.xff, w.Code, c.want)
		}
	}
}

func TestLogoutClearsCookie(t *testing.T) {
	front := newFront(t, &Config{PVE: mustURL(t, "https://127.0.0.1:1")})
	req, _ := http.NewRequest(http.MethodPost, front.URL+"/api/logout", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("without header: %d", resp.StatusCode)
	}
	req.Header.Set(ticketModeHeader, ticketModeCookie)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	set := resp.Header.Get("Set-Cookie")
	if resp.StatusCode != http.StatusNoContent || !strings.Contains(set, "PVEAuthCookie=;") || !strings.Contains(set, "Max-Age=0") || !strings.Contains(set, "Path=/api2/") {
		t.Fatalf("logout: %d %q", resp.StatusCode, set)
	}
}
