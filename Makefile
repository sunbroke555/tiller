# PVE Web build entry points. Heavy targets run on the test server:
#   rt -- make test      rt -- make server
SHELL := /bin/bash
.DEFAULT_GOAL := server

GO  ?= go
NPM ?= npm
BIN := server/pve-web
GOFLAGS_BUILD := -trimpath -ldflags "-s -w"

.PHONY: deps web server test test-go test-web typecheck dev e2e e2e-area e2e-smoke e2e-visual e2e-deps e2e-server e2e-stop clean

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

## End-to-end tests against the lab (Playwright, see e2e/playwright.config.ts).
## Every target starts pve-web on $(PORT) (building it if sources changed), runs
## Playwright and stops the server again even when tests fail. Needs lab.env:
##   rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e-area AREA=lxc-config PORT=8106'
##
##   e2e         everything, desktop + phone (after a phase merge)
##   e2e-area    one area's specs, desktop: AREA=<id from docs/feature-map.json>
##   e2e-smoke   quick subset (login, overview, guest, console, storage, tasks), both layouts
##   e2e-visual  screenshot specs only (*.visual.spec.ts, E2E_SCREENSHOTS=1), on request
##
## SPEC is relative to e2e/ (empty = all); extra Playwright flags in E2E_ARGS,
## e.g. E2E_ARGS="--project=desktop -g 快照". E2E_WORKERS (default 2) sets the
## parallel spec files. Use a PORT of your own (8101–8199) so parallel runs on
## the test server do not collide.
PORT ?= 8101
SPEC ?=
E2E_ARGS ?=
AREA ?=

e2e/node_modules/.package-lock.json: e2e/package-lock.json e2e/package.json
	cd e2e && $(NPM) ci --no-audit --no-fund
e2e-deps: e2e/node_modules/.package-lock.json
	cd e2e && npx playwright install chromium

e2e: e2e-deps
	@test -n "$$PVE_LAB_URL" || { echo "PVE_LAB_URL 未设置：set -a; . ~/.config/pve-web/lab.env; set +a"; exit 2; }
	@trap '$(CURDIR)/scripts/e2e-server.sh stop $(PORT)' EXIT; \
	$(CURDIR)/scripts/e2e-server.sh start $(PORT) && \
	cd e2e && SECONDS=0 && rc=0 && \
	{ BASE_URL=http://127.0.0.1:$(PORT) npx playwright test $(SPEC) $(E2E_ARGS) || rc=$$?; } && \
	echo "e2e: Playwright 用时 $$((SECONDS / 60)) 分 $$((SECONDS % 60)) 秒" && exit $$rc

e2e-area:
	@test -n "$(AREA)" || { echo "用法：make e2e-area AREA=<area id>（见 docs/feature-map.json）"; exit 2; }
	@specs=$$($(CURDIR)/scripts/e2e-area.sh $(AREA)) && \
	$(MAKE) --no-print-directory e2e SPEC="$$specs" E2E_ARGS="--project=desktop $(E2E_ARGS)"

e2e-smoke:
	@$(MAKE) --no-print-directory e2e SPEC= E2E_ARGS="--grep @smoke $(E2E_ARGS)"

e2e-visual:
	@E2E_SCREENSHOTS=1 $(MAKE) --no-print-directory e2e SPEC="$(or $(SPEC),visual.spec)"

## e2e-server / e2e-stop: keep an instance running on $(PORT) to look at it (http://192.168.0.32:$(PORT))
e2e-server:
	$(CURDIR)/scripts/e2e-server.sh start $(PORT)
e2e-stop:
	$(CURDIR)/scripts/e2e-server.sh stop $(PORT)

clean:
	rm -rf web/dist server/web/dist $(BIN) e2e/.run
