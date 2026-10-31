//go:build !dev

package main

import (
	"embed"
	"io/fs"
)

// The frontend build (web/dist) is copied to server/web/dist by `make server`
// before `go build`. The directory itself only holds a .gitkeep in git, so the
// pattern is `all:web` (which always matches) and dist is selected with fs.Sub.
//
//go:embed all:web
var embedded embed.FS

// embeddedWeb returns the embedded SPA, or nil when the binary was built
// without a frontend build (the server then shows a "not built" page).
func embeddedWeb() fs.FS {
	sub, err := fs.Sub(embedded, "web/dist")
	if err != nil {
		return nil
	}
	if _, err := fs.Stat(sub, indexFile); err != nil {
		return nil
	}
	return sub
}

// defaultWebDir is used when WEB_DIR is unset and nothing is embedded.
const defaultWebDir = ""
