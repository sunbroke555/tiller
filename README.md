# Tiller

> Tiller（舵柄）：手机上也能稳稳掌舵你的 Proxmox VE。

基于 Proxmox VE 官方 API 的新 WebUI：手机优先、操作简便，目标是覆盖官方界面的全部功能。

- 前端：React 19 + Vite + TypeScript（strict）+ Tailwind CSS v4 + shadcn/ui + TanStack Query + React Router 7
- 服务端：Go 单二进制，内嵌前端，把 `/api2/` 原样反代到 PVE（含 VNC / 终端的 websocket）
- 主题：暗色玻璃、浅色玻璃、纸质（Claude 配色）、跟随系统；强调色、玻璃质感、列表密度可调

架构约定见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 使用文档

运行 Tiller 后，访问同一地址的 **`/docs/`**，或点击登录页 / 账户菜单里的「使用文档」。文档无需登录，随程序内嵌发布，支持中文本地搜索、章节导航、手机目录和深浅色切换。

文档源码在 [doc/index.md](doc/index.md)，包含安装配置、首次登录、客户机、存储与备份、控制台、节点与数据中心、权限及常见问题。`docs/` 仍存放开发资料，不会发布到用户文档站。

```sh
make docs          # 只构建文档 → doc/.vitepress/dist
make docs-dev      # 文档热更新：http://localhost:5174/docs/
make server        # 构建并内嵌管理界面 + 文档
make test-docs     # 桌面 / 手机文档测试，不连接 PVE
```

`make dev` 会预先构建文档，并通过 Vite 转发 `/docs/` 到 Go 服务。编辑文档时可单独使用 `make docs-dev` 获得热更新。

## 快速开始

### Docker 部署

仓库的 GitHub Actions 自动构建 `linux/amd64` 和 `linux/arm64` 镜像并发布到 `ghcr.io/sunbroke555/tiller`。`latest` 跟随 `main`，`v1.2.3` 等 Git 标签生成 `1.2.3` 和 `1.2` 镜像标签。

完整操作见 [Docker 部署教程](doc/guide/docker.md)，包括 Compose 配置、访问方式、首次登录、更新、备份恢复和从源码构建镜像。

使用仓库的 [compose.yaml](compose.yaml)，在同目录创建不入库的 `.env`：

```dotenv
PVE_URL=https://pve.example.internal:8006
PVE_TLS_FINGERPRINT=替换为完整的SHA256证书指纹
```

```sh
docker compose up -d
```

支持独立 Tiller 管理员的版本可以不创建 `.env`，首次登录后从页面添加 PVE。直接使用 PVE 账号登录的旧版镜像需要预设上面的连接信息；以实际镜像版本的登录页为准。

默认端口只发布到宿主机的 `127.0.0.1:8080`，供同机 HTTPS 反向代理访问。浏览器通过代理的 HTTPS 地址使用 Tiller，文档位于 `/docs/`。代理在其他容器或主机上时，按实际拓扑调整端口 / 网络和 `TRUSTED_PROXIES`。连接元数据保存在 `tiller-data` 数据卷中。

更新镜像：`docker compose pull && docker compose up -d`。镜像公开，无需登录 GHCR 即可拉取；更新前请按教程备份数据卷。

### 从源码运行

需要 Git、Go 1.25+、Node.js 22.12+（含 npm）、make 和 Bash。

```sh
git clone https://github.com/sunbroke555/tiller.git
cd tiller
make server
```

构建自动下载依赖，产物为 `server/tiller`，已内嵌管理界面和文档。默认生成当前操作系统和处理器架构的程序；运行主机无需安装 Go 或 Node.js，构建时无需连接 PVE。

登录和添加连接会传输管理员密码、PVE 密码或 API Token，**对外提供服务时一定要用 HTTPS**：让 Tiller 自己带证书，或者放在 TLS 反向代理后面。

将下面的 PVE 地址、证书指纹和 HTTPS 证书路径替换为自己的配置：

```sh
PVE_URL=https://pve.example.internal:8006 \
PVE_TLS_FINGERPRINT='<PVE 证书的完整 SHA-256 指纹>' \
TLS_CERT_FILE=/etc/tiller/cert.pem \
TLS_KEY_FILE=/etc/tiller/key.pem \
LISTEN=:8443 \
./server/tiller
```

