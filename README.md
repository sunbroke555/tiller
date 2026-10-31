# PVE Web

基于 Proxmox VE 官方 API 的新 WebUI：手机优先、操作简便，目标是覆盖官方界面的全部功能。

- 前端：React 19 + Vite + TypeScript（strict）+ Tailwind CSS v4 + shadcn/ui + TanStack Query + React Router 7
- 服务端：Go 单二进制，内嵌前端，把 `/api2/` 原样反代到 PVE（含 VNC / 终端的 websocket）
- 主题：暗色玻璃、浅色玻璃、纸质（Claude 配色）、跟随系统；强调色、玻璃质感、列表密度可调

架构约定见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 快速开始

需要 Go 1.25+、Node 22.12+（推荐 Node 26 / npm 11）、make。

```sh
make server                      # 构建前端并编译 server/pve-web（内嵌前端）
PVE_URL=https://192.168.0.6:8006 \
PVE_TLS_FINGERPRINT=4F:04:C3:...:6E:17 \
./server/pve-web                 # 默认监听 :8080
```

浏览器打开 `http://<主机>:8080`，用 PVE 账号登录（支持 TOTP / 恢复码两步验证）。

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
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | 让 pve-web 自己提供 HTTPS。手机安装 PWA（离线外壳、主屏图标）需要 HTTPS |
| `WEB_DIR` | 从磁盘目录提供前端而不是内嵌版本（调试用） |

服务端无状态：不保存任何凭据，只转发浏览器的 `PVEAuthCookie` 和 `CSRFPreventionToken`。

## 开发

```sh
make dev       # Go 服务（-tags dev，前端读 web/dist）+ Vite dev server（:5173，HMR，/api2 代理到 :8080）
make test      # go vet + go test、vitest、tsc 类型检查
make web       # 只构建前端到 web/dist
make clean
```

`make dev` 需要设置 `PVE_URL` 等变量，例如 `PVE_URL=https://<实验机>:8006 PVE_INSECURE_TLS=1 make dev`，然后访问 `http://<主机>:5173`。
写操作只对实验机（VMID 9900）做，连接信息在测试服务器 `~/.config/pve-web/lab.env`。

端到端测试在 `e2e/`（Playwright，headless 跑在测试服务器上）：

```sh
rt -- make e2e-deps
rt --back e2e/playwright-report -- bash -c 'set -a; . ~/.config/pve-web/lab.env; cd e2e && npx playwright test'
```

## 目录

```
server/            Go 服务：config.go 配置、proxy.go 反代、static.go 前端托管、main.go 入口
web/src/api/       client.ts（请求、CSRF、表单编码、PveApiError、401 处理）、auth.ts（登录、两步验证、续签）、
                   session.ts（登录态）、types.ts、queries.ts（TanStack Query hooks）
web/src/theme/     主题偏好、首屏前执行的 boot 脚本、ThemeProvider
web/src/components/  通用组件（GlassCard、StatusDot、UsageBar、Sparkline、ConfirmDialog…）与 layout/（外框、导航、命令面板）
web/src/components/ui/  shadcn/ui 组件（可以改）
web/src/features/  按功能区组织的页面
e2e/               Playwright 配置与测试
```

## 实现说明（给后续开发）

- **API 调用**：`get/post/put/del('/nodes/...', params)`；路径里插值用 ``p`/nodes/${node}/tasks/${upid}/status` ``，会自动 URI 编码。错误统一是 `PveApiError`（`status`、`message`、`errors`、`detail`）。
- **查询 key**：都在 `queryKeys` 下（前缀 `['pve']`），退出登录时整体清掉。新功能的查询放在自己的 `features/<area>/` 里，复用 `queryKeys` 的前缀约定。
- **轮询**：集群资源 5 秒、状态与任务 10 秒、RRD 60 秒；页面隐藏时暂停。
- **危险操作**：用 `ConfirmDialog`（`destructive`，删除类加 `typeToConfirm`）。
- **主题**：颜色只用语义 token（`bg-card`、`text-muted-foreground`、`text-brand`、`surface` / `surface-strong` 工具类…），不要写死颜色；纸质主题用 `paper:` 变体微调，密度用 `--row-py`、`--card-p` 等变量。
- **CSP**：Go 服务按 `index.html` 里内联脚本的哈希生成 CSP，除主题 boot 脚本外不要加内联脚本。
- **点击目标**：触屏设备上按钮、输入框通过 `pointer-coarse:` 放大到 44px。
