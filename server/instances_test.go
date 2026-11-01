package main

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func instanceBackend(t *testing.T, name string) *httptest.Server {
	t.Helper()
	ticket := "PVE:root@pam:" + name + "::valid"
	b := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api2/json/access/ticket" || r.URL.Path == openIDLoginPath {
			_ = r.ParseForm()
			password := r.Form.Get("password")
			if password == renewPassword || (strings.HasPrefix(password, "PVE:") && password != ticket) {
				http.Error(w, "wrong renewal ticket", 401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"ticket": ticket, "username": "root@pam", "CSRFPreventionToken": name}})
			return
		}
		if cookieTicket(r) != ticket {
			http.Error(w, "not authenticated", 401)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]string{"instance": name, "cookie": r.Header.Get("Cookie"), "path": r.URL.EscapedPath()}})
	}))
	t.Cleanup(b.Close)
	return b
}

func instanceRequest(t *testing.T, client *http.Client, method, address, body string, status int) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, address, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(ticketModeHeader, ticketModeCookie)
	if strings.HasPrefix(body, "{") {
		req.Header.Set("Content-Type", "application/json")
	} else {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	data, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("%s %s: status %d, want %d: %s", method, address, res.StatusCode, status, data)
	}
	return res, data
}

func TestInstancesIsolationAndPersistence(t *testing.T) {
	primary := instanceBackend(t, "default")
	other := instanceBackend(t, "other")
	file := filepath.Join(t.TempDir(), "connections.json")
	cfg := &Config{PVE: mustURL(t, primary.URL), InstancesFile: file}
	front := newFront(t, cfg)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	input := `{"name":"Lab B","url":"` + other.URL + `","fingerprint":"","insecureTLS":false}`
	instanceRequest(t, client, "POST", front.URL+instancesAPI, input, 403)
	instanceRequest(t, client, "POST", front.URL+ticketPath, "username=root%40pam&password=test", 200)
	_, body := instanceRequest(t, client, "POST", front.URL+instancesAPI, input, 201)
	var added InstanceConfig
	if err := json.Unmarshal(body, &added); err != nil {
		t.Fatal(err)
	}
	prefix := "/api/instances/" + added.ID + "/" + added.Version
	// Default credentials cannot authenticate to the new PVE.
	instanceRequest(t, client, "GET", front.URL+prefix+"/api2/json/nodes", "", 401)
	res, body := instanceRequest(t, client, "POST", front.URL+prefix+ticketPath, "username=root%40pam&password=test", 200)
	if strings.Contains(string(body), "::valid") {
		t.Fatal("ticket leaked into JSON")
	}
	if len(res.Cookies()) != 1 || res.Cookies()[0].Path != prefix+"/" || !res.Cookies()[0].HttpOnly || res.Cookies()[0].Name == authCookieName {
		t.Fatalf("incorrect cookie scope: %+v", res.Cookies())
	}
	_, body = instanceRequest(t, client, "GET", front.URL+prefix+"/api2/json/pools/a%2Fb", "", 200)
	if !strings.Contains(string(body), `"instance":"other"`) || strings.Contains(string(body), "default") || !strings.Contains(string(body), "a%2Fb") {
		t.Fatalf("wrong target/cookie/path: %s", body)
	}
	instanceRequest(t, client, "POST", front.URL+prefix+ticketPath, "username=root%40pam&password="+url.QueryEscape(renewPassword), 200)
	// Logout touches only the selected instance; primary still works.
	instanceRequest(t, client, "POST", front.URL+prefix+"/api/logout", "", 204)
	instanceRequest(t, client, "GET", front.URL+prefix+"/api2/json/nodes", "", 401)
	instanceRequest(t, client, "GET", front.URL+"/api2/json/nodes", "", 200)
	entries, err := loadInstances(file)
	if err != nil || len(entries) != 1 || entries[0].ID != added.ID {
		t.Fatalf("persisted config: %+v, %v", entries, err)
	}
	info, _ := os.Stat(file)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("file permissions %v", info.Mode())
	}
	cfg.Instances = entries
	restarted := newFront(t, cfg)
	_, body = instanceRequest(t, client, "GET", restarted.URL+instancesAPI, "", 200)
	if !strings.Contains(string(body), "Lab B") {
		t.Fatalf("not loaded after restart: %s", body)
	}
	// Changing the target rotates the namespace, and old requests never reach it.
	added.URL = primary.URL
	edit, _ := json.Marshal(added)
	_, body = instanceRequest(t, client, "PUT", front.URL+instancesAPI+"/"+added.ID, string(edit), 200)
	var updated InstanceConfig
	_ = json.Unmarshal(body, &updated)
	if updated.Version == added.Version {
		t.Fatal("target change reused credential namespace")
	}
	instanceRequest(t, client, "GET", front.URL+prefix+"/api2/json/nodes", "", 409)
	instanceRequest(t, client, "PUT", front.URL+instancesAPI+"/"+added.ID, string(edit), 409)
	instanceRequest(t, client, "DELETE", front.URL+instancesAPI+"/default", "", 400)
	instanceRequest(t, client, "DELETE", front.URL+instancesAPI+"/"+added.ID, "", 204)
	entries, err = loadInstances(file)
	if err != nil || len(entries) != 0 {
		t.Fatalf("delete not persisted: %+v, %v", entries, err)
	}
}

