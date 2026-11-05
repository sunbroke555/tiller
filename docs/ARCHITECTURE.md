# Tiller — 架构约定

一套基于 Proxmox VE 官方 API 的新 WebUI，目标是覆盖官方 WebUI 的全部功能，手机优先、操作简便。所有参与开发的人（和 agent）都按这份约定写代码。

## 仓库结构

```
tiller/
  server/                 Go 单二进制：托管前端 + 反代 PVE
    go.mod                module tiller/server（Go 1.25+）
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

浏览器 → Tiller 管理员会话 → Go 服务 → 选定 PVE 的账号密码会话或 API Token。

- `newAppHandler` 是生产入口；所有实例目录、PVE API 和 WebSocket 经 `localAuth.guard` 验证，文档和静态文件可匿名读取。低层代理测试使用 `NewHandler`，生产不调用这个无本地认证的测试入口。
- 首次访问通过 `/api/auth/setup` 创建唯一管理员；已有账户时拒绝再次设置。账户原子持久化，损坏文件或丢失密钥会阻止启动，不回退到未初始化状态。
- `/api/auth/login`、`session`、`logout`、`password` 管理独立 Tiller 会话。密码哈希为 PBKDF2-HMAC-SHA256/600,000，16 字节随机盐；Cookie 为 256 位随机会话 ID，HttpOnly、SameSite=Strict，8 小时绝对期限。服务端只在内存保存会话，重启需重新登录。
- 写请求校验会话 CSRF；WebSocket 和跨站写请求仍用 `sameOrigin`。会话 Context 在退出、改密或过期时取消，同时终止正在执行的请求和控制台。改密撤销所有会话。

### 多实例导航

- `/api2/tiller/instances` 是管理员专用 CRUD。每个实例保存名称、地址、TLS 设置、认证方式、PVE 用户名/认证域或 Token ID，以及密码/Secret 的密文；密钥在 `TILLER_AUTH_FILE + ".key"` 中。AES-256-GCM 的附加认证数据绑定实例 ID 和版本，密码另加用途前缀。API 不返回密文、PVE 密码或 Token Secret。既有未设置 authMode 的 Token 记录继续兼容。
- 页面 `/i/<id>/<version>/…` 对应 API `/api/instances/<id>/<version>/api2/json/…`，id/version 为随机 96 位标识。每个实例有独立 transport，删除浏览器 Cookie/Authorization/CSRF，并注入该实例的票据/PVE CSRF 或 Token Authorization。上游 401 映射为连接错误，不退出 Tiller。
- `passwordTransport` 在请求时复用服务端票据，超过一小时尝试续期，过期后用保存的密码登录；并发请求共享一次认证，认证错误退避。意外 401 只自动重试一次无请求体的 GET/HEAD，不重放写请求。登录使用固定实例的 TLS 配置且不跟随跳转，TFA 未完成的票据不会被接受。新密码在保存前验证，网络等待不持有实例目录锁。
- 更新地址、TLS、认证方式或账户时要求重新填写密码/Secret 并轮换 version。旧 API 返回 409，不能把旧页面的操作送到新目标。实例文件原子写入，0600 权限，一个目录只运行一个写入进程。
- 首页跳转到上次使用的有效实例（以目录中的最新 version 为准），否则进入第一个已配置凭据的实例；无可用实例时进入实例管理。桌面资源树以实例为根，分支查询、标签样式和折叠键包含 id/version；同名节点/VMID 不合并。当前分支复用页面资源查询，其他展开分支每 10 秒刷新，错误独立提示。
- 单实例页面从 URL 固定范围；切换整页导航，清理旧缓存、任务和控制台。资源树跨实例读取显式传入不可变的 instance 参数；资源操作通过对应实例详情完成，不使用可变的全局请求目标。
- 管理员会话和资源树分组偏好跨实例共享；树的折叠状态及其他实例资源偏好按 id/version 分开。PVE 权限界面通过 `usePveIdentity` 读取选中实例的身份，不使用 Tiller 管理员用户名。旧 PVE 浏览器 Cookie 不被生产入口接受。升级后的旧连接只保留地址/TLS，需补充账号密码或 API Token。

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
- 实验环境：192.168.0.5 上的 3 节点嵌套 PVE 集群（VM 9901–9903），所有写操作测试都对它做。连接信息存在测试服务器 `~/.config/pve-web/lab.env`（不入库），详见 docs/LAB.md。
- 重负载命令（npm install、构建、测试、dev server）一律通过 `rt -- <cmd>` 在测试服务器 192.168.0.32 上执行。
