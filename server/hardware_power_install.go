package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// Upgrade only Tiller-owned scripts; leave packages, credentials and exporter
// running. Version 4 returns power from the existing scrape interval.
func (h *hardwareService) hardwareScriptsUpgrade(node string) string {
	return strings.NewReplacer("@OWNER@", h.instance.ID+":"+node, "@SMART_COLLECTOR@", hardwareSmartCollector).Replace(hardwareControlPrelude + `
test -f /etc/systemd/system/tiller-node-exporter.service
printf 'TILLER_STAGE:更新采集脚本\n'
umask 077
cat > /etc/tiller-node-exporter/smart.py.tmp <<'TILLER_SMART'
@SMART_COLLECTOR@
TILLER_SMART
chmod 600 /etc/tiller-node-exporter/smart.py.tmp
mv -f /etc/tiller-node-exporter/smart.py.tmp /etc/tiller-node-exporter/smart.py
` + hardwarePowerCleanup)
}

func (h *hardwareService) upgradeHardwareScripts(w http.ResponseWriter, r *http.Request, node string, c *hardwareNodeCache, conn hardwareConnection) {
	if !conn.Enabled || conn.Paused {
		writePVEError(w, 409, "请先恢复采集，再更新采集服务")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
	defer cancel()
	auth := h.authorizeHardware(ctx, w, r, "upgrade")
	if auth == nil {
		return
	}
	if err := h.runInstaller(ctx, node, auth.Ticket, auth.CSRF, h.hardwareScriptsUpgrade(node)); err != nil {
		writeHardwareError(w, 502, err)
		return
	}
	for attempt := 0; attempt < 5; attempt++ {
		if err := h.probeAndSave(ctx, node, conn, c); err == nil && c.snapshot.PowerCollectorVersion == 0 {
			conn.Version = 4
			if _, err := h.connection(node, &conn); err != nil {
				writePVEError(w, 500, "节点已更新，但无法保存采集设置")
				return
			}
			hardwareProgress(ctx, "功耗已复用现有硬件轮询，独立采样任务已移除")
			json.NewEncoder(w).Encode(c.snapshot)
			return
		}
		select {
		case <-ctx.Done():
			attempt = 5
		case <-time.After(500 * time.Millisecond):
		}
	}
	writePVEError(w, 502, "采集脚本已更新，但连接验证尚未完成，请重新检查连接")
}

// Only called after the enclosing install/control script verifies ownership.
// Keep this migration on resume too, so an older stopped sampler cannot return.
const hardwarePowerCleanup = `
printf 'TILLER_STAGE:清理独立功耗采样任务\n'
if [ "$(systemctl show -p LoadState --value tiller-power-collector.service)" != not-found ]; then
  systemctl disable --now tiller-power-collector.service
  state="$(systemctl is-active tiller-power-collector.service || true)"
  case "$state" in inactive|failed|unknown) ;; *) exit 81 ;; esac
fi
rm -f /etc/systemd/system/tiller-power-collector.service
rm -f /etc/tiller-node-exporter/power.py /etc/tiller-node-exporter/power.py.tmp
rm -f /run/tiller-node-exporter/power.prom /run/tiller-node-exporter/power.prom.tmp
systemctl daemon-reload
printf 'TILLER_STAGE:独立功耗采样任务已移除\n'
`
