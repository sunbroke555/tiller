package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

// Installation uses PVE's authenticated terminal API with a short-lived root
// ticket. No SSH credential, PVE password or reusable shell API is persisted.
func (h *hardwareService) savedRootConnection() *passwordTransport {
	if h.upstream == nil {
		return nil
	}
	p, ok := h.upstream.Transport.(*passwordTransport)
	if ok && p.username == "root@pam" && p.password != "" {
		return p
	}
	return nil
}

type hardwareRootTicket struct {
	Ticket string `json:"ticket"`
	CSRF   string `json:"CSRFPreventionToken"`
}

func (h *hardwareService) authorizeHardware(ctx context.Context, w http.ResponseWriter, r *http.Request, operation string) *hardwareRootTicket {
	if !strings.HasPrefix(h.instance.URL, "https://") {
		writePVEError(w, 400, "节点管理操作需要使用 HTTPS 的 PVE 连接")
		return nil
	}
	var input struct {
		Password  string `json:"password"`
		Challenge string `json:"challenge"`
		Code      string `json:"code"`
	}
	d := json.NewDecoder(io.LimitReader(r.Body, 16<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(&input); (err != nil && !errors.Is(err, io.EOF)) || len(input.Password) > 1024 || len(input.Challenge) > 8192 {
		writePVEError(w, 400, "授权信息无效")
		return nil
	}
	hardwareProgress(ctx, "正在验证节点管理员授权")
	var auth hardwareRootTicket
	if root := h.savedRootConnection(); root != nil && input.Password == "" && input.Challenge == "" {
		session, e := root.ensure(ctx)
		if e != nil {
			writeHardwareAuthorizationError(w, e)
			return nil
		}
		auth.Ticket, auth.CSRF = session.ticket, session.csrf
	} else {
		values := url.Values{"username": {"root@pam"}, "password": {input.Password}, "new-format": {"1"}}
		if input.Challenge != "" {
			if !strings.HasPrefix(input.Challenge, "PVE:!tfa!") || !regexp.MustCompile(`^[0-9]{6,8}$`).MatchString(input.Code) {
				writePVEError(w, 400, "请输入有效的动态验证码")
				return nil
			}
			values.Set("tfa-challenge", input.Challenge)
			values.Set("password", "totp:"+input.Code)
		} else if input.Password == "" {
			w.WriteHeader(409)
			json.NewEncoder(w).Encode(map[string]any{"needsAuthorization": true, "operation": operation, "message": "需要节点管理员授权才能完成此操作"})
			return nil
		}
		if e := h.rootAPI(ctx, "/access/ticket", values, "", "", &auth); e != nil {
			writeHardwareAuthorizationError(w, e)
			return nil
		}
	}
	if strings.HasPrefix(auth.Ticket, "PVE:!tfa!") {
		hardwareProgress(ctx, "节点要求动态验证码，请完成身份验证")
		json.NewEncoder(w).Encode(map[string]any{"requiresTFA": true, "challenge": auth.Ticket})
		return nil
	}
	if !strings.HasPrefix(auth.Ticket, "PVE:") {
		writePVEError(w, 403, "PVE 没有返回有效的授权凭据")
		return nil
	}
	return &auth
}

func (h *hardwareService) install(w http.ResponseWriter, r *http.Request, node string, c *hardwareNodeCache) {
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	auth := h.authorizeHardware(ctx, w, r, "install")
	if auth == nil {
		return
	}
	ip, e := h.nodeIP(ctx, node)
	if e != nil {
		writePVEError(w, 400, e.Error())
		return
	}
	hardwareProgress(ctx, "正在生成采集服务证书与连接配置")
	conn, script, e := h.installer(node, ip)
	if e != nil {
		writePVEError(w, 500, "无法生成采集服务配置")
		return
	}
	previous, _ := h.connection(node, nil)
	// Persist generated credentials first, allowing a failed connection check
	// or a browser interruption to be recovered with the same credentials.
	if _, e = h.connection(node, &conn); e != nil {
		writePVEError(w, 500, "无法保存采集服务凭据")
		return
	}
	if e = h.runInstaller(ctx, node, auth.Ticket, auth.CSRF, script); e != nil {
		// If an upgrade failed before replacing the old service, retain its
		// working connection. Otherwise keep the new credentials for recovery.
		if previous.URL != "" {
			_ = h.probeAndSave(ctx, node, previous, c)
		}
		writeHardwareError(w, 502, e)
		return
	}
	conn.Enabled = true
	conn.Paused = false
	hardwareProgress(ctx, "正在验证采集服务的加密连接与指标读取")
	// systemd considers the process active before exporter finishes binding
	// its TLS socket. Allow that short startup window before reporting failure.
	for attempt := 0; attempt < 5; attempt++ {
		e = h.probeAndSave(ctx, node, conn, c)
		if e == nil {
			break
		}
		if attempt == 4 || ctx.Err() != nil {
			break
		}
		timer := time.NewTimer(500 * time.Millisecond)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
		}
	}
	if e != nil {
		writeHardwareError(w, 502, hardwareError("验证采集连接", "COLLECTOR_UNREACHABLE", "节点已完成安装，但 Tiller 暂时无法读取采集服务。", "检查节点 19100 端口、防火墙和 tiller-node-exporter 服务状态，再点击一键接入。", "采集服务已安装，可能正在后台采集。"))
		return
	}
	hardwareProgress(ctx, "采集服务连接成功，接入完成；首次 SMART 结果将在后台采集后显示")
	json.NewEncoder(w).Encode(c.snapshot)
}

func (h *hardwareService) rootAPI(ctx context.Context, path string, values url.Values, ticket, csrf string, dst any) error {
	req, e := http.NewRequestWithContext(ctx, "POST", h.instance.URL+"/api2/json"+path, strings.NewReader(values.Encode()))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if ticket != "" {
		req.Header.Set("Cookie", "PVEAuthCookie="+url.QueryEscape(ticket))
		req.Header.Set("CSRFPreventionToken", csrf)
	}
	client := &http.Client{Transport: h.transport, Timeout: 30 * time.Second, CheckRedirect: rejectHardwareRedirect}
	res, e := client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return &hardwareHTTPError{status: res.StatusCode}
	}
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 32<<10)).Decode(&env); e != nil {
		return e
	}
	return json.Unmarshal(env.Data, dst)
}

