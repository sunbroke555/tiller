package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

const bootScript = `(function(){document.documentElement.dataset.theme="dark"})()`

var testIndex = "<!doctype html><html><head><script>" + bootScript + "</script>" +
	`<script type="module" crossorigin src="/assets/index-abc.js"></script></head>` +
	"<body><div id=root></div></body></html>"

func testWebFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           {Data: []byte(testIndex)},
		"assets/index-abc.js":  {Data: []byte(strings.Repeat("console.log('pve web');\n", 100))},
		"assets/font-1.woff2":  {Data: bytes.Repeat([]byte{0x77}, 2048)},
		"manifest.webmanifest": {Data: []byte(`{"name":"PVE Web"}`)},
		"sw.js":                {Data: []byte("self.addEventListener('fetch',()=>{})")},
		"icons/icon.svg":       {Data: []byte("<svg/>")},
	}
}

func serve(t *testing.T, h http.Handler, method, target string, hdr map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestSPAFallback(t *testing.T) {
	h := securityHeaders(newSPAHandler(testWebFS(), true))

	for _, p := range []string{"/", "/index.html", "/guest/pve/qemu/100", "/storage", "/login?next=%2Ftasks", "/node/pve/", "/deep/a/b/c.html"} {
		rec := serve(t, h, http.MethodGet, p, nil)
		if rec.Code != 200 || rec.Body.String() != testIndex {
			t.Errorf("%s: got %d %.40q, want index.html", p, rec.Code, rec.Body.String())
		}
		if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
			t.Errorf("%s: content-type %q", p, ct)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Errorf("%s: cache-control %q", p, cc)
		}
	}

	for _, p := range []string{"/assets/missing.js", "/favicon.png", "/assets/nope", "/api2/json/x"} {
		if rec := serve(t, h, http.MethodGet, p, nil); rec.Code != 404 {
			t.Errorf("%s: got %d, want 404", p, rec.Code)
		}
	}

	if rec := serve(t, h, http.MethodPost, "/guest", nil); rec.Code != 405 {
		t.Errorf("POST: got %d, want 405", rec.Code)
	}
	if rec := serve(t, h, http.MethodHead, "/storage", nil); rec.Code != 200 || rec.Body.Len() != 0 {
		t.Errorf("HEAD: got %d with %d bytes", rec.Code, rec.Body.Len())
	}
}

func TestStaticAssetsCachingAndTypes(t *testing.T) {
	h := newSPAHandler(testWebFS(), true)

	rec := serve(t, h, http.MethodGet, "/assets/index-abc.js", nil)
	if rec.Code != 200 {
		t.Fatalf("got %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Errorf("hashed asset cache-control %q", cc)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/javascript; charset=utf-8" {
		t.Errorf("js content-type %q", ct)
	}

	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	if rec := serve(t, h, http.MethodGet, "/assets/index-abc.js", map[string]string{"If-None-Match": etag}); rec.Code != 304 {
		t.Errorf("conditional GET: got %d, want 304", rec.Code)
	}

	if rec := serve(t, h, http.MethodGet, "/sw.js", nil); rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("sw.js must not be cached: %q", rec.Header().Get("Cache-Control"))
	}
	if ct := serve(t, h, http.MethodGet, "/manifest.webmanifest", nil).Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("manifest content-type %q", ct)
	}
	if ct := serve(t, h, http.MethodGet, "/assets/font-1.woff2", nil).Header().Get("Content-Type"); ct != "font/woff2" {
		t.Errorf("woff2 content-type %q", ct)
	}
}

