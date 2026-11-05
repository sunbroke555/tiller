package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const adminCookie = "TillerSession"
const adminSessionLifetime = 8 * time.Hour
const passwordIterations = 600_000

type adminAccount struct {
	Username   string `json:"username"`
	Salt       []byte `json:"salt"`
	Hash       []byte `json:"hash"`
	Iterations int    `json:"iterations"`
}

type adminSession struct {
	Username  string `json:"username"`
	CSRF      string `json:"csrfToken"`
	ExpiresAt int64  `json:"expiresAt"`
	IssuedAt  int64  `json:"ticketIssuedAt"`
	ctx       context.Context
	cancel    context.CancelFunc
}
type adminContextKey struct{}

type localAuth struct {
	mu       sync.Mutex
	file     string
	account  *adminAccount
	key      []byte
	sessions map[string]*adminSession
	limiter  *loginLimiter
	cfg      *Config
	logger   *slog.Logger
}

func newLocalAuth(cfg *Config, logger *slog.Logger) (*localAuth, error) {
	a := &localAuth{file: cfg.AuthFile, sessions: map[string]*adminSession{}, limiter: newLoginLimiter(), cfg: cfg, logger: logger}
	data, err := os.ReadFile(a.file)
	if err == nil {
		var account adminAccount
		if json.Unmarshal(data, &account) != nil || account.Username == "" || len(account.Salt) != 16 || len(account.Hash) != 32 || account.Iterations != passwordIterations {
			return nil, errors.New("管理员配置损坏，拒绝重置为首次设置状态")
		}
		a.account = &account
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	keyFile := a.file + ".key"
	a.key, err = os.ReadFile(keyFile)
	if errors.Is(err, os.ErrNotExist) && a.account == nil {
		a.key = make([]byte, 32)
		if _, err = rand.Read(a.key); err != nil {
			return nil, err
		}
		if err = writePrivateFile(keyFile, a.key, true); errors.Is(err, os.ErrExist) {
			a.key, err = os.ReadFile(keyFile)
		}
	}
	if err != nil || len(a.key) != 32 {
		return nil, errors.New("无法读取实例凭据密钥，请恢复管理员配置对应的 .key 文件")
	}
	return a, nil
}

// The key is separate from the connection JSON. Bind ciphertext to its
// instance and revision so moving it between connections fails closed.
func (a *localAuth) seal(secret, scope string) (string, error) {
	b, err := aes.NewCipher(a.key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(b)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(secret), []byte(scope))), nil
}

func (a *localAuth) unseal(secret, scope string) (string, error) {
	data, err := base64.RawStdEncoding.DecodeString(secret)
	if err != nil {
		return "", errors.New("实例凭据损坏")
	}
	b, _ := aes.NewCipher(a.key)
	gcm, _ := cipher.NewGCM(b)
	if len(data) < gcm.NonceSize() {
		return "", errors.New("实例凭据损坏")
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], []byte(scope))
	if err != nil {
		return "", errors.New("无法解密实例凭据，请检查密钥文件")
	}
	return string(plain), nil
}

func writePrivateFile(path string, data []byte, exclusive bool) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".tiller-private-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if _, err = f.Write(data); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if exclusive {
		return os.Link(f.Name(), path)
	}
	return os.Rename(f.Name(), path)
}

func passwordHash(password string, salt []byte) []byte {
	key, _ := pbkdf2.Key(sha256.New, password, salt, passwordIterations, 32)
	return key
}

func validAdminPassword(password string) bool {
	return len([]rune(password)) >= 12 && len(password) <= 1024
}

var adminNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{2,39}$`)

func (a *localAuth) session(r *http.Request) *adminSession {
	c, err := r.Cookie(adminCookie)
	if err != nil {
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	s := a.sessions[c.Value]
	if s != nil && (time.Now().UnixMilli() >= s.ExpiresAt || s.ctx.Err() != nil) {
		s.cancel()
		delete(a.sessions, c.Value)
		return nil
	}
	return s
}

func adminFrom(r *http.Request) *adminSession {
	s, _ := r.Context().Value(adminContextKey{}).(*adminSession)
	return s
}

func (a *localAuth) guard(next http.Handler) http.Handler {
	return sameOrigin(a.cfg.TrustedProxies, a.logger, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s := a.session(r)
		if s == nil {
			writePVEError(w, 401, "请先登录 Tiller")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && subtle.ConstantTimeCompare([]byte(r.Header.Get("CSRFPreventionToken")), []byte(s.CSRF)) != 1 {
			writePVEError(w, 403, "请求验证失败，请刷新页面后重试")
			return
		}
		// Logout/password changes also terminate active consoles and requests.
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		stop := context.AfterFunc(s.ctx, cancel)
		defer stop()
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, adminContextKey{}, s)))
	}))
}

func (a *localAuth) issue(w http.ResponseWriter, r *http.Request) (*adminSession, error) {
	token, err := randomSecret()
	if err != nil {
		return nil, err
	}
	csrf, err := randomSecret()
	if err != nil {
		return nil, err
	}
	now := time.Now()
	ctx, cancel := context.WithDeadline(context.Background(), now.Add(adminSessionLifetime))
	s := &adminSession{Username: a.account.Username, CSRF: csrf, ExpiresAt: now.Add(adminSessionLifetime).UnixMilli(), IssuedAt: now.UnixMilli(), ctx: ctx, cancel: cancel}
	for k, old := range a.sessions {
		if old.ctx.Err() != nil {
			delete(a.sessions, k)
		}
	}
	if len(a.sessions) >= 64 {
		for k, old := range a.sessions {
			old.cancel()
			delete(a.sessions, k)
			break
		}
	}
	a.sessions[token] = s
	http.SetCookie(w, &http.Cookie{Name: adminCookie, Value: token, Path: "/", HttpOnly: true, Secure: isHTTPS(r, a.cfg.TrustedProxies), SameSite: http.SameSiteStrictMode})
	return s, nil
}

func randomSecret() (string, error) {
	b := make([]byte, 32)
	_, err := rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b), err
}

func decodeSmallJSON(w http.ResponseWriter, r *http.Request, out any) error {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("多余内容")
	}
	return nil
}

func (a *localAuth) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Method == "GET" && r.URL.Path == "/api/auth/session" {
		s := a.session(r)
		a.mu.Lock()
		setup := a.account == nil
		a.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"setupRequired": setup, "session": s})
		return
	}
	if r.Method != "POST" {
		writePVEError(w, 405, "不支持的操作")
		return
	}
	path := r.URL.Path
	if path == "/api/auth/logout" {
		a.guard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a.mu.Lock()
			defer a.mu.Unlock()
			c, _ := r.Cookie(adminCookie)
			if s := a.sessions[c.Value]; s != nil {
				s.cancel()
				delete(a.sessions, c.Value)
			}
			http.SetCookie(w, &http.Cookie{Name: adminCookie, Path: "/", MaxAge: -1, HttpOnly: true, Secure: isHTTPS(r, a.cfg.TrustedProxies), SameSite: http.SameSiteStrictMode})
			w.WriteHeader(204)
		})).ServeHTTP(w, r)
		return
	}
	if path != "/api/auth/setup" && path != "/api/auth/login" && path != "/api/auth/password" {
		writePVEError(w, 404, "接口不存在")
		return
	}
	if path == "/api/auth/password" && adminFrom(r) == nil {
		a.guard(http.HandlerFunc(a.ServeHTTP)).ServeHTTP(w, r)
		return
	}
	var input struct {
		Username        string `json:"username"`
		Password        string `json:"password"`
		CurrentPassword string `json:"currentPassword"`
	}
	if decodeSmallJSON(w, r, &input) != nil {
		writePVEError(w, 400, "输入格式错误")
		return
	}
	ip := ipString(clientIP(r, a.cfg.TrustedProxies))
	if wait := a.limiter.wait("ip:"+ip, "admin"); wait > 0 {
		writePVEError(w, 429, "尝试次数过多，请稍后重试")
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if path == "/api/auth/setup" && a.account != nil {
		writePVEError(w, 409, "管理员已设置，请直接登录")
		return
	}
	if path != "/api/auth/setup" && a.account == nil {
		writePVEError(w, 409, "请先设置管理员账户")
		return
	}
	if path != "/api/auth/setup" {
		password := input.Password
		if path == "/api/auth/password" {
			password = input.CurrentPassword
		}
		valid := subtle.ConstantTimeCompare(passwordHash(password, a.account.Salt), a.account.Hash) == 1
		if !valid || (path == "/api/auth/login" && input.Username != a.account.Username) {
			a.limiter.fail("ip:"+ip, ipLoginPolicy)
			a.limiter.fail("admin", userLoginPolicy)
			a.logger.Warn("Tiller login rejected", "client", ip)
			writePVEError(w, 401, "用户名或密码不正确")
			return
		}
	}
	if path != "/api/auth/login" {
		if !validAdminPassword(input.Password) {
			writePVEError(w, 400, "密码至少需要 12 个字符，最多 1024 字节")
			return
		}
		name := strings.TrimSpace(input.Username)
		if path == "/api/auth/password" {
			name = a.account.Username
		}
		if !adminNamePattern.MatchString(name) {
			writePVEError(w, 400, "用户名需为 3 到 40 位字母、数字、下划线、点或短横线")
			return
		}
		salt := make([]byte, 16)
		if _, err := rand.Read(salt); err != nil {
			writePVEError(w, 500, "无法创建账户")
			return
		}
		account := &adminAccount{Username: name, Salt: salt, Hash: passwordHash(input.Password, salt), Iterations: passwordIterations}
		data, _ := json.Marshal(account)
		if err := writePrivateFile(a.file, data, path == "/api/auth/setup"); err != nil {
			writePVEError(w, 500, "无法保存管理员配置，请检查数据目录权限")
			return
		}
		a.account = account
		if path == "/api/auth/password" {
			for k, s := range a.sessions {
				s.cancel()
				delete(a.sessions, k)
			}
			w.WriteHeader(204)
			return
		}
	}
	a.limiter.reset("ip:"+ip, "admin")
	s, err := a.issue(w, r)
	if err != nil {
		writePVEError(w, 500, "无法创建会话")
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"setupRequired": false, "session": s})
}

func (a *localAuth) close() {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, s := range a.sessions {
		s.cancel()
	}
}
