package main

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
)

const hardwareNotStarted = "节点采集操作尚未执行。"
const hardwareResultUnknown = "节点操作可能已开始，部分步骤可能已完成；请检查当前状态后再重试。"

// Diagnostics contain only our own descriptions. Never include raw terminal
// output, URLs, websocket close reasons or command lines containing secrets.
type hardwareFailure struct {
	Code       string `json:"code"`
	Stage      string `json:"stage"`
	Reason     string `json:"reason"`
	Suggestion string `json:"suggestion"`
	State      string `json:"state"`
}

func (e *hardwareFailure) Error() string { return e.Stage + "失败：" + e.Reason }

func hardwareError(stage, code, reason, suggestion, state string) *hardwareFailure {
	if label := map[string]string{"安装node_exporter": "安装 node_exporter", "安装SMART依赖": "安装 SMART 依赖", "SMART定时任务已启动": "启动 SMART 定时任务"}[stage]; label != "" {
		stage = label
	}
	return &hardwareFailure{Code: code, Stage: stage, Reason: reason, Suggestion: suggestion, State: state}
}

func writeHardwareError(w http.ResponseWriter, status int, err error) {
	var failure *hardwareFailure
	if !errors.As(err, &failure) {
		writePVEError(w, status, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json;charset=UTF-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"data": nil, "message": failure.Error(), "diagnostic": failure})
}

type hardwareHTTPError struct{ status int }

func (e *hardwareHTTPError) Error() string {
	return fmt.Sprintf("节点接口返回 HTTP %d", e.status)
}

func hardwareAccessError(stage string, err error) *hardwareFailure {
	var status *hardwareHTTPError
	var auth *connectionAuthError
	var pin *FingerprintMismatchError
	var certificate x509.UnknownAuthorityError
	var hostname x509.HostnameError
	var dns *net.DNSError
	var network net.Error
	switch {
	case errors.As(err, &status):
		if status.status == 401 || status.status == 403 {
			suggestion := "检查实例中的 root@pam 授权是否有效，并确认该账号能在 PVE 页面打开节点 Shell。"
			if stage == "验证节点管理员授权" {
				suggestion = "检查 root@pam 的密码或动态验证码；使用保存的账号时，在实例管理中更新授权信息。"
			}
			return hardwareError(stage, "PVE_ACCESS_DENIED", fmt.Sprintf("PVE 拒绝了本次节点授权（HTTP %d）。", status.status), suggestion, hardwareNotStarted)
		}
		return hardwareError(stage, "PVE_HTTP_ERROR", fmt.Sprintf("PVE 接口返回 HTTP %d，未能建立操作通道。", status.status), "在 PVE 页面检查节点是否在线，以及 pveproxy、pvedaemon 的状态。", hardwareNotStarted)
	case errors.As(err, &auth):
		return hardwareError(stage, "PVE_AUTH_FAILED", "PVE 未接受保存的节点账号授权。", "在实例管理中检查用户名、密码和认证域；需要两步验证时，按授权窗口提示完成验证。", hardwareNotStarted)
	case errors.As(err, &pin), errors.As(err, &certificate), errors.As(err, &hostname):
		return hardwareError(stage, "PVE_CERTIFICATE", "PVE 的 HTTPS 证书验证未通过。", "在实例管理中核对 PVE 地址与证书指纹，再重新连接。", hardwareNotStarted)
	case errors.As(err, &dns):
		return hardwareError(stage, "PVE_DNS", "Tiller 无法解析 PVE 的主机名。", "检查运行 Tiller 的主机或容器的 DNS，以及实例中的 PVE 地址。", hardwareNotStarted)
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &network) && network.Timeout():
		return hardwareError(stage, "PVE_TIMEOUT", "等待 PVE 响应超时。", "检查 Tiller 到 PVE 的网络、8006 端口及反向代理连接。", hardwareNotStarted)
	default:
		return hardwareError(stage, "PVE_CONNECTION", "Tiller 未能与 PVE 建立操作连接。", "检查实例连接和节点在线状态；使用反向代理时，确认允许 WebSocket 连接。", hardwareNotStarted)
	}
}

func writeHardwareAuthorizationError(w http.ResponseWriter, err error) {
	failure := hardwareAccessError("验证节点管理员授权", err)
	status := http.StatusBadGateway
	if failure.Code == "PVE_ACCESS_DENIED" || failure.Code == "PVE_AUTH_FAILED" {
		status = http.StatusForbidden
	}
	writeHardwareError(w, status, failure)
}

func hardwareTerminalError(stage string, err error, output string, started bool) *hardwareFailure {
	state := hardwareNotStarted
	if started {
		state = hardwareResultUnknown
	}
	if !started && stage == "初始化节点 Shell" {
		lower := strings.ToLower(output)
		if strings.Contains(lower, "no such option: history") || strings.Contains(lower, "unsupported use of '='") {
			return hardwareError(stage, "SHELL_SYNTAX", "节点登录 Shell 返回了不兼容的初始化命令错误。", "更新 Tiller 后重试；当前版本通过独立 Bash 支持 zsh，无需修改节点的默认 Shell。", state)
		}
		if strings.Contains(lower, "/bin/bash") && (strings.Contains(lower, "no such file or directory") || strings.Contains(lower, "permission denied")) {
			return hardwareError(stage, "SHELL_BASH_UNAVAILABLE", "节点无法启动 /bin/bash，可能缺少文件或执行权限。", "在 PVE 的节点 Shell 中检查 /bin/bash 是否存在并且可以执行。", state)
		}
	}
	var network net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &network) && network.Timeout()) {
		reason := "等待节点返回响应超时，尚未确认具体原因。"
		suggestion := "检查 PVE 的节点 Shell 能否正常打开，以及 Tiller 到 PVE 的网络连接。"
		if stage == "初始化节点 Shell" {
			reason = "10 秒内未收到 Shell 就绪响应，尚未确认具体原因。"
			suggestion = "打开 PVE → 节点 → Shell，检查是否卡在登录提示或启动脚本；确认可以输入命令后再重试。"
		}
		return hardwareError(stage, "TERMINAL_TIMEOUT", reason, suggestion, state)
	}
	return hardwareError(stage, "TERMINAL_DISCONNECTED", "节点 Shell 连接在收到结果前中断。", "检查 PVE 节点是否在线，以及网络或反向代理是否中断了 WebSocket 连接。", state)
}

