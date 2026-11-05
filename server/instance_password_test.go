package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type passwordBackend struct {
	server                   *httptest.Server
	logins, renewals, writes atomic.Int32
	reject, tfa              atomic.Bool
	user, password           string
}

func newPasswordBackend(t *testing.T, user, password string) *passwordBackend {
	b := &passwordBackend{user: user, password: password}
	b.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == ticketPath {
			b.logins.Add(1)
			r.ParseForm()
			if r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
				t.Error("browser authentication leaked to login")
			}
			credential := r.Form.Get("password")
			if r.Form.Get("username") != user || (credential != password && !strings.HasPrefix(credential, "PVE:"+user+":")) {
				http.Error(w, "wrong", 401)
				return
			}
			if credential != password {
				b.renewals.Add(1)
			}
			ticket := fmt.Sprintf("PVE:%s:%d::signature", user, b.logins.Load())
			data := map[string]any{"username": user, "ticket": ticket, "CSRFPreventionToken": "csrf-" + user}
			if b.tfa.Load() {
				data["ticket"], data["NeedTFA"] = "PVE:!tfa!challenge", 1
			}
			json.NewEncoder(w).Encode(map[string]any{"data": data})
			return
		}
		if r.Method == "POST" {
			b.writes.Add(1)
		}
		cookie, err := r.Cookie(authCookieName)
		if err != nil {
			t.Error("missing server-side ticket")
			http.Error(w, "missing", 401)
			return
		}
		value, _ := url.QueryUnescape(cookie.Value)
		if !strings.HasPrefix(value, "PVE:"+user+":") || len(r.Cookies()) != 1 || r.Header.Get("Authorization") != "" {
			t.Error("instance authentication crossed connections")
		}
		if r.Method == "POST" && r.Header.Get("CSRFPreventionToken") != "csrf-"+user {
			t.Error("incorrect PVE write CSRF")
		}
		if b.reject.CompareAndSwap(true, false) {
			http.Error(w, "expired", 401)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"data": user})
	}))
	t.Cleanup(b.server.Close)
	return b
}

func TestPasswordTransportRenewalIsolationAndReplay(t *testing.T) {
	for _, user := range []string{"root@pam", "operator@pve"} {
		t.Run(user, func(t *testing.T) {
			b := newPasswordBackend(t, user, " secret with spaces ")
			parts := strings.Split(user, "@")
			tr := newPasswordTransport(http.DefaultTransport, InstanceConfig{URL: b.server.URL, Username: parts[0], Realm: parts[1]}, b.password)
			now := time.Now()
			tr.now = func() time.Time { return now }
			call := func(method string, want int) {
				t.Helper()
				r, _ := http.NewRequest(method, b.server.URL+"/api2/json/nodes", nil)
				r.Header.Set("Cookie", "TillerSession=private; other-instance=ticket")
				r.Header.Set("Authorization", "attacker")
				r.Header.Set("CSRFPreventionToken", "admin-csrf")
				res, err := tr.RoundTrip(r)
				if want == 502 {
					if err == nil {
						t.Error("expired write was replayed")
						res.Body.Close()
					}
					return
				}
				if err != nil {
					t.Error(err)
					return
				}
				defer res.Body.Close()
				if res.StatusCode != want {
					t.Errorf("HTTP %d", res.StatusCode)
				}
			}
			var wg sync.WaitGroup
			for range 12 {
				wg.Add(1)
				go func() { defer wg.Done(); call("GET", 200) }()
			}
			wg.Wait()
			if b.logins.Load() != 1 {
				t.Fatal("concurrent reads caused duplicate logins")
			}
			now = now.Add(61 * time.Minute)
			call("POST", 200)
			if b.logins.Load() != 2 || b.renewals.Load() != 1 {
				t.Fatal("ticket was not renewed")
			}
			now = now.Add(3 * time.Hour)
			call("GET", 200)
			if b.logins.Load() != 3 || b.renewals.Load() != 1 {
				t.Fatal("expired ticket did not use saved password")
			}
			b.reject.Store(true)
			call("GET", 200)
			if b.logins.Load() != 4 {
				t.Fatal("read did not recover from upstream 401")
			}
			b.reject.Store(true)
			call("POST", 502)
			if b.logins.Load() != 4 || b.writes.Load() != 2 {
				t.Fatal("write was automatically retried")
			}
			call("GET", 200)
			if b.logins.Load() != 5 {
				t.Fatal("next request did not reauthenticate")
			}
		})
	}
}

func TestPasswordConnectionFailuresAreThrottled(t *testing.T) {
	b := newPasswordBackend(t, "root@pam", "correct")
	tr := newPasswordTransport(http.DefaultTransport, InstanceConfig{URL: b.server.URL, Username: "root", Realm: "pam"}, "wrong")
	now := time.Now()
	tr.now = func() time.Time { return now }
	for range 10 {
		if _, err := tr.ensure(context.Background()); err == nil {
			t.Fatal("accepted bad password")
		}
	}
	if b.logins.Load() != 1 {
		t.Fatal("aggregation repeatedly submitted bad credentials")
	}
	now = now.Add(31 * time.Second)
	tr.ensure(context.Background())
	if b.logins.Load() != 2 {
		t.Fatal("connection did not retry after delay")
	}
}