浏览器打开 `https://<主机>:8443`，首次设置 Tiller 管理员用户名和密码，再添加各 PVE 的账号密码或 API Token。

- 用 Caddy / nginx 等做 TLS 时，让 Tiller 只听本机（`LISTEN=127.0.0.1:8080`），并把代理地址写进 `TRUSTED_PROXIES`，这样登录限速和日志看到的是真实客户端地址。
- 不带证书又监听非本机地址时，Tiller 仍会启动（局域网实验用），但启动日志会醒目警告：管理员密码、PVE 密码和 API Token 以明文在网络上传输。

### 配置（环境变量）

| 变量 | 说明 |
| --- | --- |
| `PVE_URL` | 可选的初始连接地址；首次启动时导入为待配置凭据的实例，不设置时全部从页面添加 |
| `PVE_NAME` | 初始导入连接的名称，默认「默认 PVE」 |
| `TILLER_AUTH_FILE` | 管理员密码哈希文件，默认 `tiller-auth.json`；同路径的 `.key` 文件用于加密实例凭据 |
| `TILLER_INSTANCES_FILE` | 页面管理的附加实例配置文件，默认工作目录下的 `tiller-instances.json`；目录需要可写，容器中应放在持久化卷内 |
| `LISTEN` | 监听地址，默认 `:8080` |
| `PVE_TLS_FINGERPRINT` | 固定信任 PVE 叶子证书的 SHA-256 指纹（冒号分隔或纯十六进制）。在 PVE 上用 `pvenode cert info` 或界面的“证书”查看 |
| `PVE_INSECURE_TLS=1` | 不校验 PVE 证书，仅限实验环境。与指纹二选一 |
| `PVE_CA_FILE` | 用指定 CA（如 `/etc/pve/pve-root-ca.pem` 的副本）校验 PVE 证书 |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | 让 Tiller 自己提供 HTTPS（推荐）。手机安装 PWA（离线外壳、主屏图标）也需要 HTTPS |
| `ALLOW_FROM` | 只允许这些客户端访问（逗号分隔的 IP / 网段，如 `192.168.0.0/24,10.8.0.5`；本机地址总是允许）。Tiller 在 PVE 前面时，pveproxy 自己的 `ALLOW_FROM` 只能看到 Tiller 的地址 |
| `TRUSTED_PROXIES` | Tiller 前面的反向代理地址（IP / 网段）；只信任它们带来的 `X-Forwarded-For` |
| `WEB_DIR` | 从磁盘目录提供前端而不是内嵌版本（调试用） |

### 管理员登录与多实例导航

首次打开页面设置 Tiller 管理员用户名和密码，无通用默认密码。后续只需登录 Tiller，一次查看和管理全部实例；「管理员账户」支持修改密码，改密会撤销所有已登录会话。

在「管理实例」中添加 PVE 地址和证书设置，默认使用 PVE 账号密码及认证域，也可选择 API Token。账号密码保存前会验证登录，后台自动维护会话；需要交互式两步验证的 PVE 账户请选择 Token。登录后直接进入上次使用的实例，首次使用进入第一个已配置凭据的实例。电脑侧边栏按「实例 → 节点 → 资源」展示所有 PVE，支持跨实例过滤及按资源池、标签分组。连接异常只在对应分支提示；同名节点和 VMID 按实例区分。点击资源进入对应实例的详情和控制台，手机通过顶部实例选择器切换。

最多保存 64 个连接，同一集群只添加一次。所有连接可在页面编辑或删除；删除不会操作 PVE 资源。PVE 用户及 API Token 的权限由 PVE 控制，Tiller 管理员账户不会绕过它。

