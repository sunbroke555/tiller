package main

import (
	"net/http"
	"strings"
	"testing"
	"testing/fstest"
)

func TestDocumentationRoutes(t *testing.T) {
	const doc = `<html><script>window.docs=true</script><h1>Guide</h1></html>`
	web := testWebFS()
	for _, name := range []string{"docs/index.html", "docs/guide/install.html"} {
		web[name] = &fstest.MapFile{Data: []byte(doc)}
	}
	web["docs/assets/app-abc.js"] = &fstest.MapFile{Data: []byte("export default 1")}
	web["docs/hashmap.json"] = &fstest.MapFile{Data: []byte(`{}`)}
	mux := http.NewServeMux()
	mux.Handle("/docs/", http.StripPrefix("/docs/", newDocsHandler(web, true)))
	mux.Handle("/", newSPAHandler(web, true))

	if rec := serve(t, mux, "GET", "/docs", nil); (rec.Code != http.StatusMovedPermanently && rec.Code != http.StatusTemporaryRedirect) || rec.Header().Get("Location") != "/docs/" {
		t.Fatalf("docs redirect: %d %v", rec.Code, rec.Header())
	}
	for _, url := range []string{"/docs/", "/docs/index.html", "/docs/guide/install", "/docs/guide/install.html", "/docs/guide/install/"} {
		rec := serve(t, mux, "GET", url, nil)
		if rec.Code != 200 || rec.Body.String() != doc {
			t.Errorf("%s: got %d %q", url, rec.Code, rec.Body.String())
		}
		if rec.Header().Get("Content-Security-Policy") != buildCSP([]byte(doc)) {
			t.Errorf("%s: missing document-specific CSP", url)
		}
		if rec.Header().Get("Cache-Control") != "no-cache" {
			t.Errorf("%s: document must revalidate", url)
		}
	}
	for _, url := range []string{"/docs/missing", "/docs/assets/missing.js", "/docs/guide/missing.html", "/docs/api2/json", "/docs/README.md"} {
		if rec := serve(t, mux, "GET", url, nil); rec.Code != 404 {
			t.Errorf("%s: got %d, want 404 without SPA fallback", url, rec.Code)
		}
	}
	if rec := serve(t, mux, "GET", "/docs/assets/app-abc.js", nil); rec.Code != 200 || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("hashed docs asset: %d %v", rec.Code, rec.Header())
	}
	if rec := serve(t, mux, "GET", "/docs/hashmap.json", nil); rec.Header().Get("Cache-Control") != "no-cache" {
		t.Errorf("hashmap must revalidate: %v", rec.Header())
	}
	if rec := serve(t, mux, "HEAD", "/docs/guide/install", nil); rec.Code != 200 || rec.Body.Len() != 0 {
		t.Errorf("HEAD: %d, %d bytes", rec.Code, rec.Body.Len())
	}
	if rec := serve(t, mux, "POST", "/docs/", nil); rec.Code != 405 {
		t.Errorf("POST: got %d", rec.Code)
	}
	if rec := serve(t, mux, "GET", "/login", nil); rec.Body.String() != testIndex {
		t.Error("app routing changed")
	}
}
