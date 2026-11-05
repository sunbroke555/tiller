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
)

const instancesAPI = "/api2/tiller/instances"

var instanceIDPattern = regexp.MustCompile(`^[a-f0-9]{24}$`)
var realmIDPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9._-]{0,63}$`)

// Each connection revision gets a separate URL namespace. Changing an address
// or its trust settings requires new credentials and invalidates old URLs.
type InstanceConfig struct {
	ID                string `json:"id"`
	Version           string `json:"version"`
	Name              string `json:"name"`
	URL               string `json:"url"`
	Fingerprint       string `json:"fingerprint"`
	InsecureTLS       bool   `json:"insecureTLS"`
	ReadOnly          bool   `json:"readOnly,omitempty"`
	TokenID           string `json:"tokenId,omitempty"`
	EncryptedToken    string `json:"encryptedToken,omitempty"`
	HasCredential     bool   `json:"hasCredential,omitempty"`
	AuthMode          string `json:"authMode,omitempty"`
	Username          string `json:"username,omitempty"`
	Realm             string `json:"realm,omitempty"`
	EncryptedPassword string `json:"encryptedPassword,omitempty"`
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
	in.HasCredential = false
	// Existing installations have tokenId/encryptedToken but no authMode.
	if in.AuthMode == "" {
		if in.TokenID != "" || in.EncryptedToken != "" {
			in.AuthMode = "token"
		} else {
			in.AuthMode = "password"
		}
	}
	switch in.AuthMode {
	case "password":
		in.Username, in.Realm = strings.TrimSpace(in.Username), strings.TrimSpace(in.Realm)
		if at := strings.LastIndex(in.Username, "@"); at >= 0 {
			in.Username, in.Realm = in.Username[:at], in.Username[at+1:]
		}
		if in.Realm == "" {
			in.Realm = "pam"
		}
		if !realmIDPattern.MatchString(in.Realm) || len(in.Username) > 128 || strings.ContainsAny(in.Username, ":@!/ \\?&=\t\r\n") {
			return in, errors.New("PVE 用户名或认证域格式不正确")
		}
		in.TokenID, in.EncryptedToken = "", ""
	case "token":
		in.Username, in.Realm, in.EncryptedPassword = "", "", ""
	default:
		return in, errors.New("请选择账号密码或 API Token 连接")
	}
	if in.TokenID != "" && (!strings.Contains(in.TokenID, "@") || !strings.Contains(in.TokenID, "!") || strings.ContainsAny(in.TokenID, " \t\r\n=")) {
		return in, errors.New("Token ID 格式应为 user@realm!token-name")
	}
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
	password  *passwordTransport
	hardware  *hardwareService
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

func (m *instanceRegistry) upstreamConfig(c InstanceConfig) *Config {
	cfg := *m.cfg
	cfg.PVE, _ = url.Parse(c.URL)
	// Per-instance certificate pins override the deployment CA trust roots.
	cfg.Fingerprint = nil
	if c.Fingerprint != "" {
		cfg.Fingerprint, _ = ParseFingerprint(c.Fingerprint)
	}
	cfg.InsecureTLS = c.InsecureTLS
	return &cfg
}

func (m *instanceRegistry) entry(c InstanceConfig) *instanceEntry {
	cfg := m.upstreamConfig(c)
	transport := NewUpstreamTransport(cfg)
	encrypted, aad := c.EncryptedToken, c.ID+":"+c.Version
	if c.AuthMode == "password" {
		encrypted, aad = c.EncryptedPassword, "password:"+aad
	}
	secret, err := m.cfg.Auth.unseal(encrypted, aad)
	if encrypted == "" {
		secret, err = "", nil
	}
	var upstream http.RoundTripper = &tokenTransport{base: transport, id: c.TokenID, secret: secret}
	var password *passwordTransport
	if c.AuthMode == "password" {
		password = newPasswordTransport(transport, c, secret)
		upstream = password
	}
	proxy := NewProxy(cfg.PVE, upstream, m.logger, cfg.TrustedProxies)
	mux := http.NewServeMux()
	mux.Handle("/api2/json/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err != nil || secret == "" {
			writePVEError(w, 412, "请先在实例管理中配置 PVE 账号密码或 API Token")
			return
		}
		if r.URL.Path == ticketPath || strings.HasPrefix(r.URL.Path, "/api2/json/access/openid/") {
			writePVEError(w, 403, "请使用 Tiller 管理员登录，PVE 凭据由实例连接维护")
			return
		}
		proxy.ServeHTTP(w, r)
	}))
	mux.Handle("GET /api/config", appConfigHandler(newConsentSource(cfg.PVE, upstream, m.logger)))
	hardware := newHardwareService(cfg, c, upstream, transport)
	mux.Handle("/api/hardware/", hardware)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) { writePVEError(w, 404, "不支持的实例接口") })
	return &instanceEntry{config: c, handler: mux, transport: transport, password: password, hardware: hardware}
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

type tokenTransport struct {
	base       http.RoundTripper
	id, secret string
}

func (t *tokenTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Del("Cookie")
	r.Header.Del("CSRFPreventionToken")
	r.Header.Set("Authorization", "PVEAPIToken="+t.id+"="+t.secret)
	res, err := t.base.RoundTrip(r)
	// Upstream auth failures belong to the connection, not the Tiller session.
	if res != nil && res.StatusCode == http.StatusUnauthorized {
		res.StatusCode = http.StatusBadGateway
		res.Status = "502 Bad Gateway"
	}
	return res, err
}

func publicInstance(c InstanceConfig) InstanceConfig {
	c.HasCredential = c.EncryptedToken != "" || c.EncryptedPassword != ""
	c.EncryptedToken, c.EncryptedPassword = "", ""
	return c
}

func (m *instanceRegistry) Manage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if adminFrom(r) == nil {
		writePVEError(w, 401, "请先登录 Tiller")
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == instancesAPI {
		list := []InstanceConfig{}
		m.mu.RLock()
		for _, e := range m.entries {
			list = append(list, publicInstance(e.config))
		}
		m.mu.RUnlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"instances": list, "canManage": true})
		return
	}
	id := strings.TrimPrefix(r.URL.Path, instancesAPI+"/")
	creating := r.Method == http.MethodPost && r.URL.Path == instancesAPI
	if !creating && (id == "default" || !instanceIDPattern.MatchString(id)) {
		writePVEError(w, http.StatusBadRequest, "实例标识无效")
		return
	}
	if !creating && r.Method != http.MethodPut && r.Method != http.MethodDelete {
		writePVEError(w, http.StatusMethodNotAllowed, "不支持的操作")
		return
	}
	var request struct {
		InstanceConfig
		TokenSecret string `json:"tokenSecret"`
		Password    string `json:"password"`
	}
	var input InstanceConfig
	if r.Method != http.MethodDelete {
		d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
		d.DisallowUnknownFields()
		if err := d.Decode(&request); err != nil {
			writePVEError(w, http.StatusBadRequest, "连接配置格式错误")
			return
		}
		if err := d.Decode(new(any)); err != io.EOF {
			writePVEError(w, http.StatusBadRequest, "连接配置包含多余内容")
			return
		}
		input = request.InstanceConfig
		if input.EncryptedToken != "" || input.EncryptedPassword != "" {
			writePVEError(w, 400, "不接受外部加密凭据")
			return
		}
		var err error
		input, err = validateInstance(input)
		if err != nil {
			writePVEError(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	// Validate newly supplied PVE passwords before saving, without holding the
	// registry lock: one unavailable PVE must not block other connections.
	var verified pveSession
	if r.Method != http.MethodDelete && input.AuthMode == "password" && request.Password != "" {
		if input.Username == "" || len(request.Password) > 4096 {
			writePVEError(w, 400, "请输入有效的 PVE 用户名和密码（密码最多 4096 字节）")
			return
		}
		transport := NewUpstreamTransport(m.upstreamConfig(input))
		defer transport.CloseIdleConnections()
		var err error
		verified, err = newPasswordTransport(transport, input, request.Password).ensure(r.Context())
		if err != nil {
			message := "无法连接 PVE，请检查地址与证书设置"
			var authErr *connectionAuthError
			if errors.As(err, &authErr) {
				message = authErr.message
			}
			writePVEError(w, 422, message)
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
		connectionChanged := creating || input.URL != entries[index].config.URL || input.Fingerprint != entries[index].config.Fingerprint || input.InsecureTLS != entries[index].config.InsecureTLS || input.AuthMode != entries[index].config.AuthMode || input.Username != entries[index].config.Username || input.Realm != entries[index].config.Realm || input.TokenID != entries[index].config.TokenID || request.TokenSecret != "" || request.Password != ""
		if connectionChanged {
			var err error
			input.Version, err = newInstanceID()
			if err != nil {
				writePVEError(w, 500, "无法生成连接版本")
				return
			}
		}
		if connectionChanged {
			secret, aad := request.TokenSecret, input.ID+":"+input.Version
			if input.AuthMode == "password" {
				secret, aad = request.Password, "password:"+aad
			}
			if secret == "" || len(secret) > 4096 || (input.AuthMode == "token" && (input.TokenID == "" || strings.TrimSpace(secret) == "" || strings.ContainsAny(secret, "\r\n"))) || (input.AuthMode == "password" && input.Username == "") {
				writePVEError(w, 400, "新增连接或修改地址、证书、认证方式、账户时，请重新填写完整凭据")
				return
			}
			var err error
			sealed, err := m.cfg.Auth.seal(secret, aad)
			if err != nil {
				writePVEError(w, 500, "无法加密实例凭据")
				return
			}
			if input.AuthMode == "password" {
				input.EncryptedPassword = sealed
			} else {
				input.EncryptedToken = sealed
			}
		} else {
			input.EncryptedToken = entries[index].config.EncryptedToken
			input.EncryptedPassword = entries[index].config.EncryptedPassword
		}
		if connectionChanged {
			changed = m.entry(input)
			if changed.password != nil {
				changed.password.session = verified
			}
		} else {
			copy := *entries[index]
			copy.config = input
			changed = &copy
		}
		if creating {
			entries = append(entries, changed)
		} else {
			entries[index] = changed
		}
	}
	if err := m.persist(entries); err != nil {
		if changed != nil && (index < 0 || changed.transport != m.entries[index].transport) {
			changed.transport.CloseIdleConnections()
		}
		m.logger.Error("save instances", "err", err)
		writePVEError(w, http.StatusInternalServerError, "无法保存实例配置，请检查配置文件的写入权限")
		return
	}
	if index >= 0 && (changed == nil || changed.transport != m.entries[index].transport) {
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
	_ = json.NewEncoder(w).Encode(publicInstance(input))
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