func hardwareMarkerError(code, stage string) *hardwareFailure {
	switch code {
	case "ROOT":
		return hardwareError(stage, "NODE_ROOT_REQUIRED", "节点操作会话没有获得 root 权限。", "检查节点的 root@pam 授权，并确认该账号可以打开 PVE 的节点 Shell。", hardwareNotStarted)
	case "PVE_ENV":
		return hardwareError(stage, "NODE_PVE_ENVIRONMENT", "节点缺少 pveversion 命令，无法确认 Proxmox VE 环境。", "确认实例连接的是 PVE 节点，并检查节点系统组件是否完整。", hardwareNotStarted)
	case "OWNER":
		return hardwareError(stage, "SERVICE_OWNER", "服务归属校验失败，现有采集服务不属于此 Tiller 接入。", "检查是否由其他 Tiller 实例或工具安装，先在原来的接入入口管理该服务。", hardwareNotStarted)
	case "DEPENDENCIES":
		return hardwareError(stage, "PACKAGE_DEPENDENCIES", "卸载会连带移除其他软件包，存在依赖冲突，已取消卸载；采集服务保持原状态。", "保留这些共享软件包；需要暂停监控时可使用「停止采集」。", hardwareNotStarted)
	case "PACKAGE_CHECK":
		return hardwareError(stage, "PACKAGE_CHECK", "无法完成软件包依赖检查，已取消卸载。", "在节点上检查 apt / dpkg 状态，确认没有其他安装任务或未完成的软件更新。", hardwareNotStarted)
	}
	return nil
}

func hardwareOutputHint(stage, line string) *hardwareFailure {
	lower := strings.ToLower(line)
	code, reason, suggestion := "", "", ""
	switch {
	case strings.Contains(lower, "could not get lock"), strings.Contains(lower, "unable to acquire the dpkg frontend lock"):
		code, reason, suggestion = "PACKAGE_LOCKED", "软件包管理器正被其他任务占用。", "等待节点上的安装或更新任务结束后重试，不要直接删除锁文件。"
	case strings.Contains(lower, "dpkg was interrupted"):
		code, reason, suggestion = "PACKAGE_INTERRUPTED", "节点存在尚未完成的 dpkg 配置。", "在 PVE 节点 Shell 中检查并完成先前的软件包配置，再重试接入。"
	case strings.Contains(lower, "temporary failure resolving"), strings.Contains(lower, "could not resolve"):
		code, reason, suggestion = "PACKAGE_DNS", "节点无法解析软件源的主机名。", "检查 PVE 节点的 DNS 和外网连接，再更新软件包索引。"
	case strings.Contains(lower, "401 unauthorized"), strings.Contains(lower, "403 forbidden"):
		code, reason, suggestion = "PACKAGE_REPOSITORY_AUTH", "软件源拒绝了下载请求。", "检查节点的软件源授权；使用企业软件源时确认订阅有效，或配置可用的官方软件源。"
	case strings.Contains(lower, "unable to locate package"), strings.Contains(lower, "has no installation candidate"):
		code, reason, suggestion = "PACKAGE_UNAVAILABLE", "当前软件源中没有找到所需软件包。", "检查 PVE 节点的 Debian 软件源与发行版是否匹配，更新索引后重试。"
	case strings.Contains(lower, "no space left on device"):
		code, reason, suggestion = "NODE_DISK_FULL", "节点磁盘空间或可用 inode 不足。", "检查节点根分区和 /var 的可用空间及 inode，释放空间后重试。"
	case strings.Contains(lower, "read-only file system"):
		code, reason, suggestion = "NODE_READ_ONLY", "节点文件系统处于只读状态，无法写入配置。", "检查节点存储和文件系统状态，修复只读原因后再重试。"
	default:
		return nil
	}
	return hardwareError(stage, code, reason, suggestion, "节点脚本已停止，先前完成的步骤会保留。")
}

func hardwareExecutionError(progress *hardwareInstallProgress, exitCode string) *hardwareFailure {
	if progress.failure != nil {
		return progress.failure
	}
	if progress.hint != nil {
		return progress.hint
	}
	suggestion := "在 PVE 节点上检查该步骤的执行环境，修复后重试。"
	switch progress.stage {
	case "安装node_exporter", "安装SMART依赖", "更新软件源":
		suggestion = "在 PVE 的更新页面检查软件源和 apt 状态；确认可以安装 prometheus-node-exporter、python3、smartmontools。"
	case "启动服务", "SMART定时任务已启动", "恢复采集":
		suggestion = "在节点检查 tiller-node-exporter 和 tiller-smart-collector 的 systemd 日志，确认启动失败原因。"
	case "停止采集":
		suggestion = "在节点检查 Tiller 采集服务和定时任务状态，确认是否仍有任务运行。"
	}
	return hardwareError(progress.stage, "NODE_COMMAND_FAILED", fmt.Sprintf("节点命令以退出码 %s 结束，未返回可识别的具体原因。", exitCode), suggestion, "节点脚本已停止，先前完成的步骤会保留。")
}