func TestInstanceManagementAuthorizationAndFailedSave(t *testing.T) {
	primary := instanceBackend(t, "default")
	// A directory cannot be atomically replaced by the config file.
	cfg := &Config{PVE: mustURL(t, primary.URL), InstancesFile: t.TempDir()}
	front := newFront(t, cfg)
	input := `{"name":"new","url":"https://pve.example:8006"}`
	client := &http.Client{}
	for _, ticket := range []string{"PVE:root@pam:forged::valid", "PVE:root@pam:other::valid", "PVE:alice@pve:default::valid"} {
		jar, _ := cookiejar.New(nil)
		jar.SetCookies(mustURL(t, front.URL), []*http.Cookie{ticketCookie(ticket, false, false)})
		client.Jar = jar
		instanceRequest(t, client, "POST", front.URL+instancesAPI, input, 403)
	}
	instanceRequest(t, client, "POST", front.URL+ticketPath, "username=root%40pam&password=test", 200)
	req, _ := http.NewRequest("POST", front.URL+instancesAPI, strings.NewReader(input))
	req.Header.Set(ticketModeHeader, ticketModeCookie)
	req.Header.Set("Origin", "https://evil.example")
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("cross-origin mutation allowed: %d", res.StatusCode)
	}
	instanceRequest(t, client, "POST", front.URL+instancesAPI, input, 500)
	_, body := instanceRequest(t, client, "GET", front.URL+instancesAPI, "", 200)
	if strings.Contains(string(body), "pve.example") {
		t.Fatalf("failed save changed memory: %s", body)
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

func TestScopedInstanceWebsocket(t *testing.T) {
	backend, seen := wsEchoBackend(t)
	c := InstanceConfig{ID: strings.Repeat("a", 24), Version: strings.Repeat("b", 24), Name: "console", URL: backend.URL, Fingerprint: FormatFingerprint(fingerprintOf(backend.Certificate()))}
	front := newFront(t, &Config{PVE: mustURL(t, backend.URL), Instances: []InstanceConfig{c}})
	host := mustURL(t, front.URL).Host
	conn, err := net.Dial("tcp", host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	path := "/api/instances/" + c.ID + "/" + c.Version + "/api2/json/nodes/pve/vncwebsocket?port=5900"
	_, _ = io.WriteString(conn, upgradeRequest(host, path))
	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, nil)
	if err != nil || resp.StatusCode != 101 {
		t.Fatalf("upgrade: %+v, %v", resp, err)
	}
	_, _ = io.WriteString(conn, "echo")
	buf := make([]byte, 4)
	if _, err := io.ReadFull(reader, buf); err != nil || string(buf) != "echo" {
		t.Fatalf("scoped socket: %q, %v", buf, err)
	}
	if (<-seen).protocol != "binary" {
		t.Fatal("lost websocket subprotocol")
	}
}
