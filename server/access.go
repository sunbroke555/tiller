package main

// Access control that pveproxy cannot do itself once Tiller sits in front of
// it: PVE only ever sees Tiller's address, so its ALLOW_FROM, fail2ban and
// "authentication failure; rhost=" log lose the real client. Tiller
// therefore offers its own client allowlist, slows down repeated failed
// logins per client address and per user, and logs failed logins with the
// client address (never the password or ticket).
//
// It also keeps the SPA's login ticket out of JavaScript: when the SPA asks
// for it (X-Tiller-Ticket: cookie), the ticket from POST /access/ticket goes
// into an HttpOnly session cookie scoped to /api2/ and is removed from the
// JSON. Renewal posts a placeholder password that is replaced here by the
// cookie's ticket. Other API clients get PVE's normal responses.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	authCookieName = "PVEAuthCookie"
	authCookiePath = "/api2/"
	// ticketModeHeader is sent by the SPA to keep the ticket in an HttpOnly cookie.
	ticketModeHeader = "X-Tiller-Ticket"
	ticketModeCookie = "cookie"
	// renewPassword stands for "the ticket in my cookie" in a renewal request.
	renewPassword = "tiller:cookie-ticket"

	ticketPath      = "/api2/json/access/ticket"
	openIDLoginPath = "/api2/json/access/openid/login"
	maxLoginBody    = 64 << 10
)

// clientIP is the socket peer, or, when that peer is a trusted reverse
// proxy, the right-most X-Forwarded-For entry that is not a trusted proxy.
func clientIP(r *http.Request, trusted []*net.IPNet) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip == nil || !inNets(ip, trusted) {
		return ip
	}
	parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		p := net.ParseIP(strings.TrimSpace(parts[i]))
		if p == nil {
			break
		}
		if !inNets(p, trusted) {
			return p
		}
		ip = p
	}
	return ip
}

func inNets(ip net.IP, nets []*net.IPNet) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

func ipString(ip net.IP) string {
	if ip == nil {
		return "unknown"
	}
	return ip.String()
}

// allowFrom rejects clients outside cfg.AllowFrom (loopback always passes).
func allowFrom(cfg *Config, logger *slog.Logger, next http.Handler) http.Handler {
	if len(cfg.AllowFrom) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r, cfg.TrustedProxies)
		if ip == nil || (!ip.IsLoopback() && !inNets(ip, cfg.AllowFrom)) {
			logger.Warn("client not in ALLOW_FROM", "client", ipString(ip), "path", r.URL.Path)
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ------------------------------------------------------------ login limiter

type loginPolicy struct {
	free    int           // failures before any delay
	base    time.Duration // first delay, doubled per further failure
	maximum time.Duration
}

var (
	ipLoginPolicy   = loginPolicy{free: 5, base: 30 * time.Second, maximum: 15 * time.Minute}
	userLoginPolicy = loginPolicy{free: 10, base: 30 * time.Second, maximum: 5 * time.Minute}
)

type loginAttempts struct {
	fails int
	until time.Time
	last  time.Time
}

// loginLimiter counts consecutive failed logins per key ("ip:…", "user:…").
type loginLimiter struct {
	mu  sync.Mutex
	m   map[string]*loginAttempts
	now func() time.Time
}

func newLoginLimiter() *loginLimiter {
	return &loginLimiter{m: map[string]*loginAttempts{}, now: time.Now}
}

// wait returns how long the longest-blocked of keys must still wait.
func (l *loginLimiter) wait(keys ...string) time.Duration {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	var d time.Duration
	for _, k := range keys {
		if a := l.m[k]; a != nil && a.until.After(now) && a.until.Sub(now) > d {
			d = a.until.Sub(now)
		}
	}
	return d
}

func (l *loginLimiter) fail(key string, p loginPolicy) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.m) > 10000 {
		for k, a := range l.m {
			if now.Sub(a.last) > time.Hour {
				delete(l.m, k)
			}
		}
	}
	a := l.m[key]
	if a == nil || now.Sub(a.last) > time.Hour {
		a = &loginAttempts{}
		l.m[key] = a
	}
	a.fails++
	a.last = now
	if over := a.fails - p.free; over > 0 {
		d := p.base
		for i := 1; i < over && d < p.maximum; i++ {
			d *= 2
		}
		a.until = now.Add(min(d, p.maximum))
	}
}

func (l *loginLimiter) reset(keys ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, k := range keys {
		delete(l.m, k)
	}
}

// ----------------------------------------------------------- ticket guard

// authGuard wraps the API proxy for the login endpoints: throttling, failed
// login logging and the HttpOnly ticket cookie.
type authGuard struct {
	next    http.Handler
	limiter *loginLimiter
	trusted []*net.IPNet
	logger  *slog.Logger
}

func newAuthGuard(next http.Handler, cfg *Config, logger *slog.Logger) *authGuard {
	return &authGuard{next: next, limiter: newLoginLimiter(), trusted: cfg.TrustedProxies, logger: logger}
}

