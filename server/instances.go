package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const instancesAPI = "/api2/tiller/instances"

var instanceIDPattern = regexp.MustCompile(`^[a-f0-9]{24}$`)

// Each connection revision gets a separate URL and cookie namespace. Changing
// an address or its trust settings must never send an old ticket to a new PVE.
type InstanceConfig struct {
	ID          string `json:"id"`
	Version     string `json:"version"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Fingerprint string `json:"fingerprint"`
	InsecureTLS bool   `json:"insecureTLS"`
	ReadOnly    bool   `json:"readOnly,omitempty"`
}

func validateInstance(in InstanceConfig) (InstanceConfig, error) {
	in.Name, in.URL = strings.TrimSpace(in.Name), strings.TrimSpace(in.URL)
	if in.Name == "" || len([]rune(in.Name)) > 80 {
		return in, errors.New("实例名称需要为 1 到 80 个字符")
	}
	u, err := url.Parse(in.URL)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return in, errors.New("PVE 地址只填写协议、主机和端口，不要包含账号、路径或查询参数")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && isLoopbackHost(u.Hostname())) {
		return in, errors.New("PVE 地址需要使用 https://（本机回环地址除外）")
	}
	in.URL = (&url.URL{Scheme: u.Scheme, Host: u.Host}).String()
	in.Fingerprint = strings.TrimSpace(in.Fingerprint)
	if in.Fingerprint != "" {
		fp, err := ParseFingerprint(in.Fingerprint)
		if err != nil {
			return in, err
		}
		in.Fingerprint = FormatFingerprint(fp)
	}
	if in.InsecureTLS && in.Fingerprint != "" {
		return in, errors.New("固定证书指纹与跳过证书校验不能同时启用")
	}
	in.ReadOnly = false
	return in, nil
}

func loadInstances(path string) ([]InstanceConfig, error) {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取实例配置: %w", err)
	}
	defer f.Close()
	var entries []InstanceConfig
	d := json.NewDecoder(io.LimitReader(f, 1<<20))
	d.DisallowUnknownFields()
	if err := d.Decode(&entries); err != nil {
		return nil, fmt.Errorf("实例配置格式错误: %w", err)
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, errors.New("实例配置包含多余内容")
	}
	if len(entries) > 64 {
		return nil, errors.New("最多配置 64 个附加实例")
	}
	seen := map[string]bool{}
	for i, entry := range entries {
		if !instanceIDPattern.MatchString(entry.ID) || !instanceIDPattern.MatchString(entry.Version) || seen[entry.ID] {
			return nil, errors.New("实例配置中的 ID / version 无效或重复")
		}
		seen[entry.ID] = true
		entries[i], err = validateInstance(entry)
		if err != nil {
			return nil, fmt.Errorf("实例 %s: %w", entry.ID, err)
		}
	}
	return entries, nil
}

func newInstanceID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

type instanceScope struct{ cookieName, cookiePath string }
type instanceScopeKey struct{}

func scopeOf(r *http.Request) instanceScope {
	if s, ok := r.Context().Value(instanceScopeKey{}).(instanceScope); ok {
		return s
	}
	return instanceScope{authCookieName, authCookiePath}
}

func scopedTicketCookie(r *http.Request, ticket string, secure, clear bool) *http.Cookie {
	c := ticketCookie(ticket, secure, clear)
	s := scopeOf(r)
	c.Name, c.Path = s.cookieName, s.cookiePath
	return c
}

type instanceEntry struct {
	config    InstanceConfig
	handler   http.Handler
	transport *http.Transport
}

type instanceRegistry struct {
	mu        sync.RWMutex
	entries   []*instanceEntry
	cfg       *Config
	transport http.RoundTripper
	logger    *slog.Logger
}

func newInstanceRegistry(cfg *Config, transport http.RoundTripper, logger *slog.Logger) *instanceRegistry {
	m := &instanceRegistry{cfg: cfg, transport: transport, logger: logger}
	for _, c := range cfg.Instances {
		m.entries = append(m.entries, m.entry(c))
	}
	return m
}

func (m *instanceRegistry) entry(c InstanceConfig) *instanceEntry {
	cfg := *m.cfg
	cfg.PVE, _ = url.Parse(c.URL)
	// The deployment's private CA belongs to the default PVE. Added instances
	// use system roots or their own pinned certificate, never another PVE's CA.
	cfg.RootCAs = nil
	cfg.Fingerprint = nil
	if c.Fingerprint != "" {
		cfg.Fingerprint, _ = ParseFingerprint(c.Fingerprint)
	}
	cfg.InsecureTLS = c.InsecureTLS
	transport := NewUpstreamTransport(&cfg)
	mux := http.NewServeMux()
	mux.Handle("/api2/json/", newAuthGuard(NewProxy(cfg.PVE, transport, m.logger, cfg.TrustedProxies), &cfg, m.logger))
	mux.Handle("GET /api/config", appConfigHandler(newConsentSource(cfg.PVE, transport, m.logger)))
	mux.Handle("POST /api/logout", logoutHandler(cfg.TrustedProxies))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writePVEError(w, http.StatusNotFound, "不支持的实例接口")
	})
	return &instanceEntry{config: c, handler: mux, transport: transport}
}

func (m *instanceRegistry) ServeInstance(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/api/instances/"), "/", 3)
	if len(parts) != 3 || !instanceIDPattern.MatchString(parts[0]) || !instanceIDPattern.MatchString(parts[1]) {
		writePVEError(w, http.StatusNotFound, "实例不存在")
		return
	}
	m.mu.RLock()
	var entry *instanceEntry
	for _, e := range m.entries {
		if e.config.ID == parts[0] && e.config.Version == parts[1] {
			entry = e
			break
		}
	}
	m.mu.RUnlock()
	if entry == nil {
		writePVEError(w, http.StatusConflict, "实例已删除或连接配置已更改，请重新选择实例")
		return
	}
	prefix := "/api/instances/" + parts[0] + "/" + parts[1]
	scope := instanceScope{"tiller-pve-" + parts[0] + "-" + parts[1], prefix + "/"}
	r = r.Clone(context.WithValue(r.Context(), instanceScopeKey{}, scope))
	r.URL.Path = "/" + parts[2]
	// Preserve encoded API segments (e.g. nested pool names) after stripping.
	if r.URL.RawPath != "" {
		r.URL.RawPath = strings.TrimPrefix(r.URL.RawPath, prefix)
	}
	entry.handler.ServeHTTP(w, r)
}

// Only root on the deployment's immutable default PVE administers Tiller's
// shared connections. Parsing the name is insufficient: PVE must validate the
// ticket on every management request. Credentials of added PVEs never qualify.
func (m *instanceRegistry) canManage(r *http.Request) bool {
	ticket := cookieTicket(r)
	parts := strings.Split(ticket, ":")
	if len(parts) < 3 || parts[0] != "PVE" || parts[1] != "root@pam" {
		return false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.cfg.PVE.String()+"/api2/json/access/permissions", nil)
	if err != nil {
		return false
	}
	req.AddCookie(&http.Cookie{Name: authCookieName, Value: url.QueryEscape(ticket)})
	resp, err := m.transport.RoundTrip(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return resp.StatusCode == http.StatusOK
}

func (m *instanceRegistry) Manage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	canManage := false
	if r.Method != http.MethodGet || r.URL.Query().Get("manage") == "1" {
		canManage = m.canManage(r)
	}
	if r.Method == http.MethodGet && r.URL.Path == instancesAPI {
		name := m.cfg.InstanceName
		if name == "" {
			name = "默认 PVE"
		}
		list := []InstanceConfig{{ID: "default", Name: name, URL: m.cfg.PVE.String(), ReadOnly: true}}
		m.mu.RLock()
		for _, e := range m.entries {
			list = append(list, e.config)
		}
		m.mu.RUnlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"instances": list, "canManage": canManage})
		return
	}
	if !canManage {
		writePVEError(w, http.StatusForbidden, "请先使用默认 PVE 的 root@pam 登录，再管理实例连接")
		return
	}
	if r.Header.Get(ticketModeHeader) != ticketModeCookie {
		writePVEError(w, http.StatusBadRequest, "缺少实例管理请求头")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, instancesAPI+"/")
	creating := r.Method == http.MethodPost && r.URL.Path == instancesAPI
	if !creating && (id == "default" || !instanceIDPattern.MatchString(id)) {
		writePVEError(w, http.StatusBadRequest, "默认实例由部署配置管理")
		return
	}
	if !creating && r.Method != http.MethodPut && r.Method != http.MethodDelete {
		writePVEError(w, http.StatusMethodNotAllowed, "不支持的操作")
		return
	}
	var input InstanceConfig
	if r.Method != http.MethodDelete {
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
		d.DisallowUnknownFields()
		if err := d.Decode(&input); err != nil {
			writePVEError(w, http.StatusBadRequest, "连接配置格式错误")
			return
		}
		if err := d.Decode(new(any)); err != io.EOF {
			writePVEError(w, http.StatusBadRequest, "连接配置包含多余内容")
			return
		}
		var err error
		input, err = validateInstance(input)
		if err != nil {
			writePVEError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	index := -1
	for i, e := range m.entries {
		if e.config.ID == id {
			index = i
			break
		}
	}
	if !creating && index < 0 {
		writePVEError(w, http.StatusNotFound, "实例不存在")
		return
	}
	if creating && len(m.entries) >= 64 {
		writePVEError(w, http.StatusBadRequest, "最多配置 64 个附加实例")
		return
	}
	entries := append([]*instanceEntry(nil), m.entries...)
	var changed *instanceEntry
	if r.Method == http.MethodDelete {
		entries = append(entries[:index], entries[index+1:]...)
	} else {
		if creating {
			var err error
			id, err = newInstanceID()
			if err != nil {
				writePVEError(w, 500, "无法生成实例标识")
				return
			}
		} else if input.Version != entries[index].config.Version {
			writePVEError(w, http.StatusConflict, "实例已被修改，请刷新后重试")
			return
		}
		input.ID = id
		connectionChanged := creating || input.URL != entries[index].config.URL || input.Fingerprint != entries[index].config.Fingerprint || input.InsecureTLS != entries[index].config.InsecureTLS
		if connectionChanged {
			var err error
			input.Version, err = newInstanceID()
			if err != nil {
				writePVEError(w, 500, "无法生成连接版本")
				return
			}
		}
		changed = m.entry(input)
		if creating {
			entries = append(entries, changed)
		} else {
			entries[index] = changed
		}
	}
	if err := m.persist(entries); err != nil {
		if changed != nil {
			changed.transport.CloseIdleConnections()
		}
		m.logger.Error("save instances", "err", err)
		writePVEError(w, http.StatusInternalServerError, "无法保存实例配置，请检查配置文件的写入权限")
		return
	}
	if index >= 0 {
		m.entries[index].transport.CloseIdleConnections()
	}
	m.entries = entries
	m.logger.Info("instance connection changed", "method", r.Method, "instance", id)
	if r.Method == http.MethodDelete {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if creating {
		w.WriteHeader(http.StatusCreated)
	}
	_ = json.NewEncoder(w).Encode(input)
}

func (m *instanceRegistry) persist(entries []*instanceEntry) error {
	if m.cfg.InstancesFile == "" {
		return errors.New("未配置实例存储文件")
	}
	list := make([]InstanceConfig, 0, len(entries))
	for _, e := range entries {
		list = append(list, e.config)
	}
	dir := filepath.Dir(m.cfg.InstancesFile)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".tiller-instances-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	if err := enc.Encode(list); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), m.cfg.InstancesFile)
}
