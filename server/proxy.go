package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

// Upstream timeouts. There is deliberately no overall request/response timeout:
// websockets (VNC, terminal) and large downloads/uploads stay open as long as
// the client keeps them open. Only connection setup and waiting for response
// headers are bounded.
const (
	upstreamDialTimeout     = 10 * time.Second
	upstreamTLSTimeout      = 10 * time.Second
	upstreamResponseTimeout = 5 * time.Minute // some synchronous PVE calls are slow
	upstreamIdleConnTimeout = 90 * time.Second
)

// FingerprintMismatchError is returned by the TLS handshake when PVE presents
// a certificate whose SHA-256 fingerprint differs from PVE_TLS_FINGERPRINT.
type FingerprintMismatchError struct {
	Got string
}

func (e *FingerprintMismatchError) Error() string {
	return "PVE 证书指纹不匹配（实际 " + e.Got + "）"
}

// FormatFingerprint renders a SHA-256 digest as colon separated upper-case hex,
// the same format PVE shows.
func FormatFingerprint(b []byte) string {
	h := strings.ToUpper(hex.EncodeToString(b))
	var sb strings.Builder
	for i := 0; i < len(h); i += 2 {
		if i > 0 {
			sb.WriteByte(':')
		}
		sb.WriteString(h[i : i+2])
	}
	return sb.String()
}

// NewUpstreamTLSConfig returns the TLS configuration for talking to PVE.
func NewUpstreamTLSConfig(cfg *Config) *tls.Config {
	tc := &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: cfg.PVE.Hostname(),
		RootCAs:    cfg.RootCAs,
		// PVE's API server speaks HTTP/1.1 only; websocket upgrades need it too.
		NextProtos: []string{"http/1.1"},
	}
	switch {
	case cfg.Fingerprint != nil:
		want := cfg.Fingerprint
		// Chain verification is replaced by pinning the leaf certificate.
		tc.InsecureSkipVerify = true
		tc.VerifyConnection = func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("PVE 没有提供证书")
			}
			sum := sha256.Sum256(cs.PeerCertificates[0].Raw)
			if subtle.ConstantTimeCompare(sum[:], want) != 1 {
				return &FingerprintMismatchError{Got: FormatFingerprint(sum[:])}
			}
			return nil
		}
	case cfg.InsecureTLS:
		tc.InsecureSkipVerify = true
	}
	return tc
}

// NewUpstreamTransport returns the HTTP transport used for every proxied request.
func NewUpstreamTransport(cfg *Config) *http.Transport {
	dialer := &net.Dialer{Timeout: upstreamDialTimeout, KeepAlive: 30 * time.Second}
	return &http.Transport{
		Proxy:                 nil, // never route PVE traffic through HTTP(S)_PROXY
		DialContext:           dialer.DialContext,
		TLSClientConfig:       NewUpstreamTLSConfig(cfg),
		TLSHandshakeTimeout:   upstreamTLSTimeout,
		ResponseHeaderTimeout: upstreamResponseTimeout,
		ExpectContinueTimeout: time.Second,
		IdleConnTimeout:       upstreamIdleConnTimeout,
		MaxIdleConnsPerHost:   32,
		ForceAttemptHTTP2:     false,
	}
}

// proxiedCSP applies to everything PVE answers: API data is never a document
// the browser should render or run on this origin (PVE also has HTML
// formatters, which are not forwarded, but a mislabelled response must not
// become script either).
const proxiedCSP = "default-src 'none'; frame-ancestors 'none'; sandbox"

