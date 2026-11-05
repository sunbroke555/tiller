package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func (h *hardwareService) controlHardware(w http.ResponseWriter, r *http.Request, node string, c *hardwareNodeCache, conn hardwareConnection, operation string) {
	if !conn.Managed || conn.URL == "" {
		writePVEError(w, 409, "此采集服务不是由 Tiller 创建，不能停止或卸载")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	auth := h.authorizeHardware(ctx, w, r, operation)
	if auth == nil {
		return
	}
	script := h.hardwareControlScript(node, operation, conn.Version >= 2)
	if err := h.runInstaller(ctx, node, auth.Ticket, auth.CSRF, script); err != nil {
		writeHardwareError(w, 502, err)
		return
	}
	if operation == "uninstall" {
		conn = hardwareConnection{}
	} else {
		conn.Enabled = operation == "resume"
		conn.Paused = operation == "stop"
	}
	if _, err := h.connection(node, &conn); err != nil {
		writePVEError(w, 500, "节点操作已完成，但无法保存监控设置，请重试同步状态")
		return
	}
	c.snapshot = hardwareSnapshot{Enabled: conn.Enabled, Managed: conn.Managed, Paused: conn.Paused, SmartAuto: conn.Version >= 2}
	c.checked = time.Time{}
	c.diskChecked = time.Time{}
	if operation == "resume" {
		for attempt := 0; attempt < 5; attempt++ {
			if err := h.probeAndSave(ctx, node, conn, c); err == nil {
				hardwareProgress(ctx, "采集已恢复，连接验证通过")
				json.NewEncoder(w).Encode(c.snapshot)
				return
			}
			select {
			case <-ctx.Done():
				writePVEError(w, 502, "服务已恢复，但连接验证超时，请重新检查连接")
				return
			case <-time.After(500 * time.Millisecond):
			}
		}
		writePVEError(w, 502, "节点服务已恢复，但 Tiller 无法连接采集端口；请检查防火墙或再次停止采集")
		return
	}
	if operation == "uninstall" {
		c.snapshot.Notice = "仅移除可确认由 Tiller 安装的软件包；旧版本未记录归属的软件包会保留。"
	}
	json.NewEncoder(w).Encode(c.snapshot)
}

func (h *hardwareService) hardwareControlScript(node, operation string, smart bool) string {
	body := hardwareStopScript
	if operation == "resume" {
		body = hardwarePowerCleanup + hardwareResumeScript
	}
	if operation == "uninstall" {
		body = hardwareUninstallScript
	}
	auto := "0"
	if smart {
		auto = "1"
	}
	return strings.NewReplacer("@OWNER@", h.instance.ID+":"+node, "@SMART@", auto).Replace(hardwareControlPrelude + body)
}

const hardwareControlPrelude = `set +x
set -eu
export LC_ALL=C
[ "$(id -u)" = 0 ]
if [ -L /etc/tiller-node-exporter ] || [ ! -f /etc/tiller-node-exporter/owner ] || [ "$(cat /etc/tiller-node-exporter/owner)" != '@OWNER@' ]; then
  printf 'TILLER_ERROR:OWNER\n'; exit 80
fi
stop_tiller() {
  printf 'TILLER_STAGE:停止采集\n'
  for unit in tiller-power-collector.service tiller-smart-collector.timer tiller-node-exporter.service; do
    if [ "$(systemctl show -p LoadState --value "$unit")" != not-found ]; then
      systemctl disable --now "$unit"
    fi
  done
  if [ "$(systemctl show -p LoadState --value tiller-smart-collector.service)" != not-found ]; then
    systemctl stop tiller-smart-collector.service
  fi
  for unit in tiller-power-collector.service tiller-smart-collector.timer tiller-smart-collector.service tiller-node-exporter.service; do
    if [ "$(systemctl show -p LoadState --value "$unit")" = not-found ]; then continue; fi
    state="$(systemctl is-active "$unit" || true)"
    case "$state" in inactive|failed|unknown) ;; *) exit 81 ;; esac
  done
  for unit in tiller-power-collector.service tiller-smart-collector.timer tiller-node-exporter.service; do
    if [ "$(systemctl show -p LoadState --value "$unit")" = not-found ]; then continue; fi
    state="$(systemctl is-enabled "$unit" 2>/dev/null || true)"
    case "$state" in disabled|static|masked|not-found) ;; *) exit 81 ;; esac
  done
  printf 'TILLER_STAGE:采集已停止\n'
}
`

const hardwareStopScript = `stop_tiller
`

const hardwareResumeScript = `printf 'TILLER_STAGE:恢复采集\n'
systemctl enable --now tiller-node-exporter.service
if [ '@SMART@' = 1 ]; then
  systemctl enable --now tiller-smart-collector.timer
  systemctl start --no-block tiller-smart-collector.service
  systemctl is-active --quiet tiller-smart-collector.timer
fi
systemctl is-active --quiet tiller-node-exporter.service
printf 'TILLER_STAGE:采集服务已启动\n'
`

const hardwareUninstallScript = `printf 'TILLER_STAGE:检查卸载依赖\n'
work="$(mktemp -d /tmp/tiller-uninstall.XXXXXX)"
trap 'rm -rf "$work"' EXIT
set --
if [ ! -f /etc/tiller-node-exporter/packages ] || [ -f /etc/tiller-node-exporter/packages.unknown ]; then
  printf 'TILLER_STAGE:旧版安装记录缺失\n'
fi
if [ -f /etc/tiller-node-exporter/packages ]; then
  while IFS= read -r package; do
    case "$package" in '') continue ;; prometheus-node-exporter|python3|smartmontools) ;; *) printf 'TILLER_ERROR:PACKAGE_CHECK\n'; exit 82 ;; esac
    if [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" = 'install ok installed' ]; then
      set -- "$@" "$package"
    fi
  done < /etc/tiller-node-exporter/packages
fi
if [ "$#" -gt 0 ]; then
  printf '%s\n' "$@" | sort -u > "$work/owned"
  if ! apt-get -s purge "$@" > "$work/plan" 2>&1; then
    printf 'TILLER_ERROR:PACKAGE_CHECK\n'; exit 82
  fi
  awk '$1 == "Remv" || $1 == "Purg" { sub(/:[^:]+$/, "", $2); print $2 }' "$work/plan" | sort -u > "$work/remove"
  if [ -n "$(comm -23 "$work/remove" "$work/owned")" ] || awk '$1 == "Inst" { found=1 } END { exit !found }' "$work/plan"; then
    printf 'TILLER_ERROR:DEPENDENCIES\n'; exit 83
  fi
fi
stop_tiller
if [ "$#" -gt 0 ]; then
  printf 'TILLER_STAGE:卸载软件包\n'
  # dpkg enforces dependencies and cannot silently remove any other packages
  # if the package graph changes after the simulated apt plan.
  dpkg --purge "$@"
fi
printf 'TILLER_STAGE:卸载服务\n'
rm -f /etc/systemd/system/tiller-node-exporter.service /etc/systemd/system/tiller-smart-collector.timer /etc/systemd/system/tiller-smart-collector.service /etc/systemd/system/tiller-power-collector.service
rm -rf /etc/tiller-node-exporter /run/tiller-node-exporter
systemctl daemon-reload
printf 'TILLER_STAGE:服务已卸载\n'
`
