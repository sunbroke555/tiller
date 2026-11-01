// Command tiller serves the Tiller single page app and reverse-proxies the
// Proxmox VE API to the selected instance. It stores connection metadata only,
// and forwards each instance's browser ticket and CSRF header independently.
package main

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(logger); err != nil {
		logger.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := LoadConfig(os.Getenv)
	if err != nil {
		return err
	}

	web, immutable := selectWebFS(cfg, logger)
	transport := NewUpstreamTransport(cfg)
	handler := NewHandler(cfg, web, immutable, transport, logger)

	srv := &http.Server{
		Addr:    cfg.Listen,
		Handler: handler,
		// No ReadTimeout/WriteTimeout: they would cut websockets (VNC, shell),
		// ISO uploads and backup downloads. Only slow headers are bounded.
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    64 << 10,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go CheckUpstream(ctx, cfg, transport, logger)

	if cfg.PlainHTTPExposed() {
		logger.Warn("SERVING PLAIN HTTP ON A NETWORK ADDRESS: PVE passwords, two-factor codes and tickets cross the network unencrypted. "+
			"Set TLS_CERT_FILE/TLS_KEY_FILE, put a TLS reverse proxy in front, or listen on 127.0.0.1 only.",
			"listen", cfg.Listen)
	}

	errc := make(chan error, 1)
	go func() {
		logger.Info("listening", "addr", cfg.Listen, "pve", cfg.PVE.String(),
			"tls", cfg.TLSCert != "", "fingerprint", cfg.Fingerprint != nil, "insecure", cfg.InsecureTLS)
		if cfg.TLSCert != "" {
			errc <- srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			errc <- srv.ListenAndServe()
		}
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return nil
}

// selectWebFS picks where the SPA comes from: WEB_DIR, the embedded build,
// or (dev builds) ../web/dist. immutable reports whether files may be cached.
func selectWebFS(cfg *Config, logger *slog.Logger) (fs.FS, bool) {
	dir := cfg.WebDir
	if dir == "" {
		if web := embeddedWeb(); web != nil {
			logger.Info("serving embedded frontend")
			return web, true
		}
		dir = defaultWebDir
	}
	if dir == "" {
		logger.Warn("no frontend embedded; build with `make server` or set WEB_DIR")
		return emptyFS{}, true
	}
	logger.Info("serving frontend from disk", "dir", dir)
	return os.DirFS(dir), false
}

type emptyFS struct{}

func (emptyFS) Open(string) (fs.File, error) { return nil, fs.ErrNotExist }

// NewHandler assembles the complete HTTP handler.
func NewHandler(cfg *Config, web fs.FS, immutable bool, transport http.RoundTripper, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	instances := newInstanceRegistry(cfg, transport, logger)
	manageInstances := sameOrigin(cfg.TrustedProxies, logger, http.HandlerFunc(instances.Manage))
	mux.Handle(instancesAPI, manageInstances)
	mux.Handle(instancesAPI+"/", manageInstances)
	mux.Handle("/api/instances/", sameOrigin(cfg.TrustedProxies, logger, http.HandlerFunc(instances.ServeInstance)))
	// Only the JSON API (websockets included). PVE's other formatters
	// (/api2/html with its own login form, /api2/extjs, /api2/png,
	// /api2/spiceconfig) are not used by the SPA and stay off this origin.
	// sameOrigin runs before the proxy rewrites Origin to PVE's own.
	mux.Handle("/api2/json/", sameOrigin(cfg.TrustedProxies, logger,
		newAuthGuard(NewProxy(cfg.PVE, transport, logger, cfg.TrustedProxies), cfg, logger)))
	mux.HandleFunc("/api2/", func(w http.ResponseWriter, _ *http.Request) {
		writePVEError(w, http.StatusNotFound, "Tiller 只转发 /api2/json/")
	})
	mux.Handle("POST /api/logout", sameOrigin(cfg.TrustedProxies, logger, logoutHandler(cfg.TrustedProxies)))
	mux.Handle("GET /api/config", appConfigHandler(newConsentSource(cfg.PVE, transport, logger)))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("/docs/", http.StripPrefix("/docs/", newDocsHandler(web, immutable)))
	mux.Handle("/", newSPAHandler(web, immutable))
	return securityHeaders(allowFrom(cfg, logger, mux))
}

// securityHeaderNames lists the headers securityHeaders owns.
var securityHeaderNames = []string{
	"X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy",
	"Cross-Origin-Opener-Policy", "Permissions-Policy", "Strict-Transport-Security",
}

// securityHeaders adds headers that apply to every response. The CSP is set
// per document by the static handlers because it depends on inline scripts.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		if r.TLS != nil {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}