// NewProxy returns a handler that forwards /api2/json/* to the PVE API
// unchanged, including websocket upgrades (vncwebsocket, termproxy). Host,
// Origin and Referer are rewritten so PVE sees requests addressed to itself
// (sameOrigin has checked the browser's Origin before);
// X-Forwarded-For carries the client address for pveproxy's access log
// (PROXY_REAL_IP_HEADER=X-Forwarded-For with PROXY_REAL_IP_ALLOW_FROM set to
// Tiller's address). trusted lists reverse proxies in front of Tiller.
func NewProxy(target *url.URL, transport http.RoundTripper, logger *slog.Logger, trusted []*net.IPNet) http.Handler {
	origin := target.Scheme + "://" + target.Host
	return &httputil.ReverseProxy{
		Transport: transport,
		Rewrite: func(pr *httputil.ProxyRequest) {
			// Rewrite (unlike Director) already strips hop-by-hop and
			// client-supplied X-Forwarded-*/Forwarded headers.
			pr.SetURL(target)
			pr.Out.Host = target.Host
			// Forward only this instance's ticket, never another instance's
			// cookie or Tiller's session markers / management credentials.
			pr.Out.Header.Del("Cookie")
			if ticket := cookieTicket(pr.In); ticket != "" {
				pr.Out.AddCookie(&http.Cookie{Name: authCookieName, Value: url.QueryEscape(ticket)})
			}
			// Our own view of the client (not a header the client could forge).
			if ip := clientIP(pr.In, trusted); ip != nil {
				pr.Out.Header.Set("X-Forwarded-For", ip.String())
			}
			proto := "http"
			if isHTTPS(pr.In, trusted) {
				proto = "https"
			}
			pr.Out.Header.Set("X-Forwarded-Proto", proto)
			if pr.In.Header.Get("Origin") != "" {
				pr.Out.Header.Set("Origin", origin)
			}
			if ref := pr.In.Header.Get("Referer"); ref != "" {
				if u, err := url.Parse(ref); err == nil && u.Host != "" {
					u.Scheme, u.Host = target.Scheme, target.Host
					pr.Out.Header.Set("Referer", u.String())
				} else {
					pr.Out.Header.Del("Referer")
				}
			}
		},
		ModifyResponse: func(resp *http.Response) error {
			// Only authGuard may create browser cookies, with the correct scope.
			resp.Header.Del("Set-Cookie")
			// securityHeaders already set these on the response writer; the
			// proxy would otherwise append PVE's copies as duplicates.
			for _, k := range securityHeaderNames {
				resp.Header.Del(k)
			}
			resp.Header.Set("Content-Security-Policy", proxiedCSP)
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			if errors.Is(err, context.Canceled) || errors.Is(r.Context().Err(), context.Canceled) {
				// The browser went away (navigation, closed console): nothing to report.
				w.WriteHeader(499)
				return
			}
			// Details (upstream address, TLS errors, the presented
			// fingerprint) go to the log only: anyone, logged in or not,
			// can trigger this answer.
			msg := "无法连接 PVE，请稍后重试；持续出现请联系管理员查看 Tiller 日志"
			var authErr *connectionAuthError
			if errors.As(err, &authErr) {
				msg = authErr.message
			}
			var fpErr *FingerprintMismatchError
			if errors.As(err, &fpErr) {
				msg = "无法连接 PVE：证书指纹不匹配，请联系管理员检查 PVE_TLS_FINGERPRINT"
				if scopeOf(r).cookieName != authCookieName {
					msg = "无法连接 PVE：证书指纹不匹配，请联系管理员检查此实例的证书设置"
				}
			}
			logger.Warn("proxy error", "method", r.Method, "path", r.URL.Path, "err", err)
			writePVEError(w, http.StatusBadGateway, msg)
		},
	}
}

// writePVEError replies in the shape PVE uses for JSON errors so the frontend
// can treat proxy failures like any other API error.
func writePVEError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": nil, "message": msg})
}

// CheckUpstream performs one lightweight request against PVE at startup so
// misconfiguration (wrong URL, fingerprint mismatch) shows up in the log
// immediately instead of on the first login attempt. It never fails startup.
func CheckUpstream(ctx context.Context, cfg *Config, transport http.RoundTripper, logger *slog.Logger) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.PVE.String()+"/api2/json/version", nil)
	if err != nil {
		return
	}
	resp, err := transport.RoundTrip(req)
	if err != nil {
		var fpErr *FingerprintMismatchError
		if errors.As(err, &fpErr) {
			logger.Error("PVE certificate fingerprint mismatch", "got", fpErr.Got)
			return
		}
		logger.Warn("PVE not reachable yet", "url", cfg.PVE.String(), "err", err)
		return
	}
	resp.Body.Close()
	// 401 is expected: /version needs a ticket. Anything answering is PVE enough.
	logger.Info("PVE reachable", "url", cfg.PVE.String(), "status", fmt.Sprint(resp.StatusCode))
}
