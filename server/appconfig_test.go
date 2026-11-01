package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const pveIndexTemplate = `<script type="text/javascript">
    Proxmox = {
        Setup: { auth_cookie_name: 'PVEAuthCookie' },
        defaultLang: 'en',
        NodeName: 'pve-lab',
        UserName: '',
        CSRFPreventionToken: 'null',
        ConsentText: '%s'
    };
    </script>`

func indexWith(consent string) string {
	return strings.Replace(pveIndexTemplate, "%s", consent, 1)
}

func TestExtractConsentText(t *testing.T) {
	text := "# 授权使用\n\n仅限**授权人员**访问。"
	b64 := base64.StdEncoding.EncodeToString([]byte(text))
	cases := []struct {
		name, page, want string
	}{
		{"empty", indexWith(""), ""},
		{"base64 utf-8", indexWith(b64), text},
		{"wrapped base64", indexWith(b64[:10] + "\n" + b64[10:]), text},
		{"plain text fallback", indexWith("not base64!"), "not base64!"},
		{"missing", "<html></html>", ""},
	}
	for _, c := range cases {
		if got := ExtractConsentText(c.page); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestAppConfigServesAndCachesConsent(t *testing.T) {
	var hits atomic.Int32
	consent := base64.StdEncoding.EncodeToString([]byte("请勿滥用"))
	backend := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		hits.Add(1)
		if r.Header.Get("Cookie") != "" {
			t.Errorf("consent fetch must not forward cookies, got %q", r.Header.Get("Cookie"))
		}
		_, _ = io.WriteString(w, indexWith(consent))
	}))
	t.Cleanup(backend.Close)
	cfg := &Config{PVE: mustURL(t, backend.URL), Fingerprint: fingerprintOf(backend.Certificate())}
	front := newFront(t, cfg)

	for i := 0; i < 2; i++ {
		req, _ := http.NewRequest(http.MethodGet, front.URL+"/api/config", nil)
		req.Header.Set("Cookie", "PVEAuthCookie=secret")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var body struct {
			ConsentText string `json:"consentText"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK || body.ConsentText != "请勿滥用" {
			t.Fatalf("status %d, consent %q", resp.StatusCode, body.ConsentText)
		}
		if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
			t.Errorf("Cache-Control = %q", cc)
		}
	}
	if n := hits.Load(); n != 1 {
		t.Errorf("PVE index fetched %d times, want 1 (cached)", n)
	}
}

func TestAppConfigWhenPVEIsDown(t *testing.T) {
	cfg := &Config{PVE: mustURL(t, "https://127.0.0.1:1"), InsecureTLS: true}
	front := newFront(t, cfg)
	resp, err := http.Get(front.URL + "/api/config")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK || body["consentText"] != "" {
		t.Fatalf("status %d, body %v", resp.StatusCode, body)
	}
}
