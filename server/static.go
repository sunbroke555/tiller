package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// spaHandler serves the built single page app from fsys:
//   - real files are served with long-lived caching for hashed assets/,
//   - unknown extension-less paths fall back to index.html (client routing),
//   - compressible files are gzip-encoded (and cached when fsys is immutable),
//   - index.html carries a CSP that allows exactly its inline scripts (by hash).
type spaHandler struct {
	fsys fs.FS
	// immutable means fsys never changes (embedded build), so loaded files
	// and their gzip versions can be cached for the life of the process.
	immutable bool

	mu    sync.RWMutex
	cache map[string]*staticFile
}

type staticFile struct {
	name    string
	data    []byte
	gz      []byte // nil when not worth compressing
	etag    string
	ctype   string
	modTime time.Time
	csp     string // index.html only
}

const indexFile = "index.html"

// Minimum size before gzip is worth the CPU and the extra header.
const gzipMinSize = 512

func newSPAHandler(fsys fs.FS, immutable bool) *spaHandler {
	return &spaHandler{fsys: fsys, immutable: immutable, cache: map[string]*staticFile{}}
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = indexFile
	}

	f, err := h.load(name)
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, errIsDir) {
		if !isClientRoute(name) {
			http.NotFound(w, r)
			return
		}
		f, err = h.load(indexFile)
	}
	if errors.Is(err, fs.ErrNotExist) {
		serveNotBuilt(w)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.serveFile(w, r, f)
}

// isClientRoute reports whether a missing path should get index.html: paths
// without a file extension are routes of the SPA, everything else (a missing
// .js chunk, an image) is a real 404 so the browser does not parse HTML as JS.
func isClientRoute(name string) bool {
	if strings.HasPrefix(name, "assets/") || strings.HasPrefix(name, "api2/") {
		return false
	}
	ext := path.Ext(name)
	return ext == "" || ext == ".html"
}

func (h *spaHandler) serveFile(w http.ResponseWriter, r *http.Request, f *staticFile) {
	hdr := w.Header()
	hdr.Set("Content-Type", f.ctype)
	if strings.HasPrefix(f.name, "assets/") {
		// Vite puts content hashes in every file name under assets/.
		hdr.Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		// index.html, sw.js, manifest, icons: always revalidate so a new
		// deployment is picked up immediately.
		hdr.Set("Cache-Control", "no-cache")
	}
	if f.csp != "" {
		hdr.Set("Content-Security-Policy", f.csp)
	}

	body, etag := f.data, f.etag
	if f.gz != nil {
		hdr.Add("Vary", "Accept-Encoding")
		if acceptsGzip(r.Header.Get("Accept-Encoding")) {
			body, etag = f.gz, strings.TrimSuffix(f.etag, `"`)+`-gz"`
			hdr.Set("Content-Encoding", "gzip")
			// Byte ranges over a compressed representation are not useful here.
			r.Header.Del("Range")
		}
	}
	hdr.Set("ETag", etag)
	http.ServeContent(w, r, "", f.modTime, bytes.NewReader(body))
}

var errIsDir = errors.New("is a directory")

func (h *spaHandler) load(name string) (*staticFile, error) {
	if !fs.ValidPath(name) {
		return nil, fs.ErrNotExist
	}
	if h.immutable {
		h.mu.RLock()
		f, ok := h.cache[name]
		h.mu.RUnlock()
		if ok {
			return f, nil
		}
	}

	info, err := fs.Stat(h.fsys, name)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, errIsDir
	}
	data, err := fs.ReadFile(h.fsys, name)
	if err != nil {
		return nil, err
	}
	f := buildStaticFile(name, data, info.ModTime())

	if h.immutable {
		h.mu.Lock()
		h.cache[name] = f
		h.mu.Unlock()
	}
	return f, nil
}

func buildStaticFile(name string, data []byte, modTime time.Time) *staticFile {
	sum := sha256.Sum256(data)
	f := &staticFile{
		name:    name,
		data:    data,
		etag:    `"` + base64.RawURLEncoding.EncodeToString(sum[:12]) + `"`,
		ctype:   contentType(name),
		modTime: modTime,
	}
	if len(data) >= gzipMinSize && isCompressible(f.ctype) {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = zw.Write(data)
		_ = zw.Close()
		if buf.Len() < len(data) {
			f.gz = buf.Bytes()
		}
	}
	if name == indexFile {
		f.csp = buildCSP(data)
	}
	return f
}

func contentType(name string) string {
	switch path.Ext(name) {
	case ".html":
		return "text/html; charset=utf-8"
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".json", ".map":
		return "application/json; charset=utf-8"
	case ".webmanifest":
		return "application/manifest+json; charset=utf-8"
	case ".svg":
		return "image/svg+xml"
	case ".woff2":
		return "font/woff2"
	case ".woff":
		return "font/woff"
	case ".png":
		return "image/png"
	case ".ico":
		return "image/x-icon"
	case ".txt":
		return "text/plain; charset=utf-8"
	}
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

func isCompressible(ctype string) bool {
	return strings.HasPrefix(ctype, "text/") ||
		strings.HasPrefix(ctype, "application/json") ||
		strings.HasPrefix(ctype, "application/manifest+json") ||
		strings.HasPrefix(ctype, "image/svg+xml")
}

// acceptsGzip parses Accept-Encoding and honours "gzip;q=0".
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		token, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		token = strings.ToLower(strings.TrimSpace(token))
		if token != "gzip" && token != "*" {
			continue
		}
		q := 1.0
		if k, v, ok := strings.Cut(strings.TrimSpace(params), "="); ok && strings.TrimSpace(k) == "q" {
			if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
				q = f
			}
		}
		if q > 0 {
			return true
		}
	}
	return false
}

var inlineScriptRe = regexp.MustCompile(`(?is)<script(\s[^>]*)?>(.*?)</script>`)

// buildCSP returns the Content-Security-Policy for index.html. Inline scripts
// (the theme boot script that prevents a flash of the wrong theme) are allowed
// by their SHA-256 hash; everything else must come from this origin.
func buildCSP(html []byte) string {
	scriptSrc := []string{"'self'"}
	for _, m := range inlineScriptRe.FindAllSubmatch(html, -1) {
		attrs := strings.ToLower(string(m[1]))
		if strings.Contains(attrs, "src=") || len(m[2]) == 0 {
			continue
		}
		sum := sha256.Sum256(m[2])
		scriptSrc = append(scriptSrc, "'sha256-"+base64.StdEncoding.EncodeToString(sum[:])+"'")
	}
	directives := []string{
		"default-src 'self'",
		"script-src " + strings.Join(scriptSrc, " "),
		// Radix/React set inline style attributes for positioning.
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self' ws: wss:",
		"worker-src 'self' blob:",
		"manifest-src 'self'",
		"frame-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'",
	}
	return strings.Join(directives, "; ")
}

func serveNotBuilt(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = io.WriteString(w, `<!doctype html><meta charset="utf-8"><title>PVE Web</title>
<p style="font-family:system-ui;padding:2rem">前端尚未构建：先运行 <code>make web</code> 再构建服务端，或用 <code>WEB_DIR</code> 指向 web/dist。</p>`)
}