func (h *hardwareService) runInstaller(ctx context.Context, node, ticket, csrf, script string) error {
	hardwareProgress(ctx, "正在打开节点安装通道")
	var term struct {
		User   string          `json:"user"`
		Ticket string          `json:"ticket"`
		Port   json.RawMessage `json:"port"`
	}
	if e := h.rootAPI(ctx, "/nodes/"+node+"/termproxy", url.Values{}, ticket, csrf, &term); e != nil {
		return hardwareAccessError("打开节点 Shell", e)
	}
	port, err := strconv.Atoi(strings.Trim(string(term.Port), "\""))
	if err != nil || port < 1 || port > 65535 || term.User != "root@pam" || term.Ticket == "" {
		return hardwareError("打开节点 Shell", "TERMINAL_CREDENTIALS", "PVE 未返回有效的 root Shell 会话信息。", "检查 PVE 节点 Shell 是否正常，以及实例是否使用有效的 root@pam 授权。", hardwareNotStarted)
	}
	u, _ := url.Parse(h.instance.URL)
	if u.Scheme == "https" {
		u.Scheme = "wss"
	} else {
		u.Scheme = "ws"
	}
	u.Path = "/api2/json/nodes/" + node + "/vncwebsocket"
	u.RawQuery = url.Values{"port": {strconv.Itoa(port)}, "vncticket": {term.Ticket}}.Encode()
	dialer := websocket.Dialer{TLSClientConfig: h.transport.TLSClientConfig, HandshakeTimeout: 10 * time.Second, Subprotocols: []string{"binary"}, Proxy: nil}
	ws, response, e := dialer.DialContext(ctx, u.String(), http.Header{"Cookie": {"PVEAuthCookie=" + url.QueryEscape(ticket)}})
	if e != nil {
		if response != nil {
			response.Body.Close()
			if response.StatusCode >= 400 {
				e = &hardwareHTTPError{status: response.StatusCode}
			}
		}
		return hardwareAccessError("连接节点 Shell", e)
	}
	defer ws.Close()
	stop := context.AfterFunc(ctx, func() { ws.Close() })
	defer stop()
	ws.SetReadLimit(1 << 20)
	ws.SetReadDeadline(time.Now().Add(4 * time.Minute))
	if e = ws.WriteMessage(websocket.TextMessage, []byte(term.User+":"+term.Ticket+"\n")); e != nil {
		return hardwareTerminalError("验证 Shell 会话", e, "", false)
	}
	_, first, e := ws.ReadMessage()
	if e != nil {
		return hardwareTerminalError("验证 Shell 会话", e, "", false)
	}
	if !strings.HasPrefix(string(first), "OK") {
		return hardwareError("验证 Shell 会话", "TERMINAL_AUTH", "PVE 拒绝了 Shell 会话凭据，凭据可能已经失效。", "重新连接实例后重试；如果持续失败，请检查 PVE 的节点 Shell。", hardwareNotStarted)
	}
	var writer sync.Mutex
	write := func(data []byte) error {
		writer.Lock()
		defer writer.Unlock()
		ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return ws.WriteMessage(websocket.TextMessage, data)
	}
	input := func(command string) error { return write([]byte(fmt.Sprintf("0:%d:%s", len(command), command))) }
	done := make(chan struct{})
	defer close(done)
	type terminalResult struct {
		data []byte
		err  error
	}
	chunks := make(chan terminalResult, 16)
	go func() {
		for {
			_, chunk, e := ws.ReadMessage()
			select {
			case chunks <- terminalResult{chunk, e}:
			case <-done:
				return
			}
			if e != nil {
				return
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if write([]byte("2")) != nil {
					return
				}
			}
		}
	}()
	output := string(first[2:])
	progress := newHardwareInstallProgress(ctx)
	readUntil := func(pattern *regexp.Regexp, timeout time.Duration) ([]string, error) {
		timer := time.NewTimer(timeout)
		defer timer.Stop()
		for {
			if match := pattern.FindStringSubmatch(output); match != nil {
				return match, nil
			}
			select {
			case chunk := <-chunks:
				if chunk.err != nil {
					return nil, chunk.err
				}
				output += string(chunk.data)
				progress.feed(string(chunk.data))
				if len(output) > 128<<10 {
					output = output[len(output)-(64<<10):]
				}
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-timer.C:
				return nil, context.DeadlineExceeded
			}
		}
	}
	// The account's login shell may be zsh or fish. Enter our own clean Bash
	// before sending Bash syntax or credentials; never change the login shell.
	// Retry the harmless bootstrap if PAM flushed input while starting login.
	id, _ := newInstanceID()
	ready := "TILLER_READY_" + id
	readyPattern := regexp.MustCompile(`\n` + ready + `\r?\n`)
	hardwareProgress(ctx, "正在初始化节点 Shell，等待独立 Bash 执行环境就绪")
	for attempt := 0; attempt < 10; attempt++ {
		if e = input(hardwareShellBootstrap(ready)); e != nil {
			return hardwareTerminalError("初始化节点 Shell", e, output, false)
		}
		if _, e = readUntil(readyPattern, time.Second); e == nil {
			break
		}
		if !errors.Is(e, context.DeadlineExceeded) || ctx.Err() != nil {
			return hardwareTerminalError("初始化节点 Shell", e, output, false)
		}
	}
	if e != nil {
		return hardwareTerminalError("初始化节点 Shell", e, output, false)
	}
	// Fixed server-owned code, with no browser-supplied shell arguments. Short
	// acknowledged lines avoid both PTY limits and pveproxy's rejection of
	// fragmented WebSocket frames. Echo and shell history are already disabled.
	encoded := base64.StdEncoding.EncodeToString([]byte(script))
	hardwareProgress(ctx, "安装通道已就绪，正在传输采集服务配置")
	for part := 0; len(encoded) > 0; part++ {
		n := min(len(encoded), 768)
		ack := fmt.Sprintf("TILLER_PART_%s_%d", id, part)
		if e = input("TILLER_B64=\"$TILLER_B64\"'" + encoded[:n] + "'; printf '\\n" + ack + "\\n'\r"); e != nil {
			return hardwareTerminalError("传输采集脚本", e, "", false)
		}
		if _, e = readUntil(regexp.MustCompile(`\n`+ack+`\r?\n`), 5*time.Second); e != nil {
			return hardwareTerminalError("传输采集脚本", e, "", false)
		}
		encoded = encoded[n:]
	}
	marker := "TILLER_DONE_" + id
	// Pass secrets through stdin, never through a process's command-line args.
	// Leave the terminal open until we receive the marker. Exiting immediately
	// can make termproxy close before pveproxy has forwarded its final output.
	if e = input("printf %s \"$TILLER_B64\" | base64 -d | bash; printf '\\n" + marker + ":%s\\n' \"$?\"; unset TILLER_B64\r"); e != nil {
		return hardwareTerminalError("执行节点操作", e, "", true)
	}
	match, e := readUntil(regexp.MustCompile(`\n`+marker+`:([0-9]+)\r?\n`), 4*time.Minute)
	if e != nil {
		return hardwareTerminalError("等待节点结果 · "+progress.stage, e, "", true)
	}
	if match[1] == "0" {
		return nil
	}
	return hardwareExecutionError(progress, match[1])
}

