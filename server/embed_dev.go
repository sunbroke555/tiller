//go:build dev

package main

import "io/fs"

// Dev builds (`go run -tags dev .`) embed nothing and serve the frontend from
// disk, so `vite build --watch` output is picked up without rebuilding Go.
func embeddedWeb() fs.FS { return nil }

// defaultWebDir is relative to the server/ directory.
const defaultWebDir = "../web/dist"
