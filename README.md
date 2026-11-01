# PVE Web

基于 Proxmox VE 官方 API 的新 WebUI：手机优先、操作简便，目标是覆盖官方界面的全部功能。

- 前端：React 19 + Vite + TypeScript（strict）+ Tailwind CSS v4 + shadcn/ui + TanStack Query + React Router 7
- 服务端：Go 单二进制，内嵌前端，把 `/api2/` 原样反代到 PVE（含 VNC / 终端的 websocket）
- 主题：暗色玻璃、浅色玻璃、纸质（Claude 配色）、跟随系统；强调色、玻璃质感、列表密度可调

架构约定见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

需要 Go 1.25+、Node 22.12+（推荐 Node 26 / npm 11）、make。

登录要传 PVE 密码、两步验证码和 ticket，**对外提供服务时一定要用 HTTPS**：让 pve-web 自己带证书，或者放在 TLS 反向代理后面。

```sh
make server                      # 构建前端并编译 server/pve-web（内嵌前端）
PVE_URL=https://192.168.0.6:8006 \
PVE_TLS_FINGERPRINT=4F:04:C3:...:6E:17 \
TLS_CERT_FILE=/etc/pve-web/cert.pem \
TLS_KEY_FILE=/etc/pve-web/key.pem \
LISTEN=:8443 \
./server/pve-web
```

浏览器打开 `https://<主机>:8443`，用 PVE 账号登录（支持 TOTP / 恢复码两步验证）。

- 用 Caddy / nginx 等做 TLS 时，让 pve-web 只听本机（`LISTEN=127.0.0.1:8080`），并把代理地址写进 `TRUSTED_PROXIES`，这样登录限速和日志看到的是真实客户端地址。
- 不带证书又监听非本机地址时，pve-web 仍会启动（局域网实验用），但启动日志会醒目警告：密码和 ticket 以明文在网络上传输。

> 本仓库约定：重负载命令（安装依赖、构建、测试、dev server）在测试服务器上跑：
> `rt -- make test`、`rt -- make server`。

### 配置（环境变量）

| 变量 | 说明 |
| --- | --- |
| `PVE_URL` | PVE 地址，只写协议、主机、端口，默认 `https://127.0.0.1:8006`（直接跑在 PVE 主机上时可省略） |
| `LISTEN` | 监听地址，默认 `:8080` |
| `PVE_TLS_FINGERPRINT` | 固定信任 PVE 叶子证书的 SHA-256 指纹（冒号分隔或纯十六进制）。在 PVE 上用 `pvenode cert info` 或界面的“证书”查看 |
| `PVE_INSECURE_TLS=1` | 不校验 PVE 证书，仅限实验环境。与指纹二选一 |
| `PVE_CA_FILE` | 用指定 CA（如 `/etc/pve/pve-root-ca.pem` 的副本）校验 PVE 证书 |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | 让 pve-web 自己提供 HTTPS（推荐）。手机安装 PWA（离线外壳、主屏图标）也需要 HTTPS |
| `PVE_ALLOW_HTTP=1` | 允许 `PVE_URL` 用明文 `http://` 连非本机地址（默认只接受 https，或 http 连本机） |
| `ALLOW_FROM` | 只允许这些客户端访问（逗号分隔的 IP / 网段，如 `192.168.0.0/24,10.8.0.5`；本机地址总是允许）。pve-web 在 PVE 前面时，pveproxy 自己的 `ALLOW_FROM` 只能看到 pve-web 的地址 |
| `TRUSTED_PROXIES` | pve-web 前面的反向代理地址（IP / 网段）；只信任它们带来的 `X-Forwarded-For` |
| `WEB_DIR` | 从磁盘目录提供前端而不是内嵌版本（调试用） |

服务端无状态：不保存任何凭据，只在浏览器和 PVE 之间转发。

安全相关的行为：

- 登录 ticket 由 pve-web 写进 `PVEAuthCookie`：HttpOnly、SameSite=Strict、只发往 `/api2/`、关闭浏览器即失效（会话 cookie），前端 JavaScript 读不到；续签时由服务端从 cookie 里取出 ticket。不带 `X-Pve-Web-Ticket: cookie` 请求头的普通 API 客户端照常拿到 JSON 里的 ticket。
- 登录失败会按客户端地址和用户名逐步限速（同一地址连续 5 次、同一用户连续 10 次后开始等待，最长 15 / 5 分钟），并记录日志 `login failed client=… user=…`（不记密码和 ticket），可以接 fail2ban。
- 转发给 PVE 的请求带 `X-Forwarded-For: <客户端地址>`。想在 pveproxy 的访问日志里看到真实地址，在 PVE 的 `/etc/default/pveproxy` 设置 `PROXY_REAL_IP_HEADER="X-Forwarded-For"` 和 `PROXY_REAL_IP_ALLOW_FROM="<pve-web 的地址>"`。注意 pveproxy 的 `ALLOW_FROM` 和认证失败日志仍只看到 pve-web 的地址，所以访问控制请用上面的 `ALLOW_FROM`。
- 只转发 `/api2/json/`（含 websocket）；PVE 的 `/api2/html`、`/api2/extjs` 等格式不会出现在 pve-web 的源上，转发的响应都带 `Content-Security-Policy: default-src 'none'; sandbox`。
- 连不上 PVE 时，返回给浏览器的错误不含 PVE 的地址和证书细节，细节只写进服务端日志。

