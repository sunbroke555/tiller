# PVE Web build entry points. Heavy targets run on the test server:
#   rt -- make test      rt -- make server
SHELL := /bin/bash
.DEFAULT_GOAL := server

GO  ?= go
NPM ?= npm
BIN := server/pve-web
GOFLAGS_BUILD := -trimpath -ldflags "-s -w"

.PHONY: deps web server test test-go test-web typecheck dev e2e-deps clean

# Reinstall web dependencies only when the lockfile changes.
web/node_modules/.package-lock.json: web/package-lock.json web/package.json
	cd web && $(NPM) ci --no-audit --no-fund
deps: web/node_modules/.package-lock.json

## web: build the SPA into web/dist
web: deps
	cd web && $(NPM) run build

## server: build the single binary with the SPA embedded (server/pve-web)
server: web
	rm -rf server/web/dist
	mkdir -p server/web
	cp -R web/dist server/web/dist
	cd server && CGO_ENABLED=0 $(GO) build $(GOFLAGS_BUILD) -o pve-web .
	@echo "built $(BIN)"

## test: Go tests, Vitest and the TypeScript type check
test: test-go test-web typecheck

test-go:
	cd server && $(GO) vet ./... && $(GO) vet -tags dev ./... && $(GO) test -count=1 ./...

test-web: deps
	cd web && $(NPM) test

typecheck: deps
	cd web && $(NPM) run typecheck

## dev: Go server (dev build, proxies /api2 to PVE_URL) + Vite with HMR on :5173
## Example: PVE_URL=https://<lab>:8006 PVE_INSECURE_TLS=1 make dev
dev: deps
	trap 'kill 0' EXIT INT TERM; \
	(cd server && LISTEN=127.0.0.1:8080 $(GO) run -tags dev .) & \
	(cd web && $(NPM) run dev) & \
	wait

e2e-deps:
	cd e2e && $(NPM) install --no-audit --no-fund && npx playwright install --with-deps chromium webkit

clean:
	rm -rf web/dist server/web/dist $(BIN)
