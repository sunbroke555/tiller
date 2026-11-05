package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

type managedTest struct {
	cfg    *Config
	front  *httptest.Server
	client *http.Client
	csrf   string
}

func newManagedTest(t *testing.T, cfg *Config) *managedTest {
	t.Helper()
	if cfg == nil {
		dir := t.TempDir()
		cfg = &Config{PVE: mustURL(t, "https://unused.invalid:8006"), AuthFile: filepath.Join(dir, "auth.json"), InstancesFile: filepath.Join(dir, "instances.json")}
	}
	web := fstest.MapFS{"index.html": {Data: []byte("<html>Tiller</html>")}}
	h, err := newAppHandler(cfg, web, true, quietLogger())
	if err != nil {
		t.Fatal(err)
	}
	front := httptest.NewServer(h)
	t.Cleanup(front.Close)
	t.Cleanup(cfg.Auth.close)
	jar, _ := cookiejar.New(nil)
	return &managedTest{cfg: cfg, front: front, client: &http.Client{Jar: jar}}
}
func (a *managedTest) call(t *testing.T, method, path string, input any, status int) []byte {
	t.Helper()
	var body []byte
	if input != nil {
		body, _ = json.Marshal(input)
	}
	r, _ := http.NewRequest(method, a.front.URL+path, strings.NewReader(string(body)))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("CSRFPreventionToken", a.csrf)
	res, err := a.client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("%s %s: status=%d want=%d body=%s", method, path, res.StatusCode, status, data)
	}
	return data
}
func (a *managedTest) login(t *testing.T, setup bool, password string) {
	t.Helper()
	path := "/api/auth/login"
	if setup {
		path = "/api/auth/setup"
	}
	data := a.call(t, "POST", path, map[string]string{"username": "admin", "password": password}, 200)
	var out struct {
		Session adminSession `json:"session"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	a.csrf = out.Session.CSRF
}

const testAdminPassword = "unit-test-admin-password"

func TestLocalAdminLifecycle(t *testing.T) {
	a := newManagedTest(t, nil)
	if !strings.Contains(string(a.call(t, "GET", "/api/auth/session", nil, 200)), `"setupRequired":true`) {
		t.Fatal("missing initial setup")
	}
	for _, path := range []string{instancesAPI, "/api2/json/nodes", "/api/instances/aaaaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbbbb/api2/json/nodes"} {
		a.call(t, "GET", path, nil, 401)
	}
	a.call(t, "POST", "/api/auth/setup", map[string]string{"username": "admin", "password": "short"}, 400)
	a.login(t, true, testAdminPassword)
	a.call(t, "POST", "/api/auth/setup", map[string]string{"username": "attacker", "password": testAdminPassword}, 409)
	data, _ := os.ReadFile(a.cfg.AuthFile)
	if strings.Contains(string(data), testAdminPassword) {
		t.Fatal("stored plaintext password")
	}
	info, _ := os.Stat(a.cfg.AuthFile)
	if info.Mode().Perm() != 0600 {
		t.Fatal("wrong auth file mode")
	}
	cookies := a.client.Jar.Cookies(mustURL(t, a.front.URL))
	if len(cookies) != 1 || cookies[0].Name != adminCookie {
		t.Fatal("missing administrator session cookie")
	}
	saved := a.csrf
	a.csrf = "wrong"
	a.call(t, "POST", "/api/auth/logout", map[string]string{}, 403)
	a.csrf = saved
	a.call(t, "POST", "/api/auth/password", map[string]string{"currentPassword": "wrong", "password": "new-long-admin-password"}, 401)
	a.call(t, "POST", "/api/auth/password", map[string]string{"currentPassword": testAdminPassword, "password": "new-long-admin-password"}, 204)
	a.call(t, "GET", instancesAPI, nil, 401)
	a.call(t, "POST", "/api/auth/login", map[string]string{"username": "admin", "password": testAdminPassword}, 401)
	a.login(t, false, "new-long-admin-password")
	a.call(t, "POST", "/api/auth/logout", map[string]string{}, 204)
	a.call(t, "GET", instancesAPI, nil, 401)
	restarted := newManagedTest(t, a.cfg)
	restarted.login(t, false, "new-long-admin-password")
	restarted.call(t, "GET", instancesAPI, nil, 200)
}

func TestManagedInstancesCredentialsAndPersistence(t *testing.T) {
	backend := func(secret, name string) *httptest.Server {
		s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "PVEAPIToken=service@pve!tiller="+secret {
				http.Error(w, "bad token", 401)
				return
			}
			if r.Header.Get("Cookie") != "" || r.Header.Get("CSRFPreventionToken") != "" {
				t.Error("browser credentials reached PVE")
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"name": name, "path": r.URL.EscapedPath()}})
		}))
		t.Cleanup(s.Close)
		return s
	}
	one, two := backend("secret-one", "one"), backend("secret-two", "two")
	a := newManagedTest(t, nil)
	a.login(t, true, testAdminPassword)
	add := func(name, address, secret string) InstanceConfig {
		data := a.call(t, "POST", instancesAPI, map[string]any{"name": name, "url": address, "tokenId": "service@pve!tiller", "tokenSecret": secret}, 201)
		if strings.Contains(string(data), secret) || strings.Contains(string(data), "encryptedToken") {
			t.Fatal("secret exposed in response")
		}
		var c InstanceConfig
		_ = json.Unmarshal(data, &c)
		return c
	}
	c1, c2 := add("one", one.URL, "secret-one"), add("two", two.URL, "secret-two")
	path := func(c InstanceConfig) string {
		return "/api/instances/" + c.ID + "/" + c.Version + "/api2/json/pools/a%2Fb"
	}
	for _, c := range []InstanceConfig{c1, c2} {
		data := a.call(t, "GET", path(c), nil, 200)
		if !strings.Contains(string(data), `"name":"`+c.Name+`"`) || !strings.Contains(string(data), "a%2Fb") {
			t.Fatal("wrong upstream or escaped path")
		}
	}
	// An expired PVE token must not invalidate the independent Tiller session
	// or prevent other connections from working.
	bad := add("expired", one.URL, "expired-secret")
	a.call(t, "GET", path(bad), nil, 502)
	a.call(t, "GET", instancesAPI, nil, 200)
	a.call(t, "GET", path(c2), nil, 200)
	a.call(t, "DELETE", instancesAPI+"/"+bad.ID, nil, 204)
	file, _ := os.ReadFile(a.cfg.InstancesFile)
	if strings.Contains(string(file), "secret-one") || strings.Contains(string(file), "secret-two") {
		t.Fatal("plaintext credentials persisted")
	}
	entries, err := loadInstances(a.cfg.InstancesFile)
	if err != nil {
		t.Fatal(err)
	}
	a.cfg.Instances = entries
	restarted := newManagedTest(t, a.cfg)
	restarted.login(t, false, testAdminPassword)
	restarted.call(t, "GET", path(c2), nil, 200)
	input := map[string]any{"name": "renamed", "url": c1.URL, "tokenId": c1.TokenID, "version": c1.Version}
	data := a.call(t, "PUT", instancesAPI+"/"+c1.ID, input, 200)
	var renamed InstanceConfig
	_ = json.Unmarshal(data, &renamed)
	if renamed.Version != c1.Version {
		t.Fatal("renaming rotated connection")
	}
	input["url"] = two.URL
	a.call(t, "PUT", instancesAPI+"/"+c1.ID, input, 400)
	input["tokenSecret"] = "secret-two"
	data = a.call(t, "PUT", instancesAPI+"/"+c1.ID, input, 200)
	var changed InstanceConfig
	_ = json.Unmarshal(data, &changed)
	if changed.Version == c1.Version {
		t.Fatal("target change reused credential namespace")
	}
	a.call(t, "GET", path(c1), nil, 409)
	a.call(t, "GET", path(changed), nil, 200)
	a.call(t, "DELETE", instancesAPI+"/"+c2.ID, nil, 204)
	a.call(t, "GET", path(c2), nil, 409)
	// A stolen ciphertext cannot be transplanted into another connection.
	if _, err := a.cfg.Auth.unseal(entries[0].EncryptedToken, entries[1].ID+":"+entries[1].Version); err == nil {
		t.Fatal("unbound ciphertext")
	}
}

func TestAdminCrossOriginAndCorruption(t *testing.T) {
	a := newManagedTest(t, nil)
	r, _ := http.NewRequest("POST", a.front.URL+"/api/auth/setup", strings.NewReader(`{"username":"admin","password":"long-admin-password"}`))
	r.Header.Set("Origin", "https://evil.invalid")
	res, err := a.client.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal("cross-origin setup allowed")
	}
	a.login(t, true, testAdminPassword)
	if err := os.WriteFile(a.cfg.AuthFile, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newLocalAuth(a.cfg, quietLogger()); err == nil {
		t.Fatal("corrupt admin file reset setup")
	}
}

func TestManagedConsoleAndLogout(t *testing.T) {
	backend, seen := wsEchoBackend(t)
	a := newManagedTest(t, nil)
	a.login(t, true, testAdminPassword)
	data := a.call(t, "POST", instancesAPI, map[string]any{"name": "console", "url": backend.URL, "fingerprint": FormatFingerprint(fingerprintOf(backend.Certificate())), "tokenId": "service@pve!tiller", "tokenSecret": "test-secret"}, 201)
	var c InstanceConfig
	_ = json.Unmarshal(data, &c)
	host := mustURL(t, a.front.URL).Host
	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	path := "/api/instances/" + c.ID + "/" + c.Version + "/api2/json/nodes/pve/vncwebsocket?port=5900"
	upgrade := upgradeRequest(host, path)
	cookie := a.client.Jar.Cookies(mustURL(t, a.front.URL))[0]
	upgrade = strings.Replace(upgrade, "\r\n\r\n", "\r\nCookie: "+cookie.Name+"="+cookie.Value+"\r\n\r\n", 1)
	_, _ = io.WriteString(conn, upgrade)
	reader := bufio.NewReader(conn)
	res, err := http.ReadResponse(reader, nil)
	if err != nil || res.StatusCode != 101 {
		t.Fatalf("upgrade failed: %v %v", res, err)
	}
	_, _ = io.WriteString(conn, "echo")
	b := make([]byte, 4)
	if _, err = io.ReadFull(reader, b); err != nil || string(b) != "echo" {
		t.Fatal("console echo failed")
	}
	<-seen
	a.call(t, "POST", "/api/auth/logout", map[string]string{}, 204)
	if _, err = reader.ReadByte(); err == nil {
		t.Fatal("logout left console authenticated")
	}
}

func TestInstanceValidation(t *testing.T) {
	for _, raw := range []string{"file:///etc/passwd", "http://192.168.0.6:8006", "https://user:pass@pve:8006", "https://pve:8006/api2", "https://pve:8006/?key=x", "https://pve/#fragment"} {
		if _, err := validateInstance(InstanceConfig{Name: "test", URL: raw}); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	if _, err := validateInstance(InstanceConfig{Name: "test", URL: "https://pve", InsecureTLS: true, Fingerprint: strings.Repeat("aa", 32)}); err == nil {
		t.Error("accepted conflicting TLS settings")
	}
}

func TestInstanceFileRejectsCorruption(t *testing.T) {
	file := filepath.Join(t.TempDir(), "instances.json")
	if entries, err := loadInstances(file); err != nil || len(entries) != 0 {
		t.Fatalf("first start without a file: %v, %v", entries, err)
	}
	valid := InstanceConfig{ID: strings.Repeat("a", 24), Version: strings.Repeat("b", 24), Name: "lab", URL: "https://pve:8006"}
	encoded, _ := json.Marshal([]InstanceConfig{valid})
	duplicate, _ := json.Marshal([]InstanceConfig{valid, valid})
	for _, body := range []string{"", "[", `[{"id":"default"}]`, string(encoded) + "[]", string(duplicate), `[{"password":"must-not-be-stored"}]`} {
		if err := os.WriteFile(file, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadInstances(file); err == nil {
			t.Errorf("accepted corrupt instance file %q", body)
		}
	}
}
