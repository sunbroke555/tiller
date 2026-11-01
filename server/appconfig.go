package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// The login consent text (Datacenter → Options → Consent Text) is injected by
// pveproxy into its index page as base64 (`ConsentText: '…'`) and is not
// readable through the API without a ticket. The server fetches PVE's index
// page, extracts it and serves it as GET /api/config so the login page can
// show it before login, like the official UI. No credentials are involved.

const (
	consentCacheTTL   = 5 * time.Minute
	consentErrorTTL   = 30 * time.Second
	consentFetchLimit = 1 << 20 // the index page is ~3 KiB
)

var consentRe = regexp.MustCompile(`ConsentText:\s*'([^']*)'`)

// ExtractConsentText finds the base64 consent text in PVE's index page and
// decodes it. Returns "" when there is none.
func ExtractConsentText(page string) string {
	m := consentRe.FindStringSubmatch(page)
	if m == nil {
		return ""
	}
	raw := strings.TrimSpace(m[1])
	if raw == "" {
		return ""
	}
	clean := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		return r
	}, raw)
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := enc.DecodeString(clean); err == nil {
			return string(b)
		}
	}
	// Not base64 (older or patched pveproxy): show it as is.
	return raw
}

// consentSource caches the consent text fetched from PVE.
type consentSource struct {
	index   string // PVE index page URL
	client  *http.Client
	logger  *slog.Logger
	mu      sync.Mutex
	text    string
	expires time.Time
}

func newConsentSource(pve *url.URL, transport http.RoundTripper, logger *slog.Logger) *consentSource {
	return &consentSource{
		index:  pve.String() + "/",
		client: &http.Client{Transport: transport, Timeout: 10 * time.Second},
		logger: logger,
	}
}

// Get returns the cached consent text, refreshing it when stale. On fetch
// errors the last good value is kept.
func (c *consentSource) Get(ctx context.Context) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.expires) {
		return c.text
	}
	text, err := c.fetch(ctx)
	if err != nil {
		c.logger.Warn("consent text: cannot read PVE index page", "err", err)
		c.expires = time.Now().Add(consentErrorTTL)
		return c.text
	}
	c.text = text
	c.expires = time.Now().Add(consentCacheTTL)
	return c.text
}

func (c *consentSource) fetch(ctx context.Context) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.index, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "text/html")
	resp, err := c.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New("PVE index page: " + resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, consentFetchLimit))
	if err != nil {
		return "", err
	}
	return ExtractConsentText(string(body)), nil
}

// appConfigHandler serves GET /api/config: public, non-secret settings the
// login page needs before there is a ticket.
func appConfigHandler(consent *consentSource) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
		defer cancel()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{"consentText": consent.Get(ctx)})
	})
}