func hardwareShellBootstrap(ready string) string {
	// Only this fixed command reaches the user's login shell. env removes Bash
	// startup hooks, and +i keeps the stdin-driven child noninteractive: no
	// history, prompt hooks or readline plugins can capture installer secrets.
	return "exec /usr/bin/env -u BASH_ENV -u ENV -u SHELLOPTS -u BASHOPTS HISTFILE=/dev/null HISTSIZE=0 HISTFILESIZE=0 TILLER_B64= /bin/bash --noprofile --norc +i -c 'stty -echo || exit; case \"${SHELL##*/}\" in bash|zsh|fish|dash|sh) printf \"\\nTILLER_SHELL:%s\\n\" \"${SHELL##*/}\";; esac; printf \"\\n" + ready + "\\n\"; exec /bin/bash --noprofile --norc +i -s'\r"
}

func (h *hardwareService) installer(node, ip string) (hardwareConnection, string, error) {
	var conn hardwareConnection
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		return conn, "", e
	}
	serial, e := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if e != nil {
		return conn, "", e
	}
	cert := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: "Tiller node monitoring"}, NotBefore: time.Now().Add(-5 * time.Minute), NotAfter: time.Now().AddDate(5, 0, 0), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IPAddresses: []net.IP{net.ParseIP(ip)}}
	der, e := x509.CreateCertificate(rand.Reader, cert, cert, &key.PublicKey, key)
	if e != nil {
		return conn, "", e
	}
	keyDER, e := x509.MarshalPKCS8PrivateKey(key)
	if e != nil {
		return conn, "", e
	}
	secretBytes := make([]byte, 32)
	if _, e = rand.Read(secretBytes); e != nil {
		return conn, "", e
	}
	secret := hex.EncodeToString(secretBytes)
	hash, e := bcrypt.GenerateFromPassword([]byte(secret), bcrypt.DefaultCost)
	if e != nil {
		return conn, "", e
	}
	sealed, e := h.auth.seal(secret, "hardware:"+h.scope(node))
	if e != nil {
		return conn, "", e
	}
	sha := sha256.Sum256(der)
	conn = hardwareConnection{URL: "https://" + net.JoinHostPort(ip, "19100") + "/metrics", Managed: true, Secret: sealed, Fingerprint: hex.EncodeToString(sha[:]), Version: 4}
	replacer := strings.NewReplacer("@OWNER@", h.instance.ID+":"+node, "@CERT@", string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), "@KEY@", string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})), "@HASH@", string(hash), "@SMART_COLLECTOR@", hardwareSmartCollector)
	return conn, replacer.Replace(strings.ReplaceAll(hardwareInstallScript, "@POWER_CLEANUP@", hardwarePowerCleanup)), nil
}

