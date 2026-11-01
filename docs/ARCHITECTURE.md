# PVE Web — 架构约定

一套基于 Proxmox VE 官方 API 的新 WebUI，目标是覆盖官方 WebUI 的全部功能，手机优先、操作简便。所有参与开发的人（和 agent）都按这份约定写代码。

## 仓库结构

```
pve-web/
  server/                 Go 单二进制：托管前端 + 反代 PVE
    go.mod                module pve-web/server（Go 1.25+）
    main.go               读配置、启动 HTTP
    proxy.go              /api2/* 反代到 PVE（含 websocket 升级）
    web/dist/             前端构建产物（go:embed，构建时由 web 复制过来，不入库）
  web/                    React 前端
    src/
      api/                PVE API 客户端、类型、TanStack Query hooks
      components/ui/      shadcn/ui 组件（npx shadcn 生成后可改）
      components/         通用业务组件（ResourceIcon、StatusDot、UsageBar、RrdChart…）
      features/<area>/    按功能区组织页面：overview、guest、console、storage、tasks、node、datacenter…
      theme/              主题定义与切换
      lib/                工具函数（格式化字节/时长、错误处理）
      routes.tsx          路由表
  docs/                   架构、功能覆盖表（feature-map.md）
  e2e/                    Playwright 端到端测试（跑在测试服务器上，对接实验机）
```

## 技术栈

- 前端：React 19 + Vite + TypeScript（strict）+ Tailwind CSS v4 + shadcn/ui（Radix）+ lucide-react
- 数据：TanStack Query v5（轮询状态、缓存、乐观更新）；路由：React Router v7（library 模式）
- 图表：Recharts（shadcn chart 组件）；控制台：@novnc/novnc（VNC）+ @xterm/xterm（termproxy）
- 提示：sonner；PWA：vite-plugin-pwa
- 字体全部本地打包（@fontsource-variable/geist、geist-mono、一款衬线体），不依赖外网——内网环境也能正常显示
- 测试：vitest（单元）、Playwright（e2e）、go test（服务端）
- 界面语言：中文。文案直接写在组件里，保持简短。

## 运行时架构

浏览器 ←同源→ Go 服务（默认 :8080）→ PVE（https://<host>:8006）

- Go 服务托管 SPA（history fallback 到 index.html），把 `/api2/json/` 原样反代到 PVE，支持 websocket 升级（vncwebsocket、termproxy）；PVE 的其它格式（/api2/html 等）不转发。
- 配置：环境变量 `PVE_URL`（如 `https://192.168.0.6:8006`）、`LISTEN`（默认 `:8080`）、`PVE_TLS_FINGERPRINT`（可选，SHA-256 证书指纹，固定信任）或 `PVE_INSECURE_TLS=1`（实验环境用）。
- 反代时改写 `Host`/`Origin` 以符合 PVE 的校验；不持久化任何凭据，服务端无状态。

## 认证

- 登录：`POST /api2/json/access/ticket`（username、password、realm）。成功后得到 `ticket` 和 `CSRFPreventionToken`。
- 两步验证：若返回的 ticket 带 `!tfa!` 前缀（`NeedTFA`），用 `tfa-challenge=<ticket>` 加 `password=totp:<code>`（或 `recovery:`、WebAuthn）再次请求。
- 前端登录请求带 `X-Pve-Web-Ticket: cookie`：Go 服务把返回的 ticket 写进 cookie `PVEAuthCookie`（HttpOnly、SameSite=Strict、Path=/api2/、会话 cookie），并从 JSON 里去掉（`!tfa!` 中间 ticket 照常返回）。浏览器随 API 请求带上它，Go 服务原样转发给 PVE；写操作带 `CSRFPreventionToken` 请求头。CSRF token 和用户名存在 localStorage，另有一个非机密的会话标记 cookie 表示 ticket cookie 仍在，刷新页面不掉登录。退出登录调用 `POST /api/logout` 清掉 ticket cookie。
- ticket 有效期 2 小时，前端在过期前续签：密码填占位符，由 Go 服务换成 cookie 里的 ticket。
- 登录失败按客户端地址/用户名限速并记日志；可选 `ALLOW_FROM` 客户端白名单（pveproxy 只能看到 pve-web 的地址）。

