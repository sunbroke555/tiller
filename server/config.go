package main

import (
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

// Config is the complete runtime configuration. It is read from environment
// variables only; the server keeps no state and stores no credentials.
type Config struct {
	// Listen is the address the HTTP server binds to (LISTEN, default ":8080").
	Listen string
	// PVE is the upstream Proxmox VE base URL (PVE_URL), scheme and host only.
	PVE *url.URL
	// Fingerprint, when set, pins the SHA-256 fingerprint of PVE's leaf
	// certificate (PVE_TLS_FINGERPRINT). Normal chain verification is skipped.
	Fingerprint []byte
	// InsecureTLS disables upstream certificate verification (PVE_INSECURE_TLS=1).
	InsecureTLS bool
	// RootCAs, when set, replaces the system roots for upstream verification
	// (PVE_CA_FILE, e.g. a copy of /etc/pve/pve-root-ca.pem).
	RootCAs *x509.CertPool
	// WebDir serves the SPA from disk instead of the embedded copy (WEB_DIR).
	WebDir string
	// TLSCert/TLSKey make the server itself listen with HTTPS
	// (TLS_CERT_FILE / TLS_KEY_FILE). Service workers and the PWA need HTTPS
	// on anything other than localhost.
	TLSCert string
	TLSKey  string
}

const defaultPVEURL = "https://127.0.0.1:8006"

// LoadConfig builds a Config from getenv (os.Getenv in production).
func LoadConfig(getenv func(string) string) (*Config, error) {
	cfg := &Config{
		Listen:  strings.TrimSpace(getenv("LISTEN")),
		WebDir:  strings.TrimSpace(getenv("WEB_DIR")),
		TLSCert: strings.TrimSpace(getenv("TLS_CERT_FILE")),
		TLSKey:  strings.TrimSpace(getenv("TLS_KEY_FILE")),
	}
	if cfg.Listen == "" {
		cfg.Listen = ":8080"
	}

	raw := strings.TrimSpace(getenv("PVE_URL"))
	if raw == "" {
		raw = defaultPVEURL
	}
	u, err := parsePVEURL(raw)
	if err != nil {
		return nil, err
	}
	cfg.PVE = u

	if fp := strings.TrimSpace(getenv("PVE_TLS_FINGERPRINT")); fp != "" {
		b, err := ParseFingerprint(fp)
		if err != nil {
			return nil, err
		}
		cfg.Fingerprint = b
	}
	cfg.InsecureTLS = isTruthy(getenv("PVE_INSECURE_TLS"))
	if cfg.InsecureTLS && cfg.Fingerprint != nil {
		return nil, errors.New("PVE_TLS_FINGERPRINT 和 PVE_INSECURE_TLS 只能二选一")
	}

	if caFile := strings.TrimSpace(getenv("PVE_CA_FILE")); caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("读取 PVE_CA_FILE: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("PVE_CA_FILE %s 中没有可用的 PEM 证书", caFile)
		}
		cfg.RootCAs = pool
	}

	if (cfg.TLSCert == "") != (cfg.TLSKey == "") {
		return nil, errors.New("TLS_CERT_FILE 和 TLS_KEY_FILE 需要同时设置")
	}
	return cfg, nil
}

func parsePVEURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("PVE_URL 无效: %w", err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, fmt.Errorf("PVE_URL 必须以 https:// 开头（当前 %q）", raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("PVE_URL 缺少主机名（当前 %q）", raw)
	}
	if u.Path != "" && u.Path != "/" {
		return nil, fmt.Errorf("PVE_URL 只填写协议、主机和端口，不要带路径（当前 %q）", raw)
	}
	return &url.URL{Scheme: u.Scheme, Host: u.Host}, nil
}

// ParseFingerprint accepts a SHA-256 fingerprint as 64 hex digits, optionally
// separated by colons (the format `pvenode cert info` and the PVE UI show).
func ParseFingerprint(s string) ([]byte, error) {
	clean := strings.NewReplacer(":", "", " ", "", "-", "").Replace(strings.TrimSpace(s))
	clean = strings.TrimPrefix(strings.ToLower(clean), "sha256")
	b, err := hex.DecodeString(clean)
	if err != nil || len(b) != 32 {
		return nil, fmt.Errorf("PVE_TLS_FINGERPRINT 需要是 SHA-256 指纹（64 位十六进制，可用冒号分隔），当前 %q", s)
	}
	return b, nil
}

func isTruthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
