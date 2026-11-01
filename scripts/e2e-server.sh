#!/usr/bin/env bash
# Start or stop a Tiller instance for end-to-end tests, proxying to the LAB
# PVE (never production). Runs on the test server:
#
#   scripts/e2e-server.sh [start] PORT   build server/tiller if sources changed, start it on :PORT
#   scripts/e2e-server.sh stop PORT      stop the instance started for PORT
#   scripts/e2e-server.sh status PORT
#
# Needs PVE_LAB_URL and PVE_LAB_FINGERPRINT (source ~/.config/pve-web/lab.env).
# Pid and log files: e2e/.run/server-PORT.{pid,log}. The server listens on all
# interfaces, so http://192.168.0.32:PORT is reachable from the LAN for a look.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BIN=$ROOT/server/tiller
RUN_DIR=$ROOT/e2e/.run

action=start
case "${1:-}" in
  start | stop | status) action=$1; shift ;;
esac
PORT=${1:-${PORT:-}}
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "用法: $0 [start|stop|status] PORT" >&2; exit 2; }

PID_FILE=$RUN_DIR/server-$PORT.pid
LOG_FILE=$RUN_DIR/server-$PORT.log
mkdir -p "$RUN_DIR"

running_pid() {
  [[ -f $PID_FILE ]] || return 1
  local pid
  pid=$(<"$PID_FILE")
  [[ -n $pid ]] && kill -0 "$pid" 2>/dev/null && echo "$pid"
}

stop() {
  local pid
  if pid=$(running_pid); then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$pid" 2>/dev/null || true
    echo "e2e-server: stopped :$PORT (pid $pid)"
  fi
  rm -f "$PID_FILE"
}

needs_build() {
  [[ -x $BIN ]] || return 0
  # Documentation is embedded too; changes must invalidate the binary.
  [[ -n $(find "$ROOT/doc" -type d \( -name node_modules -o -name dist -o -name cache \) -prune -o \
    -type f -newer "$BIN" -print -quit) ]] && return 0
  # Any source newer than the binary (server/web/dist is build output).
  [[ -n $(find "$ROOT/web/src" "$ROOT/web/public" "$ROOT/web/index.html" "$ROOT/web/package.json" \
    "$ROOT/web/vite.config.ts" "$ROOT/server" -type f -newer "$BIN" \
    ! -path "$ROOT/server/web/dist/*" ! -path "$BIN" -print -quit 2>/dev/null) ]]
}

start() {
  : "${PVE_LAB_URL:?PVE_LAB_URL 未设置：先执行 set -a; . ~/.config/pve-web/lab.env; set +a}"
  : "${PVE_LAB_FINGERPRINT:?PVE_LAB_FINGERPRINT 未设置}"
  # Hard guard: e2e tests write; they must never run against production.
  if [[ $PVE_LAB_URL =~ ://192\.168\.0\.6(:|/|$) ]]; then
    echo "e2e-server: 拒绝连接生产主机 $PVE_LAB_URL" >&2
    exit 3
  fi

  stop >/dev/null
  if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q LISTEN; then
    echo "e2e-server: 端口 $PORT 已被其他进程占用，换一个 PORT" >&2
    exit 4
  fi

  if needs_build; then
    echo "e2e-server: building server/tiller"
    make -C "$ROOT" server >"$RUN_DIR/build-$PORT.log" 2>&1 || {
      tail -n 40 "$RUN_DIR/build-$PORT.log" >&2
      exit 1
    }
  fi

  # rt holds its project lock on fd 9. A persistent preview must not inherit
  # that descriptor, otherwise all later rt commands wait until it stops.
  LISTEN=":$PORT" PVE_URL="$PVE_LAB_URL" PVE_TLS_FINGERPRINT="$PVE_LAB_FINGERPRINT" \
    setsid nohup "$BIN" >"$LOG_FILE" 2>&1 </dev/null 9>&- &
  echo $! >"$PID_FILE"

  for _ in $(seq 100); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
      echo "e2e-server: http://127.0.0.1:$PORT -> $PVE_LAB_URL (pid $(<"$PID_FILE"))"
      return 0
    fi
    if ! running_pid >/dev/null; then break; fi
    sleep 0.2
  done
  echo "e2e-server: 启动失败，日志：" >&2
  tail -n 30 "$LOG_FILE" >&2 || true
  stop >/dev/null
  exit 1
}

case $action in
  start) start ;;
  stop) stop ;;
  status)
    if pid=$(running_pid); then echo "running :$PORT (pid $pid)"; else echo "stopped :$PORT"; exit 1; fi
    ;;
esac