func (g *authGuard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	isTicket := r.Method == http.MethodPost && r.URL.Path == ticketPath
	isOpenID := r.Method == http.MethodPost && r.URL.Path == openIDLoginPath
	if !isTicket && !isOpenID {
		g.next.ServeHTTP(w, r)
		return
	}
	cookieMode := r.Header.Get(ticketModeHeader) == ticketModeCookie
	ip := ipString(clientIP(r, g.trusted))

	var username string
	var tfa bool
	if isTicket {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxLoginBody))
		r.Body.Close()
		if err != nil {
			writePVEError(w, http.StatusRequestEntityTooLarge, "请求过大")
			return
		}
		form, isForm := parseLoginBody(r.Header.Get("Content-Type"), body)
		username = strings.ToLower(strings.TrimSpace(form.Get("username")))
		tfa = form.Get("tfa-challenge") != ""
		if wait := g.limiter.wait("ip:"+ip, "user:"+username); wait > 0 {
			secs := int(wait.Round(time.Second) / time.Second)
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			writePVEError(w, http.StatusTooManyRequests, fmt.Sprintf("登录失败次数过多，请 %d 秒后再试", secs))
			return
		}
		if cookieMode && isForm && form.Get("password") == renewPassword {
			ticket := cookieTicket(r)
			if ticket == "" {
				writePVEError(w, http.StatusUnauthorized, "登录已过期")
				return
			}
			form.Set("password", ticket)
			body = []byte(form.Encode())
		}
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		r.Header.Set("Content-Length", strconv.Itoa(len(body)))
	}

	// Buffer the (small) answer: an uncompressed body we may rewrite.
	r.Header.Del("Accept-Encoding")
	rec := &bufferedResponse{header: http.Header{}, status: http.StatusOK}
	g.next.ServeHTTP(rec, r)

	if isTicket {
		switch {
		case rec.status == http.StatusUnauthorized:
			g.limiter.fail("ip:"+ip, ipLoginPolicy)
			if username != "" {
				g.limiter.fail("user:"+username, userLoginPolicy)
			}
			g.logger.Warn("login failed", "client", ip, "user", username, "tfa", tfa)
		case rec.status == http.StatusOK:
			g.limiter.reset("ip:"+ip, "user:"+username)
		}
	}

	body := rec.body.Bytes()
	if cookieMode && rec.status == http.StatusOK {
		if out, ticket, ok := takeTicket(body); ok {
			body = out
			rec.header.Add("Set-Cookie", scopedTicketCookie(r, ticket, isHTTPS(r, g.trusted), false).String())
		}
	}
	for k, v := range rec.header {
		w.Header()[k] = v
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(rec.status)
	_, _ = w.Write(body)
}

// parseLoginBody reads form or JSON login parameters.
func parseLoginBody(contentType string, body []byte) (url.Values, bool) {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(contentType)), "application/json") {
		var m map[string]any
		out := url.Values{}
		if json.Unmarshal(body, &m) == nil {
			for k, v := range m {
				if s, ok := v.(string); ok {
					out.Set(k, s)
				}
			}
		}
		return out, false
	}
	v, err := url.ParseQuery(string(body))
	if err != nil {
		return url.Values{}, false
	}
	return v, true
}

func cookieTicket(r *http.Request) string {
	c, err := r.Cookie(scopeOf(r).cookieName)
	if err != nil || c.Value == "" {
		return ""
	}
	if v, err := url.QueryUnescape(c.Value); err == nil {
		return v
	}
	return c.Value
}

// takeTicket moves a full ticket out of a /access/ticket answer. The
// interim two-factor ticket ("PVE:!tfa!…") stays: the SPA posts it back.
func takeTicket(body []byte) ([]byte, string, bool) {
	var env map[string]json.RawMessage
	if json.Unmarshal(body, &env) != nil {
		return body, "", false
	}
	var data map[string]json.RawMessage
	if json.Unmarshal(env["data"], &data) != nil {
		return body, "", false
	}
	var ticket string
	if json.Unmarshal(data["ticket"], &ticket) != nil || ticket == "" || isTFATicket(ticket) {
		return body, "", false
	}
	data["ticket"] = json.RawMessage(`""`)
	raw, err := json.Marshal(data)
	if err != nil {
		return body, "", false
	}
	env["data"] = raw
	out, err := json.Marshal(env)
	if err != nil {
		return body, "", false
	}
	return out, ticket, true
}

func isTFATicket(ticket string) bool {
	parts := strings.SplitN(ticket, ":", 3)
	return len(parts) > 1 && strings.HasPrefix(parts[1], "!tfa!")
}

// isHTTPS: TLS here, or a trusted reverse proxy says the client used https.
func isHTTPS(r *http.Request, trusted []*net.IPNet) bool {
	if r.TLS != nil {
		return true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && inNets(ip, trusted) && strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// ticketCookie is a session cookie (no Max-Age, like the official UI) that
// JavaScript cannot read and that only goes to the API.
func ticketCookie(ticket string, secure, clear bool) *http.Cookie {
	c := &http.Cookie{
		Name:     authCookieName,
		Value:    url.QueryEscape(ticket),
		Path:     authCookiePath,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	}
	if clear {
		c.Value, c.MaxAge = "", -1
	}
	return c
}

// logoutHandler clears the HttpOnly ticket cookie (JavaScript cannot). The
// custom header keeps cross-site pages from triggering it (CORS preflight).
func logoutHandler(trusted []*net.IPNet) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(ticketModeHeader) != ticketModeCookie {
			http.Error(w, "missing "+ticketModeHeader+" header", http.StatusBadRequest)
			return
		}
		http.SetCookie(w, scopedTicketCookie(r, "", isHTTPS(r, trusted), true))
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	})
}

// bufferedResponse collects a handler's response.
type bufferedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
	wrote  bool
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) WriteHeader(status int) {
	if !b.wrote {
		b.status, b.wrote = status, true
	}
}

func (b *bufferedResponse) Write(p []byte) (int, error) {
	b.wrote = true
	return b.body.Write(p)
}
