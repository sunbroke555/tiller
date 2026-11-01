package main

// Cross-origin protection in front of PVE. The proxy rewrites Origin to PVE's
// own before forwarding (pveproxy has no notion of Tiller's address), and
// pveproxy does not check Origin on websocket upgrades at all. What is left
// is SameSite=Strict on the ticket cookie, the CSRF header and the
// short-lived vncticket. SameSite does not separate same-site but
// cross-origin pages (another port on the same host, a sibling subdomain):
// they still send the cookie. So before anything is rewritten, browser
// requests that can change state (websocket upgrades, non-GET methods) must
// come from this origin.

import (
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"strings"
)

// safeMethod reports methods that only read (and are not websocket upgrades).
func safeMethod(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return !strings.EqualFold(r.Header.Get("Upgrade"), "websocket")
	}
	return false
}

// hostKey lower-cases host[:port] and drops the scheme's default port, so
// "https://pve.lan" and Host "PVE.lan:443" compare equal.
func hostKey(host, scheme string) string {
	host = strings.ToLower(host)
	if h, port, err := net.SplitHostPort(host); err == nil {
		if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
			return h
		}
		return net.JoinHostPort(h, port)
	}
	return strings.Trim(host, "[]")
}

// crossOriginReason explains why a state-changing browser request does not
// come from this origin, or returns "" when it may pass. Requests without
// Origin (curl, scripts, the e2e API client) are not browser requests a
// third-party page could forge and pass unchanged.
func crossOriginReason(r *http.Request, trusted []*net.IPNet) string {
	if safeMethod(r) {
		return ""
	}
	if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
		return "Sec-Fetch-Site: cross-site"
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return ""
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "Origin " + origin
	}
	want := hostKey(u.Host, u.Scheme)
	hosts := []string{r.Host}
	// A trusted reverse proxy may address Tiller by another name and pass
	// the public one on.
	if peer := remoteIP(r); peer != nil && inNets(peer, trusted) {
		for _, v := range r.Header.Values("X-Forwarded-Host") {
			for _, h := range strings.Split(v, ",") {
				hosts = append(hosts, strings.TrimSpace(h))
			}
		}
	}
	for _, h := range hosts {
		if h != "" && hostKey(h, u.Scheme) == want {
			return ""
		}
	}
	return "Origin " + origin + " ≠ Host " + r.Host
}

func remoteIP(r *http.Request) net.IP {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return net.ParseIP(host)
}

// sameOrigin rejects cross-origin websocket upgrades and state-changing
// requests with 403 before they reach PVE.
func sameOrigin(trusted []*net.IPNet, logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reason := crossOriginReason(r, trusted); reason != "" {
			logger.Warn("cross-origin request rejected", "client", ipString(clientIP(r, trusted)),
				"method", r.Method, "path", r.URL.Path, "reason", reason)
			writePVEError(w, http.StatusForbidden, "跨站请求已被拒绝")
			return
		}
		next.ServeHTTP(w, r)
	})
}