func TestStaticGzip(t *testing.T) {
	h := newSPAHandler(testWebFS(), true)
	want := testWebFS()["assets/index-abc.js"].Data

	rec := serve(t, h, http.MethodGet, "/assets/index-abc.js", map[string]string{"Accept-Encoding": "br, gzip"})
	if rec.Header().Get("Content-Encoding") != "gzip" {
		t.Fatalf("expected gzip, headers %v", rec.Header())
	}
	if !strings.Contains(rec.Header().Get("Vary"), "Accept-Encoding") {
		t.Errorf("missing Vary: Accept-Encoding")
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(zr)
	if !bytes.Equal(got, want) {
		t.Fatal("gzip body does not round-trip")
	}
	gzETag := rec.Header().Get("ETag")

	plain := serve(t, h, http.MethodGet, "/assets/index-abc.js", map[string]string{"Accept-Encoding": "gzip;q=0"})
	if plain.Header().Get("Content-Encoding") != "" || !bytes.Equal(plain.Body.Bytes(), want) {
		t.Errorf("gzip;q=0 must get identity encoding")
	}
	if plain.Header().Get("ETag") == gzETag {
		t.Errorf("gzip and identity representations share an ETag")
	}

	// Already-compressed formats are never gzipped.
	if rec := serve(t, h, http.MethodGet, "/assets/font-1.woff2", map[string]string{"Accept-Encoding": "gzip"}); rec.Header().Get("Content-Encoding") != "" {
		t.Errorf("woff2 must not be gzipped")
	}
}

func TestIndexCSPAllowsOnlyInlineBootScript(t *testing.T) {
	h := newSPAHandler(testWebFS(), true)
	rec := serve(t, h, http.MethodGet, "/overview", nil)
	csp := rec.Header().Get("Content-Security-Policy")
	sum := sha256.Sum256([]byte(bootScript))
	wantHash := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	if !strings.Contains(csp, "script-src 'self' "+wantHash) {
		t.Fatalf("CSP %q lacks boot script hash %s", csp, wantHash)
	}
	for _, d := range strings.Split(csp, ";") {
		if strings.HasPrefix(strings.TrimSpace(d), "script-src") && strings.Contains(d, "unsafe-inline") {
			t.Errorf("script-src must not allow unsafe-inline: %q", csp)
		}
	}
	if strings.Count(csp, "sha256-") != 1 {
		t.Errorf("external scripts must not be hashed: %q", csp)
	}
	for _, d := range []string{"frame-ancestors 'none'", "object-src 'none'", "default-src 'self'"} {
		if !strings.Contains(csp, d) {
			t.Errorf("CSP missing %q", d)
		}
	}
	if serve(t, h, http.MethodGet, "/assets/index-abc.js", nil).Header().Get("Content-Security-Policy") != "" {
		t.Errorf("CSP should only be set on the document")
	}
}

func TestSecurityHeaders(t *testing.T) {
	h := securityHeaders(newSPAHandler(testWebFS(), true))
	rec := serve(t, h, http.MethodGet, "/", nil)
	for k, v := range map[string]string{
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options":        "DENY",
		"Referrer-Policy":        "same-origin",
	} {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	if rec.Header().Get("Strict-Transport-Security") != "" {
		t.Errorf("HSTS must only be sent over TLS")
	}
}

func TestNotBuiltPage(t *testing.T) {
	h := newSPAHandler(emptyFS{}, true)
	rec := serve(t, h, http.MethodGet, "/", nil)
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "make web") {
		t.Fatalf("got %d %q", rec.Code, rec.Body.String())
	}
}

func TestDiskFSIsNotCached(t *testing.T) {
	fsys := testWebFS()
	h := newSPAHandler(fsys, false)
	_ = serve(t, h, http.MethodGet, "/sw.js", nil)
	fsys["sw.js"] = &fstest.MapFile{Data: []byte("changed")}
	if got := serve(t, h, http.MethodGet, "/sw.js", nil).Body.String(); got != "changed" {
		t.Fatalf("dev mode served stale file %q", got)
	}
}

func TestAcceptsGzip(t *testing.T) {
	cases := map[string]bool{
		"":                    false,
		"gzip":                true,
		"deflate, gzip;q=1.0": true,
		"gzip;q=0":            false,
		"br":                  false,
		"*":                   true,
		"GZIP ; q=0.5":        true,
	}
	for in, want := range cases {
		if got := acceptsGzip(in); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", in, got, want)
		}
	}
}