## 开发

```sh
make dev       # Go 服务（-tags dev，前端读 web/dist）+ Vite dev server（:5173，HMR，/api2 代理到 :8080）
make test      # go vet + go test、vitest、tsc 类型检查
make web       # 只构建前端到 web/dist
make clean
```

`make dev` 需要设置 `PVE_URL` 等变量，例如 `PVE_URL=https://<实验机>:8006 PVE_INSECURE_TLS=1 make dev`，然后访问 `http://<主机>:5173`。
写操作只对实验机（VMID 9900）做，连接信息在测试服务器 `~/.config/pve-web/lab.env`。

端到端测试在 `e2e/`（Playwright，headless 跑在测试服务器上，对接实验机）。`make e2e` 会按需构建、在 `PORT` 上启动 pve-web、跑测试、最后无论成败都停掉服务器：

```sh
rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e PORT=8101'                              # 全部
rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e PORT=8101 SPEC=tests/tasks.spec.ts'     # 单个 spec
rt --back e2e/playwright-report -- bash -lc '… make e2e PORT=8101 E2E_ARGS="--project=desktop"'               # 取回报告
```

固件（已登录的 `page`、实验机 API 助手 `pve`、`cleanup`）见 `e2e/fixtures.ts`。各功能区的分工、共享契约和端口分配见 [docs/CONTRIBUTING-AREAS.md](docs/CONTRIBUTING-AREAS.md)。

## 目录

```
server/            Go 服务：config.go 配置、proxy.go 反代、static.go 前端托管、main.go 入口
web/src/api/       client.ts（请求、CSRF、表单编码、PveApiError、401 处理）、auth.ts（登录、两步验证、续签）、
                   session.ts（登录态）、types.ts、queries.ts（TanStack Query hooks）、tasks.ts（UPID、任务状态与日志）、
                   <area>.ts（各功能区自己的端点）
web/src/components/form/   表单原语（FormDialog、FormField、SizeInput、StorageSelect、VmidInput…）
web/src/components/page/   页面外壳的注册表类型、操作栏、标签栏
web/src/components/tasks/  runTask 任务跟踪、底部任务提示、实时日志
web/src/lib/       format、propstring（PVE 属性字符串与配置 diff）、size、resources（路径）、taskTypes
web/src/theme/     主题偏好、首屏前执行的 boot 脚本、ThemeProvider
web/src/components/  通用组件（GlassCard、StatusDot、UsageBar、Sparkline、ConfirmDialog…）与 layout/（外框、导航、命令面板）
web/src/components/ui/  shadcn/ui 组件（可以改）
web/src/features/  按功能区组织的页面；guest/、node/、storage/ 是带注册表的页面外壳，command/ 是命令面板注册表
e2e/               Playwright 配置、fixtures.ts 与测试
scripts/e2e-server.sh  为 e2e 启停连接实验机的 pve-web
```

## 实现说明（给后续开发）

- **功能区分工与共享契约**：见 [docs/CONTRIBUTING-AREAS.md](docs/CONTRIBUTING-AREAS.md)（文件归属、runTask、propstring、表单、注册表、e2e）。
- **API 调用**：`get/post/put/del('/nodes/...', params)`；路径里插值用 ``p`/nodes/${node}/tasks/${upid}/status` ``，会自动 URI 编码。错误统一是 `PveApiError`（`status`、`message`、`errors`、`detail`）。
- **查询 key**：都在 `queryKeys` 下（前缀 `['pve']`），退出登录时整体清掉。新功能的查询放在自己的 `features/<area>/` 里，复用 `queryKeys` 的前缀约定。
- **轮询**：集群资源 5 秒、状态与任务 10 秒、RRD 60 秒；页面隐藏时暂停。
- **危险操作**：用 `ConfirmDialog`（`destructive`，删除类加 `typeToConfirm`）。
- **长任务**：返回 UPID 的操作用 `runTask(post(...), { title })`（`components/tasks/tracker.ts`），自动显示进度、实时日志并在结束后刷新数据。
- **主题**：颜色只用语义 token（`bg-card`、`text-muted-foreground`、`text-brand`、`surface` / `surface-strong` 工具类…），不要写死颜色；纸质主题用 `paper:` 变体微调，密度用 `--row-py`、`--card-p` 等变量。
- **CSP**：Go 服务按 `index.html` 里内联脚本的哈希生成 CSP，除主题 boot 脚本外不要加内联脚本。
- **点击目标**：触屏设备上按钮、输入框通过 `pointer-coarse:` 放大到 44px。