func TestManagedPasswordConnections(t *testing.T) {
	b := newPasswordBackend(t, "root@pam", " pve-only secret ")
	a := newManagedTest(t, nil)
	a.login(t, true, testAdminPassword)
	input := map[string]any{"name": "password instance", "url": b.server.URL, "authMode": "password", "username": "root@pam", "realm": "pve", "password": "wrong"}
	a.call(t, "POST", instancesAPI, input, 422)
	input["password"] = b.password
	b.tfa.Store(true)
	if data := a.call(t, "POST", instancesAPI, input, 422); !strings.Contains(string(data), "两步验证") {
		t.Fatal("incomplete TFA accepted")
	}
	b.tfa.Store(false)
	data := a.call(t, "POST", instancesAPI, input, 201)
	var c InstanceConfig
	json.Unmarshal(data, &c)
	if c.AuthMode != "password" || c.Username != "root" || c.Realm != "pam" || !c.HasCredential || c.EncryptedPassword != "" || strings.Contains(string(data), b.password) {
		t.Fatal("invalid public password connection")
	}
	api := "/api/instances/" + c.ID + "/" + c.Version + "/api2/json/nodes"
	a.call(t, "GET", api, nil, 200)
	a.call(t, "POST", api, map[string]string{"action": "read-only mock"}, 200)
	raw, _ := os.ReadFile(a.cfg.InstancesFile)
	if strings.Contains(string(raw), b.password) || strings.Contains(string(raw), "PVE:root") {
		t.Fatal("password or ticket persisted in plaintext")
	}
	entries, err := loadInstances(a.cfg.InstancesFile)
	if err != nil {
		t.Fatal(err)
	}
	a.cfg.Instances = entries
	restarted := newManagedTest(t, a.cfg)
	restarted.login(t, false, testAdminPassword)
	restarted.call(t, "GET", api, nil, 200)
	delete(input, "password")
	input["version"], input["name"] = c.Version, "renamed"
	data = a.call(t, "PUT", instancesAPI+"/"+c.ID, input, 200)
	var renamed InstanceConfig
	json.Unmarshal(data, &renamed)
	if renamed.Version != c.Version {
		t.Fatal("rename changed connection version")
	}
	a.call(t, "GET", api, nil, 200)
	input["username"] = "different"
	a.call(t, "PUT", instancesAPI+"/"+c.ID, input, 400)
	// Mode changes require credentials and invalidate the old URL.
	input["authMode"], input["tokenId"] = "token", "service@pve!token"
	a.call(t, "PUT", instancesAPI+"/"+c.ID, input, 400)
	input["tokenSecret"] = "new-token"
	data = a.call(t, "PUT", instancesAPI+"/"+c.ID, input, 200)
	var changed InstanceConfig
	json.Unmarshal(data, &changed)
	if changed.Version == c.Version || changed.Username != "" || changed.AuthMode != "token" {
		t.Fatal("mode switch did not isolate identity")
	}
	a.call(t, "GET", api, nil, 409)
	entries, _ = loadInstances(a.cfg.InstancesFile)
	if entries[0].EncryptedPassword != "" {
		t.Fatal("old password retained after token switch")
	}
}

func TestPasswordTransportDoesNotExposeCredentialsOnRedirect(t *testing.T) {
	var received atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { received.Store(true); io.Copy(io.Discard, r.Body) }))
	defer target.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer upstream.Close()
	tr := newPasswordTransport(http.DefaultTransport, InstanceConfig{URL: upstream.URL, Username: "root", Realm: "pam"}, "secret")
	if _, err := tr.ensure(context.Background()); err == nil || received.Load() {
		t.Fatal("followed login redirect")
	}
}

// Opt-in read-only verification on the test server. Simulated cache age tests
// renewal and password fallback against PVE without waiting several hours.
func TestPasswordTransportLabRenewal(t *testing.T) {
	if os.Getenv("TILLER_TEST_LAB_AUTH") != "1" {
		t.Skip("requires explicit lab authentication test")
	}
	u, err := url.Parse(os.Getenv("PVE_LAB_URL"))
	if err != nil || u.Scheme != "https" || u.Hostname() != "192.168.0.246" {
		t.Fatal("refusing non-lab target")
	}
	fingerprint, err := ParseFingerprint(os.Getenv("PVE_LAB_FINGERPRINT"))
	if err != nil {
		t.Fatal("invalid lab fingerprint")
	}
	user := strings.Split(os.Getenv("PVE_LAB_USER"), "@")
	password := os.Getenv("PVE_LAB_PASSWORD")
	if len(user) != 2 || password == "" {
		t.Fatal("missing lab credentials")
	}
	base := NewUpstreamTransport(&Config{PVE: u, Fingerprint: fingerprint})
	defer base.CloseIdleConnections()
	tr := newPasswordTransport(base, InstanceConfig{URL: u.String(), Username: user[0], Realm: user[1]}, password)
	now := time.Now()
	tr.now = func() time.Time { return now }
	for _, elapsed := range []time.Duration{0, 61 * time.Minute, 3 * time.Hour} {
		now = now.Add(elapsed)
		r, _ := http.NewRequest("GET", u.String()+"/api2/json/nodes", nil)
		res, err := tr.RoundTrip(r)
		if err != nil {
			t.Fatal("lab authentication/renewal failed")
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 200 || !tr.session.issued.Equal(now) {
			t.Fatal("lab renewal did not produce a working session")
		}
	}
}