## 主题

- 用 CSS 变量定义主题，`<html data-theme="…">` 切换，shadcn 的语义变量（--background、--foreground、--card、--primary…）全部由主题提供。
- 三套主题：
  - `dark` 暗色玻璃：近黑底（#07080a）+ 低饱和彩色光晕，深色半透明玻璃卡片（backdrop-filter），Geist 字体，数字用 Geist Mono。
  - `light` 浅色玻璃：浅灰底（#eceef3）+ 柔和光晕，白色半透明玻璃卡片。
  - `paper` 纸质（Claude 配色）：Ivory #FAF9F5 底、Slate #141413 文字、Clay #D97757 强调色，标题用衬线体，卡片是实色纸张（轻微纸纹/细边框），不用毛玻璃。
  - 另有“跟随系统”（在 dark / light 之间自动切换）。
- 玻璃主题可选强调色：indigo / teal / orange / rose（暗色用亮档，浅色用深档以保证对比度）。paper 主题固定 Clay。
- “玻璃质感”开关：关闭后卡片改为实色、去掉 blur，适合旧手机。
- “列表密度”：舒适 / 紧凑。
- 所有偏好存 localStorage，每台设备独立。

## 交互约定（手机优先）

- 手机：底部悬浮导航（资源 / 存储 / 任务 / Shell）+ 独立搜索按钮（命令面板）；详情页底部悬浮操作栏。
- 桌面（≥1024px）：左侧导航 + 资源树，中间内容，右侧详情面板（可选）。
- 点击目标 ≥44px；危险操作（停止、删除、重启节点）走确认弹层，删除类需要输入名称/ID 确认。
- 长任务（UPID）统一用任务进度提示：底部 toast 显示进度，可展开看实时日志。
- 命令面板（Ctrl/⌘K）：搜索资源、跳转页面、直接执行动作（启动/关机/重启/快照…）。

## API 客户端约定

- `api/client.ts`：`get/post/put/del(path, params)`，路径以 `/nodes/...` 这种 API 路径表示，自动加 `/api2/json` 前缀、CSRF 头、表单编码（PVE 接受 `application/x-www-form-urlencoded`），解包 `{data}`，错误统一抛 `PveApiError`（含 status、message、字段错误 `errors`）。
- 401 时清掉登录态并跳转登录页。
- 返回 UPID 的操作用 `runTask(promise, { title })`（`components/tasks/tracker.ts`）跟踪：底部任务提示、实时日志、结束后刷新查询。底层的 `useTaskStatus(node, upid)` / `useTaskLog(node, upid)`（增量 start/limit）在 `api/tasks.ts`。
- 各功能区的文件归属、注册表（标签、操作、命令）、表单原语和 e2e 约定见 [CONTRIBUTING-AREAS.md](CONTRIBUTING-AREAS.md)。
- 类型尽量精确定义在 `api/types.ts`；参考权威来源：PVE 主机上的 `/usr/share/pve-manager/js/pvemanagerlib.js`（官方 UI 源码）和 `pvesh usage <path> -v`（API schema），从测试服务器 `ssh pve` 只读查看。

## 环境与安全

- 生产 PVE：192.168.0.6，上面有在用的 VM/CT。**只读**，绝不对现有客户机做任何写操作。
- 实验机：VMID 9900，嵌套 PVE，所有写操作测试都对它做。连接信息存在测试服务器 `~/.config/pve-web/lab.env`（不入库）。
- 重负载命令（npm install、构建、测试、dev server）一律通过 `rt -- <cmd>` 在测试服务器 192.168.0.32 上执行。
