package main

import (
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
)

type appHandler struct {
	http.Handler
	registry *instanceRegistry
}

func (h *appHandler) Close() error {
	h.registry.mu.Lock()
	defer h.registry.mu.Unlock()
	for _, entry := range h.registry.entries {
		entry.transport.CloseIdleConnections()
	}
	return nil
}

// Production always enters through the Tiller session gate. The low-level
// PVE handlers remain independently testable without weakening this boundary.
func newAppHandler(cfg *Config, web fs.FS, immutable bool, logger *slog.Logger) (http.Handler, error) {
	a, err := newLocalAuth(cfg, logger)
	if err != nil {
		return nil, err
	}
	cfg.Auth = a
	for _, c := range cfg.Instances {
		if c.EncryptedPassword != "" {
			if _, err := a.unseal(c.EncryptedPassword, "password:"+c.ID+":"+c.Version); err != nil {
				return nil, err
			}
		}
		if c.EncryptedToken != "" {
			if _, err := a.unseal(c.EncryptedToken, c.ID+":"+c.Version); err != nil {
				return nil, err
			}
		}
	}
	m := newInstanceRegistry(cfg, nil, logger)
	// Existing deployment variables seed the first connection, but never grant
	// access. The administrator supplies PVE credentials after initial setup.
	if _, err := os.Stat(cfg.InstancesFile); errors.Is(err, os.ErrNotExist) && cfg.ImportDefault {
		id, err := newInstanceID()
		if err != nil {
			return nil, err
		}
		version, err := newInstanceID()
		if err != nil {
			return nil, err
		}
		c := InstanceConfig{ID: id, Version: version, Name: cfg.InstanceName, URL: cfg.PVE.String(), InsecureTLS: cfg.InsecureTLS}
		if cfg.Fingerprint != nil {
			c.Fingerprint = FormatFingerprint(cfg.Fingerprint)
		}
		c, err = validateInstance(c)
		if err != nil {
			return nil, err
		}
		m.entries = append(m.entries, m.entry(c))
		if err := m.persist(m.entries); err != nil {
			return nil, err
		}
	}
	mux := http.NewServeMux()
	mux.Handle("/api/auth/", sameOrigin(cfg.TrustedProxies, logger, a))
	mux.Handle(instancesAPI, a.guard(http.HandlerFunc(m.Manage)))
	mux.Handle(instancesAPI+"/", a.guard(http.HandlerFunc(m.Manage)))
	mux.Handle("/api/instances/", a.guard(http.HandlerFunc(m.ServeInstance)))
	mux.Handle("/api2/", a.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writePVEError(w, 412, "请先选择 PVE 实例") })))
	mux.Handle("/api/", a.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { writePVEError(w, 404, "接口不存在") })))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok\n"))
	})
	mux.Handle("/docs/", http.StripPrefix("/docs/", newDocsHandler(web, immutable)))
	mux.Handle("/", newSPAHandler(web, immutable))
	return &appHandler{securityHeaders(allowFrom(cfg, logger, mux)), m}, nil
}