服务端保存管理员密码哈希，以及加密的 PVE 密码或 Token Secret；不会向浏览器返回这些凭据。备份 `TILLER_AUTH_FILE`、同路径 `.key` 及 `TILLER_INSTANCES_FILE` 三个文件；一个数据目录由一个进程写入。Compose 已把它们放在 `tiller-data` 数据卷中。详情见[首次设置](doc/guide/first-run.md)和[多实例连接](doc/guide/configuration.md#多实例连接)。

安全相关行为：

- 所有实例目录与 PVE API 都需要 Tiller 管理员会话。会话 Cookie 为 HttpOnly、SameSite=Strict，写请求校验 CSRF，WebSocket 校验 Origin。会话最长 8 小时，重启需重新登录。
- 管理员密码采用随机盐与 PBKDF2-HMAC-SHA256（600,000 次迭代）；PVE 密码及 Token Secret 使用 AES-256-GCM 加密并绑定实例及连接版本。配置与密钥文件权限为 `0600`，API 不返回保存的凭据。
- 登录失败限速并记录客户端地址，不记录密码、Cookie 或 Token。退出登录和修改密码也会关闭对应会话的活动控制台。
- 代理只向选中 PVE 注入它自己的票据/PVE CSRF 或 API Token，剥离浏览器 Cookie 和管理员 CSRF。更换连接目标、证书、认证方式或凭据时轮换 URL 版本，旧链接不会改为访问新目标。
- 只转发 JSON API（含 WebSocket），API 响应设置隔离 CSP。`ALLOW_FROM` 限制客户端范围，`TRUSTED_PROXIES` 指定可信反向代理。

## 开发

### GitHub 自动化

- [Docker image](.github/workflows/build.yml)：PR 和 `main` / `v*` 标签推送时构建包含管理界面和文档的双架构镜像；PR 仅构建，`main` / 版本标签发布到 GHCR。默认使用工作流自带的 `GITHUB_TOKEN`，无需填写 Docker Hub 密码。
- [Documentation](.github/workflows/docs.yml)：文档变更合并到 `main` 时，自动发布 GitHub Pages。仓库的 Settings → Pages → Build and deployment 选择 **GitHub Actions**。也可以在 Actions 中手动运行该工作流。
- 文档默认构建在 `/docs/` 供 Tiller 内嵌；Pages 工作流自动设置站点子路径和项目主页入口。仅发布 `doc/`，开发用的 `docs/` 不进入文档站。

GitHub Actions 只负责构建和发布，不重复运行 Go 单元测试、Vitest、Playwright 或独立的静态检查；前端构建仍包含 TypeScript 编译检查。发布前运行 `make test`、`make test-docs` 及相应功能的端到端测试。工作流不需要连接 PVE，也不需要上传实验环境的密码或 SSH 密钥。

### 本地开发命令

```sh
make dev       # Go 服务（-tags dev，前端读 web/dist）+ Vite dev server（:5173，HMR，/api2 代理到 :8080）
make test      # go vet + go test、Python 单元测试、Vitest、TypeScript 类型检查
make web       # 构建管理界面和文档到 web/dist
make clean
```

`make dev` 启动后访问 `http://localhost:5173`，在页面完成管理员设置并添加 PVE 连接。需要操作 PVE 的开发验证应使用独立的实验环境。

### 测试

- `make test`：Go、前端和 SMART 采集器的单元测试及静态检查，需要 Python 3，无需连接 PVE。
- `make test-docs`：使用 Playwright 检查文档的桌面和手机布局、导航及搜索，无需连接 PVE；首次运行会安装 Chromium，系统还需具备它的运行依赖。
- PVE 端到端测试需要专门准备实验集群、测试账号及样例资源。维护者的环境配置见 [docs/LAB.md](docs/LAB.md)，功能区测试流程见 [docs/CONTRIBUTING-AREAS.md](docs/CONTRIBUTING-AREAS.md)。

## 目录

```
server/            Go 服务：config.go 配置、proxy.go 反代、static.go 前端托管、main.go 入口
web/src/api/       client.ts（请求、CSRF、表单编码、PveApiError、401 处理）、local-auth.ts（管理员设置、登录、改密）、
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
scripts/e2e-server.sh  为 e2e 启停连接实验机的 Tiller
scripts/e2e-area.sh    area id → e2e spec 文件（make e2e-area 用）
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

> Tiller 是独立项目，与 Proxmox Server Solutions GmbH 无关。Proxmox 是其注册商标。
