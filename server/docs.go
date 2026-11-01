package main

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// docsHandler serves VitePress output from the same embedded filesystem as
// the app. Unlike the SPA, missing documentation paths must return a 404.
type docsHandler struct{ *spaHandler }

func newDocsHandler(fsys fs.FS, immutable bool) *docsHandler {
	return &docsHandler{newSPAHandler(fsys, immutable)}
}

// ServeHTTP receives a path with /docs/ stripped by the mux. All reads stay
// inside docs/, including when WEB_DIR replaces the embedded build.
func (h *docsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" {
		name = indexFile
	} else if path.Ext(name) == "" {
		name += ".html"
	}
	f, err := h.load("docs/" + name)
	if errors.Is(err, fs.ErrNotExist) || errors.Is(err, errIsDir) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h.serveFile(w, r, f)
}