//go:embed hardware_smart.py
var hardwareSmartCollector string

const hardwareInstallScript = `set +x
set -eu
export LC_ALL=C
printf 'TILLER_STAGE:检查环境\n'
if [ "$(id -u)" != 0 ]; then printf 'TILLER_ERROR:ROOT\n'; exit 80; fi
if ! command -v pveversion >/dev/null; then printf 'TILLER_ERROR:PVE_ENV\n'; exit 80; fi
if [ -L /etc/tiller-node-exporter ]; then printf 'TILLER_ERROR:OWNER\n'; exit 80; fi
if [ -e /etc/tiller-node-exporter/owner ]; then
  if [ "$(cat /etc/tiller-node-exporter/owner)" != '@OWNER@' ]; then printf 'TILLER_ERROR:OWNER\n'; exit 80; fi
elif [ -e /etc/systemd/system/tiller-node-exporter.service ] || [ -e /etc/systemd/system/tiller-smart-collector.service ] || [ -e /etc/systemd/system/tiller-smart-collector.timer ] || [ -e /etc/systemd/system/tiller-power-collector.service ]; then
  printf 'TILLER_ERROR:OWNER\n'; exit 80
fi
umask 077
if [ -e /etc/tiller-node-exporter/owner ] && [ ! -f /etc/tiller-node-exporter/packages ]; then
  touch /etc/tiller-node-exporter/packages.unknown
fi
install -d -m 0700 /etc/tiller-node-exporter
printf '%s\n' '@OWNER@' > /etc/tiller-node-exporter/owner
touch /etc/tiller-node-exporter/packages
missing_packages=''
for package in prometheus-node-exporter python3 smartmontools; do
  if [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" != 'install ok installed' ]; then
    missing_packages="$missing_packages $package"
  fi
done
record_packages() {
  for package in $missing_packages; do
    if [ "$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)" = 'install ok installed' ]; then
      printf '%s\n' "$package" >> /etc/tiller-node-exporter/packages
    fi
  done
  sort -u /etc/tiller-node-exporter/packages -o /etc/tiller-node-exporter/packages
}
trap record_packages EXIT
printf 'TILLER_STAGE:安装软件包\n'
if ! command -v prometheus-node-exporter >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  had_default_unit=0
  if systemctl cat prometheus-node-exporter.service >/dev/null 2>&1; then had_default_unit=1; fi
  # An unavailable PVE subscription repository need not block installing a
  # Debian package from the other signed indexes. apt still verifies packages.
  printf 'TILLER_STAGE:更新软件源\n'
  if ! apt-get -o DPkg::Lock::Timeout=45 update </dev/null; then
    printf 'TILLER_STAGE:软件源部分失败\n'
    echo 'Some package indexes could not be refreshed; using available signed indexes.'
  fi
  printf 'TILLER_STAGE:安装node_exporter\n'
  apt-get -o DPkg::Lock::Timeout=45 install -y --no-install-recommends prometheus-node-exporter </dev/null
  # This default unit was just installed by us. Existing exporters are never
  # stopped or reconfigured; Tiller uses its own authenticated TLS endpoint.
  if [ "$had_default_unit" = 0 ]; then systemctl disable --now prometheus-node-exporter.service; fi
else
  printf 'TILLER_STAGE:复用node_exporter\n'
fi
if ! command -v python3 >/dev/null || ! command -v smartctl >/dev/null; then
  had_smartd_unit=0
  if systemctl cat smartmontools.service >/dev/null 2>&1; then had_smartd_unit=1; fi
  printf 'TILLER_STAGE:安装SMART依赖\n'
  DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=45 install -y --no-install-recommends python3 smartmontools </dev/null
  if [ "$had_smartd_unit" = 0 ]; then systemctl disable --now smartmontools.service; fi
else
  printf 'TILLER_STAGE:复用SMART依赖\n'
fi
printf 'TILLER_STAGE:写入配置\n'
umask 077
install -d -m 0700 /etc/tiller-node-exporter
printf '%s\n' '@OWNER@' > /etc/tiller-node-exporter/owner
cat > /etc/tiller-node-exporter/cert.pem <<'TILLER_CERT'
@CERT@
TILLER_CERT
cat > /etc/tiller-node-exporter/key.pem <<'TILLER_KEY'
@KEY@
TILLER_KEY
cat > /etc/tiller-node-exporter/web.yml <<'TILLER_CONFIG'
tls_server_config:
  cert_file: /etc/tiller-node-exporter/cert.pem
  key_file: /etc/tiller-node-exporter/key.pem
  min_version: TLS12
basic_auth_users:
  tiller: '@HASH@'
TILLER_CONFIG
cat > /etc/tiller-node-exporter/smart.py <<'TILLER_SMART'
@SMART_COLLECTOR@
TILLER_SMART
cat > /etc/systemd/system/tiller-smart-collector.service <<'TILLER_SMART_UNIT'
[Unit]
Description=Tiller read-only SMART cache (skip sleeping disks)
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /etc/tiller-node-exporter/smart.py
RuntimeDirectory=tiller-node-exporter
RuntimeDirectoryMode=0700
RuntimeDirectoryPreserve=yes
ReadWritePaths=/run/tiller-node-exporter
TimeoutStartSec=3min
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateNetwork=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
CapabilityBoundingSet=CAP_SYS_RAWIO CAP_SYS_ADMIN
MemoryMax=128M
TILLER_SMART_UNIT
cat > /etc/systemd/system/tiller-smart-collector.timer <<'TILLER_SMART_TIMER'
[Unit]
Description=Refresh Tiller SMART cache every 10 minutes
[Timer]
OnBootSec=30s
OnUnitInactiveSec=10min
AccuracySec=30s
[Install]
WantedBy=timers.target
TILLER_SMART_TIMER
cat > /etc/systemd/system/tiller-node-exporter.service <<'TILLER_UNIT'
[Unit]
Description=Tiller hardware monitoring (node_exporter)
After=network.target
[Service]
ExecStart=/usr/bin/prometheus-node-exporter --web.listen-address=:19100 --web.config.file=/etc/tiller-node-exporter/web.yml --collector.disable-defaults --collector.hwmon --collector.rapl --collector.cpufreq --collector.powersupplyclass --collector.uname --collector.thermal_zone --collector.textfile --collector.textfile.directory=/run/tiller-node-exporter
Restart=on-failure
RestartSec=10
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=128M
[Install]
WantedBy=multi-user.target
TILLER_UNIT
@POWER_CLEANUP@
printf 'TILLER_STAGE:启动服务\n'
systemctl daemon-reload
systemctl enable --now tiller-smart-collector.timer
printf 'TILLER_STAGE:SMART定时任务已启动\n'
systemctl start --no-block tiller-smart-collector.service
systemctl enable tiller-node-exporter.service
systemctl restart tiller-node-exporter.service
systemctl is-active --quiet tiller-node-exporter.service
printf 'TILLER_STAGE:采集服务已启动\n'
`
