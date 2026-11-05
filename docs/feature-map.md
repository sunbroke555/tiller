# PVE 官方 WebUI 功能覆盖表（feature-map）

本文是本项目要覆盖的**官方 Proxmox VE WebUI 全部功能**清单，并把每个功能对应到 API 端点，作为后续各功能区开发、验收的依据。

- 依据版本：生产主机 192.168.0.6 上的 `pve-manager 9.2.21`（proxmox-ve 9.2.0，内核 7.0.14-24-pve）。
- 来源（只读获取）：
  - `/usr/share/pve-manager/js/pvemanagerlib.js`：官方 UI 源码，用来确认每个面板、编辑窗口、调用的 URL 和参数。
  - `/usr/share/javascript/proxmox-widget-toolkit/proxmoxlib.js`：共享组件，包括 TFA、ACME、网络、磁盘、任务、APT、通知。
  - `/usr/share/pve-docs/api-viewer/apidoc.js`：完整 API schema，和 `pvesh usage <path> -v` 同源。用来校验本表中每个端点都存在，并统计覆盖率。
- 机器可读版本：`docs/feature-map.json`（area → features → endpoints），和本文由同一份数据生成，内容一致。
- 端点写法：`METHOD /path`。路径参数用 `{node}`、`{vmid}` 等表示，与 API schema 一致。实际请求统一加 `/api2/json` 前缀。

## Phase 定义

| Phase | 范围 |
|---|---|
| **1** | 日常运维核心：登录/TFA、总览、VM/CT 电源 + 控制台 + RRD 图 + 配置编辑 + 快照 + 立即备份/恢复 + 创建向导、存储浏览/上传/URL 下载/模板、任务与日志、节点摘要 + Shell + 服务 |
| **2** | 节点系统（网络、DNS/Hosts/时间/选项、证书）、磁盘、更新与软件源、防火墙、复制、备份任务、存储配置 |
| **3** | 数据中心管理：权限、HA、SDN、Ceph、ACME、集群、通知、指标、资源映射、选项、订阅 |

## 本表中做出的决定

用户休息期间未作询问，下列决定由本文先行确定，后续可调整：

1. **存储配置（数据中心 → Storage）放在 Phase 2**。它和节点“磁盘 → 创建 LVM/ZFS/目录并添加存储”是同一类工作，而且存储浏览（P1）只依赖已有的存储定义。
2. **ACME 账户和插件与节点证书合并为 `certificates-acme`，放在 Phase 2**。节点申请证书必须先有 ACME 账户和插件，拆开后两部分都无法单独验收。数据中心的 ACME 页面同属这个 area。
3. **批量操作并入 `guest-lifecycle`，放在 Phase 1**。批量迁移和单个迁移共用目标节点选择与前置检查，节点批量启动/关机属于日常运维。
4. **订阅（节点 Subscription、数据中心 Support）并入 `dc-options`，放在 Phase 3**。总览里的订阅级别只读展示仍属于 P1 `overview`。
5. **界面只做中文**（遵循 ARCHITECTURE.md），不实现官方的多语言切换。
6. **控制台优先使用 xterm.js（CT、节点 Shell、串口）和 noVNC（VM 图形）**。SPICE 只提供 .vv 文件下载，手机端优先级低。
7. **登录前的同意横幅（consent-text）由 Go 服务抓取 PVE 首页中注入的 `ConsentText` 后提供**。官方 UI 从 index.html 注入，未登录时 API 读不到。如果实现成本高，可退化为登录后再显示。
8. **官方 UI 未使用的接口默认不实现**，见附录 B，包括 remote_migrate、agent exec/file-write、`/nodes/{node}/execute`、`pvecm delnode` 对应接口、存储卷复制等。Guest Agent 的写操作（exec、设密码）即使以后实现，也排在最后，并要求二次确认。
9. **HA 组（/cluster/ha/groups）在 9.x 已废弃**，改用 HA 规则。本项目只读展示旧组，不提供新建。
10. **所有对生产 PVE 的测试只读**。写操作只针对实验集群（192.168.0.5 上的嵌套 PVE），见 docs/LAB.md。

## 0. 实现区域（area）一览

每个 area 可由一名工程师独立实现；`docs/feature-map.json` 与本表同源生成。

| area id | 名称 | Phase | 路由 | 功能数 | 范围 |
|---|---|---|---|---|---|
| `auth` | 登录与会话（含 TFA / OpenID） | 1 | `/login` | 11 | 登录页、两步验证、OpenID 回调、ticket 续签、登出、改密码、自助管理自己的 TFA、能力表(caps)获取。 |
| `app-shell` | 应用框架（导航 / 资源树 / 搜索 / 任务条 / 偏好） | 1 | `/` | 10 | 全局布局、资源树、命令面板搜索、底部任务进度条、主题与个人偏好、标签样式渲染、权限门控。 |
| `overview` | 总览（数据中心摘要 / 列表 / 池浏览） | 1 | `/overview` | 10 | 数据中心 Summary（健康、客户机计数、资源、节点、订阅）、节点/客户机/存储列表、数据中心备注、资源池浏览。 |
| `tasks-logs` | 任务与日志 | 1 | `/tasks` | 5 | 集群任务列表、节点任务历史、任务详情（实时日志/停止/下载）、集群日志。 |
| `node-summary` | 节点摘要 / 服务 / 系统日志 | 1 | `/nodes/:node` | 11 | 节点状态与 RRD 图、重启关机、备注、服务管理、journal、包版本、系统报告、WOL。 |
| `console` | 控制台（noVNC / xterm.js / SPICE） | 1 | `/console` | 7 | VM/CT 控制台、节点 Shell、串口终端、SPICE .vv 下载、发送按键。依赖 Go 反代 websocket。 |
| `guest-summary-power` | 客户机摘要与电源 | 1 | `/nodes/:node/:type/:vmid` | 13 | VM/CT Summary：状态、RRD 图、IP、备注、标签；电源操作 start/shutdown/stop/reboot/reset/suspend/hibernate/resume。 |
| `qemu-config` | VM 配置（硬件 / Cloud-Init / 选项 / Monitor） | 1 | `/nodes/:node/qemu/:vmid/hardware` | 29 | QEMU 硬件全部设备类型的增删改、磁盘动作、pending/revert、Cloud-Init、Options、Monitor。 |
| `lxc-config` | CT 配置（资源 / 网络 / DNS / 选项） | 1 | `/nodes/:node/lxc/:vmid/resources` | 10 | LXC Resources（内存/交换/CPU/根盘/挂载点/设备直通）、Network、DNS、Options。 |
| `guest-snapshots-backup` | 快照、立即备份与恢复 | 1 | `/nodes/:node/:type/:vmid/snapshots` | 7 | 快照树（创建/回滚/删除/编辑描述）、客户机 Backup 页（立即备份、备份列表、恢复、显示配置）、从备份恢复窗口。 |
| `guest-create` | 创建向导（VM / CT） | 1 | `/create/:type` | 15 | QEMU 创建向导全部步骤、LXC 创建向导全部步骤、VMID 建议。 |
| `guest-lifecycle` | 客户机生命周期与批量操作 | 1 | `/nodes/:node/:type/:vmid` | 12 | 迁移、克隆、转模板、删除、保护、HA 快捷加入；数据中心/节点批量启动/关机/挂起/迁移。 |
| `storage-browser` | 存储浏览（内容 / 上传 / 下载 / 模板 / 导入） | 1 | `/nodes/:node/storage/:storage` | 15 | 存储 Summary 与 RRD、按类型浏览内容、上传、URL 下载、CT 模板目录、OCI 拉取、删除/备注/保护、Prune、文件级恢复、Import 向导。 |
| `node-network` | 节点网络 | 2 | `/nodes/:node/network` | 5 | 网卡/网桥/Bond/VLAN/OVS 增删改，待应用差异、应用（ifreload）与还原。 |
| `node-system` | 节点系统设置（DNS / Hosts / 时间 / 选项） | 2 | `/nodes/:node/system` | 4 | DNS、/etc/hosts、时区、节点 Options（WOL、开机启动延迟、balloon 目标、位置）。 |
| `certificates-acme` | 证书与 ACME | 2 | `/nodes/:node/certificates` | 6 | 节点证书查看、上传自定义证书、ACME 域名配置与申请/续期/吊销；数据中心 ACME 账户与插件（DNS challenge）。 |
| `node-updates` | 更新与软件源 | 2 | `/nodes/:node/updates` | 5 | apt 刷新、可升级包列表、changelog、通过 Shell 升级、软件源启用/禁用/添加标准源。 |
| `node-disks` | 磁盘管理 | 2 | `/nodes/:node/disks` | 8 | 磁盘列表、SMART、初始化 GPT、擦除、LVM / LVM-Thin / Directory / ZFS 创建与删除。 |
| `storage-config` | 存储配置（数据中心 Storage） | 2 | `/datacenter/storage` | 4 | 存储定义的增删改（全部 14 种类型）及其扫描辅助（NFS/CIFS/iSCSI/LVM/ZFS/PBS）。 |
| `firewall` | 防火墙（数据中心 / 节点 / 客户机 / VNet） | 2 | `/datacenter/firewall` | 8 | 通用规则编辑器、选项、安全组、别名、IPSet、日志；同一组件复用于四个层级。 |
| `replication` | 存储复制 | 2 | `/datacenter/replication` | 4 | 复制任务增删改、立即同步、状态与日志（数据中心/节点/客户机三处视图）。 |
| `backup-jobs` | 备份任务（计划） | 2 | `/datacenter/backup` | 7 | 计划备份任务增删改、立即运行、任务详情（包含的卷）、未备份客户机、计划模拟器。 |
| `access-users` | 用户 / API Token / TFA / 组 | 3 | `/datacenter/permissions/users` | 4 | 用户、API Token、全体用户 TFA 管理、组、查看有效权限。 |
| `access-control` | 角色 / 权限(ACL) / 认证域 / 同步 / 资源池 | 3 | `/datacenter/permissions` | 12 | ACL 增删、角色、认证域（PAM/PVE/LDAP/AD/OpenID）、域同步与同步任务、资源池管理。 |
| `ha` | 高可用 HA | 3 | `/datacenter/ha` | 6 | HA 状态、Arm/Disarm、HA 资源、节点亲和/资源亲和规则、旧 HA 组（已废弃）、Fencing、CRS 设置。 |
| `sdn` | SDN（Zone / VNet / Subnet / Controller / IPAM / DNS） | 3 | `/datacenter/sdn` | 7 | SDN 状态、Zones、VNets、Subnets、Options（Controller/IPAM/DNS）、IPAM 视图、应用/锁/回滚/差异、节点 Zone 浏览。 |
| `sdn-fabrics` | SDN Fabrics / Route Maps / Prefix Lists | 3 | `/datacenter/sdn/fabrics` | 4 | OpenFabric/OSPF/WireGuard/BGP Fabric 与节点、路由表/邻居/接口视图、Route Map、Prefix List、EVPN VRF 视图。 |
| `ceph` | Ceph | 3 | `/datacenter/ceph` | 13 | Ceph 状态、安装向导、配置、Monitor/Manager/MDS、OSD、CephFS、Pools、CRUSH、日志、Flags、健康静默、批量重启。 |
| `cluster` | 集群 | 3 | `/datacenter/cluster` | 6 | 创建集群、加入信息、加入集群、节点列表、Corosync links、QDevice/Totem 信息。 |
| `notifications-metrics` | 通知与指标服务器 | 3 | `/datacenter/notifications` | 4 | 通知目标（sendmail/SMTP/Gotify/Webhook）、匹配器、测试；外部指标服务器（InfluxDB/Graphite/OpenTelemetry）。 |
| `resource-mappings` | 资源映射与自定义 CPU | 3 | `/datacenter/mappings` | 4 | PCI/USB/目录(virtiofs) 集群映射、自定义 CPU 型号。 |
| `dc-options` | 数据中心选项 / 标签 / 订阅与支持 | 3 | `/datacenter/options` | 5 | 数据中心 Options 全部条目（含标签样式、用户标签权限、注册标签）、节点订阅、Support 页。 |

合计 32 个 area、271 个功能；API 端点 680 个，已映射 661 个，未映射的见附录 B。

## 1. 全局 UI 功能

### 1.1 登录、会话与账户

- **认证域下拉** · `auth/realm-list` · P1
  - 用户操作：登录页列出可选 realm（pam / pve / ldap / ad / openid），默认选中标记为 default 的域；OpenID 域切换为“跳转登录”按钮。
  - API：`GET /access/domains`
  - 要点：匿名可读。返回 realm、type、comment、default、tfa。OpenID 域 type=openid。
- **用户名密码登录** · `auth/login` · P1
  - 用户操作：输入用户名、密码、realm 登录，可选“记住用户名”。
  - API：`POST /access/ticket`
  - 要点：参数 username、password、realm（也可写成 user@realm）。返回 ticket、CSRFPreventionToken、username、clustername、cap（能力表：vms/storage/nodes/dc/access/sdn/mapping → 权限名:1），UI 用 cap 决定按钮显隐。ticket 写入 cookie PVEAuthCookie。
- **两步验证登录** · `auth/tfa-login` · P1
  - 用户操作：密码通过后若需 TFA，弹出第二步：TOTP、恢复码、WebAuthn（安全密钥/通行密钥）、Yubico OTP（旧 U2F 仅兼容）。
  - API：`POST /access/ticket`
  - 要点：首次返回 data.NeedTFA=1，ticket 以 `PVE:!tfa!` 开头，ticket 内含可用类型（totp/recovery/webauthn/yubico/u2f）及 WebAuthn challenge。第二次请求：username、tfa-challenge=<上次 ticket>、password=`totp:<6位>` | `recovery:<key>` | `webauthn:<JSON 断言>` | `yubico:<otp>` | `u2f:<JSON>`。WebAuthn 需要可信证书且 origin 与数据中心 webauthn 设置一致；剩余恢复码少时返回提示。
- **OpenID Connect 登录** · `auth/openid-login` · P1
  - 用户操作：选择 OpenID 域后跳转到 IdP，回调后自动完成登录。
  - API：`POST /access/openid/auth-url`；`POST /access/openid/login`
  - 要点：auth-url 参数 realm、redirect-url（必须是本应用的 origin，PVE 会校验）；回调带 code、state，再 POST /access/openid/login（code、state、redirect-url）拿 ticket。
- **登录前同意横幅** · `auth/consent-banner` · P1
  - 用户操作：数据中心配置了 consent-text 时，登录前先弹出 Markdown 同意书，必须确认。
  - API：`GET /cluster/options`
  - 要点：官方 UI 由 PVE 的 index.html 注入（base64 的 Proxmox.ConsentText），未登录时 API 读不到。决定：Go 服务启动/定时抓取 PVE 首页提取 ConsentText，提供给登录页（只读、无凭据）。登录后可从 /cluster/options 的 consent-text 读到原文。
- **会话续签** · `auth/ticket-renew` · P1
  - 用户操作：登录态自动续期，ticket 2 小时过期前刷新；401 时回到登录页。
  - API：`POST /access/ticket`
  - 要点：username + password=<当前 ticket>。官方每 15 分钟续签一次。
- **登出** · `auth/logout` · P1
  - 用户操作：清除 cookie 和本地 CSRF/用户名。
  - API：无（纯前端）
  - 要点：PVE 的 ticket 无服务端会话，登出只是本地清理。
- **修改自己的密码** · `auth/change-password` · P1
  - 用户操作：用户菜单 → 修改密码（pve/pam 域）。
  - API：`PUT /access/password`
  - 要点：参数 userid、password、confirmation-password（执行修改者自己的当前密码，官方 UI 要求填写）。
- **管理自己的 TFA** · `auth/my-tfa` · P1
  - 用户操作：列出/添加/启停/删除自己的 TOTP、WebAuthn、恢复码、Yubico；添加 TOTP 显示二维码。
  - API：`GET /access/tfa/{userid}`；`POST /access/tfa/{userid}`；`GET /access/tfa/{userid}/{id}`；`PUT /access/tfa/{userid}/{id}`；`DELETE /access/tfa/{userid}/{id}`
  - 要点：POST 参数 type=totp|webauthn|recovery|yubico、description、totp（otpauth:// URI）、value（验证码 / WebAuthn 注册响应）、challenge、password（当前密码确认）。WebAuthn 注册分两步：先不带 value 拿 challenge，再带 navigator.credentials.create 的结果。recovery 只能有一组，返回的恢复码仅展示一次。
- **我的有效权限** · `auth/own-permissions` · P1
  - 用户操作：查看当前用户在各路径上的有效权限（用户菜单 → Permissions），也用于细粒度门控。
  - API：`GET /access/permissions`
  - 要点：可带 path、userid（查他人需要权限）。
- **版本信息** · `auth/version` · P1
  - 用户操作：显示 PVE 版本，判断功能可用性。
  - API：`GET /version`
  - 要点：返回 version、release、repoid、console（默认控制台）。

### 1.2 应用框架：资源树 / 搜索 / 任务条 / 偏好

- **资源树 / 资源列表** · `app-shell/resource-tree` · P1
  - 用户操作：按 数据中心 → 节点 → 客户机/存储/SDN Zone/Fabric 展示，或按资源池、标签分组；状态点、模板、HA、锁、标签显示。
  - API：`GET /cluster/resources`
  - 要点：可选 type=vm|storage|node|sdn。条目 id 形如 qemu/100、lxc/101、node/pve、storage/pve/local、pool/xx、sdn/pve/zone、network/...。字段：status、name、node、vmid、template、tags、pool、hastate、lock、cpu/maxcpu、mem/maxmem、disk/maxdisk、netin/netout、diskread/diskwrite、uptime、plugintype、content、shared、network-type。前端轮询（官方 3s），Tree 设置（按类型分组/模板分组/嵌套池/排序）本地保存。
- **全局搜索 / 命令面板** · `app-shell/global-search` · P1
  - 用户操作：Ctrl/⌘K 搜索 VMID、名称、节点、标签、池、类型，直接跳转或执行动作。
  - API：`GET /cluster/resources`
  - 要点：纯前端过滤，与资源树共享缓存。
- **运行中任务条** · `app-shell/task-bar` · P1
  - 用户操作：底部显示当前用户/全集群运行中与最近任务，点击打开任务日志。
  - API：`GET /cluster/tasks`
  - 要点：官方每 15s 刷新；返回 upid、node、type、id、user、starttime、endtime、status（结束后为 OK 或错误文本）。
- **集群状态（法定人数/在线节点）** · `app-shell/cluster-status` · P1
  - 用户操作：顶部显示集群名、quorate、节点在线情况，用于离线节点置灰。
  - API：`GET /cluster/status`
  - 要点：type=cluster（name、quorate、nodes、version）与 type=node（name、online、local、ip、level=订阅级别）。单机无 cluster 条目。
- **全局 UI 选项** · `app-shell/ui-options` · P1
  - 用户操作：读取数据中心默认控制台类型、标签样式（形状/排序/大小写/颜色覆盖）、用户可设标签权限、注册标签，用于渲染与编辑限制。
  - API：`GET /cluster/options`
  - 要点：tag-style 例：`color-map=tag:FFFFFF:000000;...,shape=circle,ordering=config,case-sensitive=0`。
- **我的设置（本地）** · `app-shell/my-settings` · P1
  - 用户操作：主题（暗/浅/纸）、强调色、玻璃开关、列表密度、控制台缩放、xterm 字体、摘要卡片、保存的用户名、清除本地设置。
  - API：无（纯前端）
  - 要点：全部存 localStorage，不调 API。官方 My Settings 中的 Dashboard Storages、noVNC 缩放、xterm 字体同理。
- **界面语言** · `app-shell/language` · P1
  - 用户操作：官方支持 27 种语言（PVELangCookie）。本项目界面固定中文，不做多语言（决定）。
  - API：无（纯前端）
  - 要点：仅记录：数据中心 language 选项为默认语言。
- **Markdown 备注渲染** · `app-shell/markdown-notes` · P1
  - 用户操作：数据中心/节点/客户机/资源池备注统一用 Markdown 渲染与编辑（安全过滤 HTML）。
  - API：无（纯前端）
  - 要点：通用组件；具体读写见各处 notes 功能（description 字段）。

### 1.3 任务与日志

- **集群任务列表** · `tasks-logs/cluster-tasks` · P1
  - 用户操作：查看全集群最近任务（含运行中），按状态/类型/用户筛选。
  - API：`GET /cluster/tasks`
- **任务详情 / 实时日志** · `tasks-logs/task-viewer` · P1
  - 用户操作：打开任意 UPID：状态、耗时、退出状态、实时滚动日志、下载完整日志、停止任务。
  - API：`GET /nodes/{node}/tasks/{upid}`；`GET /nodes/{node}/tasks/{upid}/status`；`GET /nodes/{node}/tasks/{upid}/log`；`DELETE /nodes/{node}/tasks/{upid}`
  - 要点：UPID 格式 `UPID:<node>:<pid hex>:<pstart hex>:<starttime hex>:<type>:<id>:<user>:`，node 从 UPID 解析；路径中需 encodeURIComponent。log 参数 start、limit（分页，返回 {n,t}），download=1 下载全文。status 返回 status=running|stopped、exitstatus（OK / 错误 / WARNINGS: n）。DELETE 即停止。
- **节点/客户机任务历史** · `tasks-logs/node-tasks` · P1
  - 用户操作：节点 → Task History、客户机 → Task History：分页列出历史任务，可按类型、用户、状态、仅错误、时间段过滤。
  - API：`GET /nodes/{node}/tasks`
  - 要点：参数 start、limit、vmid、typefilter、userfilter、statusfilter、errors、since、until、source=archive|active|all。返回 total 用于分页。
- **集群日志** · `tasks-logs/cluster-log` · P1
  - 用户操作：数据中心 Summary 下方的集群日志（pmxcfs 日志），实时滚动。
  - API：`GET /cluster/log`
  - 要点：参数 max。
- **任务类型中文描述** · `tasks-logs/task-type-names` · P1
  - 用户操作：把 qmstart、vzdump、qmigrate、aptupdate 等任务类型映射成可读文字。
  - API：无（纯前端）
  - 要点：官方在 Proxmox.Utils.task_desc_table 里维护，前端本地映射表。

## 2. 数据中心（Datacenter）

### 2.1 Summary / Notes / 列表

- **数据中心健康** · `overview/dc-health` · P1
  - 用户操作：显示集群法定人数、在线/离线节点数、Ceph 健康（若安装）。
  - API：`GET /cluster/status`；`GET /cluster/ceph/status`
  - 要点：Ceph 未安装时请求会报错，需容错。
- **客户机统计** · `overview/dc-guests` · P1
  - 用户操作：按 VM/CT 统计 运行/停止/模板 数量，点击跳到筛选后的列表。
  - API：`GET /cluster/resources`
- **集群资源用量** · `overview/dc-resources` · P1
  - 用户操作：集群 CPU、内存、存储总用量（存储可在设置里选择计入哪些）。
  - API：`GET /cluster/resources`
  - 要点：共享存储只计一次（按 storage id 去重）。
- **节点列表** · `overview/dc-nodes` · P1
  - 用户操作：节点名、在线、CPU/内存用量、uptime、IP、订阅级别，点击进入节点。
  - API：`GET /nodes`；`GET /cluster/status`
- **订阅概览** · `overview/dc-subscriptions` · P1
  - 用户操作：汇总各节点订阅级别（无订阅/社区/基础/标准/高级）。
  - API：`GET /cluster/status`
  - 要点：type=node 条目的 level 字段（c/b/s/p 或空）。
- **数据中心备注** · `overview/dc-notes` · P1
  - 用户操作：查看/编辑数据中心 Notes（Markdown）。
  - API：`GET /cluster/options`；`PUT /cluster/options`
  - 要点：字段 description。需要 Sys.Modify。
- **客户机列表** · `overview/guest-list` · P1
  - 用户操作：全部 VM/CT 列表（手机主页），排序筛选（状态/节点/标签/池），批量选择后执行动作。
  - API：`GET /cluster/resources`
- **存储列表** · `overview/storage-list` · P1
  - 用户操作：全部节点上的存储及用量，点击进入存储浏览。
  - API：`GET /cluster/resources`
- **节点客户机列表接口** · `overview/guest-index` · P1
  - 用户操作：按节点列 VM/CT（含 full 详情），用于节点页客户机列表。
  - API：`GET /nodes/{node}/qemu`；`GET /nodes/{node}/lxc`
  - 要点：qemu 参数 full=1。

### 2.2 Cluster

- **集群信息与节点** · `cluster/cluster-info` · P3
  - 用户操作：集群名、配置版本、节点列表（ID、票数、Corosync links/地址）。
  - API：`GET /cluster/config`；`GET /cluster/config/nodes`；`GET /cluster/status`；`GET /cluster/config/apiversion`
- **创建集群** · `cluster/cluster-create` · P3
  - 用户操作：单机节点上创建集群：集群名、Corosync links（多链路与优先级）。
  - API：`POST /cluster/config`；`GET /nodes/{node}/network`
  - 要点：参数 clustername、link0=`address=10.0.0.1,priority=..`…link7、nodeid、votes。返回 UPID。link 地址候选来自节点网络接口。
- **加入信息** · `cluster/cluster-join-info` · P3
  - 用户操作：显示/复制 Join Information（base64 串：IP、指纹、totem 等），供其他节点加入。
  - API：`GET /cluster/config/join`
  - 要点：参数 node（指定哪个节点的信息）。返回 nodelist、totem、config_digest、preferred_node；UI 编码为 base64 JSON。
- **加入集群** · `cluster/cluster-join` · P3
  - 用户操作：粘贴 Join Information，自动填入对端地址与指纹，输入对端 root 密码，设置本节点 links。
  - API：`POST /cluster/config/join`
  - 要点：参数 hostname、fingerprint、password、link0..、nodeid、votes、force。返回 UPID；加入后本节点证书变化，当前会话会失效（需提示重新登录）。
- **移除节点/添加节点（API）** · `cluster/cluster-node-remove` · P3
  - 用户操作：官方 UI 不提供删除节点（CLI pvecm delnode）。API 可用，决定：仅只读展示，不实现删除。
  - API：`DELETE /cluster/config/nodes/{node}`；`POST /cluster/config/nodes/{node}`
- **QDevice / Totem 信息** · `cluster/cluster-qdevice-totem` · P3
  - 用户操作：只读展示 QDevice 状态与 totem 配置。
  - API：`GET /cluster/config/qdevice`；`GET /cluster/config/totem`

### 2.3 Ceph（数据中心级）

- **Ceph 状态** · `ceph/ceph-dc-status` · P3
  - 用户操作：健康（含警告列表，可静默）、PG 状态、OSD/MON/MGR/MDS 服务概览（含版本、过期版本提示）、容量、读写 IOPS/吞吐、恢复速度图。
  - API：`GET /cluster/ceph/status`；`GET /cluster/ceph/metadata`；`GET /cluster/ceph`
  - 要点：metadata 参数 scope=all|versions。
- **健康警告静默** · `ceph/ceph-health-mute` · P3
  - 用户操作：对某个健康检查代码静默（TTL、sticky），或取消。
  - API：`GET /cluster/ceph/health-mute`；`PUT /cluster/ceph/health-mute/{code}`
  - 要点：参数 value=1|0、ttl、sticky。
- **全局 OSD Flags** · `ceph/ceph-flags` · P3
  - 用户操作：noout、noin、noup、nodown、nobackfill、norebalance、norecover、noscrub、nodeep-scrub、pause、notieragent 开关。
  - API：`GET /cluster/ceph/flags`；`PUT /cluster/ceph/flags`；`GET /cluster/ceph/flags/{flag}`；`PUT /cluster/ceph/flags/{flag}`
- **批量重启 Ceph 服务** · `ceph/ceph-bulk-restart` · P3
  - 用户操作：跨节点按顺序重启 OSD/MON/MGR/MDS（仅过期版本、dry-run）。
  - API：`POST /cluster/ceph/restart-bulk`
  - 要点：参数 service-type、only-outdated、dry-run、force、timeout。

### 2.4 Options / 标签样式 / Support

- **数据中心选项** · `dc-options/dc-options-all` · P3
  - 用户操作：键盘布局、HTTP 代理、默认控制台（noVNC/xterm.js/SPICE）、邮件发件人、MAC 前缀、迁移设置（类型 secure/insecure、迁移网络）、复制设置、HA 设置（关机策略 freeze/failover/migrate/conditional）、集群资源调度 CRS（ha 调度 basic/static/dynamic、启动时重平衡、自动重平衡及其阈值/保持时长/边距/方法）、U2F、WebAuthn（rp/origin/id，Auto-fill）、带宽限制（默认/恢复/迁移/克隆/移动盘）、最大并发 worker、下一个可用 VMID 范围、同意书文本、默认界面语言、位置。
  - API：`GET /cluster/options`；`PUT /cluster/options`；`GET /nodes/{node}/network`
  - 要点：全部是 /cluster/options 的属性串：migration=`type=secure,network=10.0.0.0/24`、ha=`shutdown_policy=conditional`、crs=`ha=static,ha-rebalance-on-start=1,ha-auto-rebalance=1,ha-auto-rebalance-method=topsis`、notify（旧式通知：fencing/package-updates/replication 的目标）、bwlimit=`default=..,restore=..`、next-id=`lower=100,upper=999999`、webauthn=`rp=..,origin=https://..,id=..`、consent-text、language、location、fencing（实验性）。删除用 delete=key。
- **标签样式** · `dc-options/dc-tag-style` · P3
  - 用户操作：形状（full/circle/dense/none）、排序（config/alphabetical）、大小写敏感、按标签覆盖颜色（背景/文字）。
  - API：`GET /cluster/options`；`PUT /cluster/options`
  - 要点：tag-style=`color-map=prod:FF0000:FFFFFF;dev:...,shape=circle,ordering=alphabetical,case-sensitive=1`。
- **用户标签权限 / 注册标签** · `dc-options/dc-tag-access` · P3
  - 用户操作：user-tag-access：用户可设置标签的模式（none/list/existing/free）与预定义列表；registered-tags：需 Sys.Modify 才能设/删的标签。
  - API：`GET /cluster/options`；`PUT /cluster/options`
  - 要点：user-tag-access=`user-allow=existing,user-allow-list=a;b`、registered-tags=`x;y`。
- **Support** · `dc-options/dc-support` · P3
  - 用户操作：显示订阅支持信息（无订阅时显示购买说明），按本地节点订阅判断。
  - API：`GET /nodes/{node}/subscription`
  - 要点：官方调用 /nodes/localhost/subscription。

### 2.5 Storage

- **存储列表** · `storage-config/storage-defs` · P2
  - 用户操作：全部存储定义：ID、类型、内容、路径/目标、共享、启用、节点限制、备份保留策略。
  - API：`GET /storage`；`GET /storage/{storage}`
  - 要点：参数 type 过滤。
- **添加/编辑存储** · `storage-config/storage-add-edit` · P2
  - 用户操作：类型：Directory、LVM、LVM-Thin、BTRFS、NFS、SMB/CIFS、GlusterFS(已移除)、iSCSI、CephFS、RBD、ZFS over iSCSI、ZFS、Proxmox Backup Server、ESXi。通用：ID、节点、启用、内容类型、共享、备份保留（prune-backups）、最大受保护备份数、预分配、qcow2 快照为卷链（snapshot-as-volume-chain）。
  - API：`POST /storage`；`PUT /storage/{storage}`
  - 要点：type=dir|lvm|lvmthin|btrfs|nfs|cifs|iscsi|iscsidirect|cephfs|rbd|zfs|zfspool|pbs|esxi；类型专属字段：path、vgname、thinpool、server、export、share、username/password/domain/smbversion、portal/target、monhost/keyring/krbd/pool/namespace/fs-name/data-pool、blocksize/iscsiprovider/lio_tpg/comstar_*、datastore/fingerprint/encryption-key/master-pubkey（PBS）、skip-cert-verification（ESXi）。PBS 加密密钥 encryption-key=autogen 时返回生成的密钥，需提示用户保存（官方 PBSKeyShow）。
- **删除存储定义** · `storage-config/storage-remove` · P2
  - 用户操作：只删配置，不删数据。
  - API：`DELETE /storage/{storage}`
- **扫描辅助** · `storage-config/storage-scan` · P2
  - 用户操作：添加存储时扫描 NFS 导出、CIFS 共享、iSCSI target、LVM VG、LVM-thin 池、ZFS 池、PBS datastore。
  - API：`GET /nodes/{node}/scan`；`GET /nodes/{node}/scan/nfs`；`GET /nodes/{node}/scan/cifs`；`GET /nodes/{node}/scan/iscsi`；`GET /nodes/{node}/scan/lvm`；`GET /nodes/{node}/scan/lvmthin`；`GET /nodes/{node}/scan/zfs`；`GET /nodes/{node}/scan/pbs`；`GET /nodes/{node}/storage/{storage}/identity`
  - 要点：nfs: server；cifs: server、username、password、domain；iscsi: portal；lvmthin: vg；pbs: server、username、password、fingerprint、port。

### 2.6 Backup（备份任务）

- **备份任务列表** · `backup-jobs/backup-job-list` · P2
  - 用户操作：任务：启用、节点、计划、下次运行、存储、选择方式、备注；顶部提示未被任何任务覆盖的客户机。
  - API：`GET /cluster/backup`；`GET /cluster/backup-info`；`GET /cluster/backup-info/not-backed-up`
- **创建/编辑备份任务** · `backup-jobs/backup-job-edit` · P2
  - 用户操作：常规：节点、存储、计划（calendar event，带示例下拉）、选择模式（全部/包含所选/排除所选/资源池）、客户机勾选、压缩、模式、启用、任务备注、通知模式与邮件；保留：keep-*；备注模板；高级：带宽、zstd 线程、IO 优先级、fleecing（存储）、repeat-missed、PBS 变更检测、max-workers、排除路径。
  - API：`POST /cluster/backup`；`GET /cluster/backup/{id}`；`PUT /cluster/backup/{id}`；`GET /cluster/resources`；`GET /pools`
  - 要点：selection：all=1 + exclude、vmid=逗号列表、pool=<id>。performance=`max-workers=1,pbs-entries-max=…`、fleecing=`enabled=1,storage=local-lvm`、prune-backups=`keep-last=..`、notes-template。
- **删除备份任务** · `backup-jobs/backup-job-remove` · P2
  - API：`DELETE /cluster/backup/{id}`
- **立即运行** · `backup-jobs/backup-job-run` · P2
  - 用户操作：Run now：对任务涉及的每个节点调用 vzdump。
  - API：`POST /nodes/{node}/vzdump`
  - 要点：官方做法：读取任务配置，去掉 id/schedule/enabled/type/comment/next-run/repeat-missed/node 等字段后，对 job.node 或所有在线节点 POST /nodes/{node}/vzdump。
- **任务详情（包含的卷）** · `backup-jobs/backup-job-detail` · P2
  - 用户操作：树状显示任务会备份的客户机与各磁盘是否包含。
  - API：`GET /cluster/backup/{id}/included_volumes`
- **计划模拟器** · `backup-jobs/schedule-simulator` · P2
  - 用户操作：输入 calendar event，显示接下来 N 次运行时间。
  - API：`GET /cluster/jobs/schedule-analyze`
  - 要点：参数 schedule、starttime、iterations。
- **任务索引** · `backup-jobs/jobs-index` · P2
  - API：`GET /cluster/jobs`

### 2.7 Replication

- **复制任务** · `replication/repl-jobs` · P2
  - 用户操作：全部复制任务（客户机、源/目标节点、计划、限速、启用、注释），新增/编辑/删除（可 keep 目标、force）。
  - API：`GET /cluster/replication`；`POST /cluster/replication`；`GET /cluster/replication/{id}`；`PUT /cluster/replication/{id}`；`DELETE /cluster/replication/{id}`
  - 要点：id=`<vmid>-<n>`，type=local，参数 target、schedule（默认 */15）、rate（MB/s）、comment、disable、remove_job。仅 ZFS 本地存储支持。

### 2.8 Permissions：Users / API Tokens / Two Factor / Groups

- **用户** · `access-users/users` · P3
  - 用户操作：列表（用户、realm、名字、邮箱、启用、过期、TFA 锁定、组、注释）；添加/编辑（密码仅 pve 域、组、过期、启用、名/姓/邮箱、key IDs）、删除、改密码、查看权限、解锁 TFA。
  - API：`GET /access/users`；`POST /access/users`；`GET /access/users/{userid}`；`PUT /access/users/{userid}`；`DELETE /access/users/{userid}`；`PUT /access/password`；`PUT /access/users/{userid}/unlock-tfa`；`GET /access/users/{userid}/tfa`；`GET /access`；`GET /access/permissions`
  - 要点：列表参数 full=1（带 tokens、groups、tfa-locked-until）、enabled。expire 为 epoch 秒，0 永不过期。
- **API Token** · `access-users/tokens` · P3
  - 用户操作：列出所有用户的 token（过期、权限分离、注释），新建（显示一次 secret，可复制）、编辑、重新生成 secret（9.x）、删除、查看 token 权限。
  - API：`GET /access/users`；`GET /access/users/{userid}/token`；`POST /access/users/{userid}/token/{tokenid}`；`GET /access/users/{userid}/token/{tokenid}`；`PUT /access/users/{userid}/token/{tokenid}`；`DELETE /access/users/{userid}/token/{tokenid}`
  - 要点：POST 返回 full-tokenid 和 value（只此一次）。PUT regenerate=1 返回新 value。privsep=1 时 token 需单独 ACL。
- **两步验证（全部用户）** · `access-users/tfa-admin` · P3
  - 用户操作：列出所有用户的 TFA 条目（类型、描述、创建时间、启用），添加/编辑/删除（管理员）、查看锁定状态。
  - API：`GET /access/tfa`；`GET /access/tfa/{userid}`；`POST /access/tfa/{userid}`；`GET /access/tfa/{userid}/{id}`；`PUT /access/tfa/{userid}/{id}`；`DELETE /access/tfa/{userid}/{id}`
  - 要点：删除/修改他人条目需 password（当前用户密码）确认。
- **组** · `access-users/groups` · P3
  - 用户操作：组列表（成员、注释），增删改。
  - API：`GET /access/groups`；`POST /access/groups`；`GET /access/groups/{groupid}`；`PUT /access/groups/{groupid}`；`DELETE /access/groups/{groupid}`
  - 要点：组成员通过用户的 groups 字段维护。

### 2.9 Permissions：ACL / Roles / Realms / Realm Sync / Pools

- **权限（ACL）** · `access-control/acl` · P3
  - 用户操作：列出路径-用户/组/Token-角色-传播；添加用户/组/Token 权限（路径选择器覆盖 /、/vms/<id>、/storage/<id>、/pool/<id>、/sdn/…、/mapping/…、/nodes/<n>、/access/…）；删除。
  - API：`GET /access/acl`；`PUT /access/acl`
  - 要点：PUT 参数 path、roles、users|groups|tokens、propagate、delete=1。
- **角色** · `access-control/roles` · P3
  - 用户操作：内置角色（只读）与自定义角色，权限点多选。
  - API：`GET /access/roles`；`POST /access/roles`；`GET /access/roles/{roleid}`；`PUT /access/roles/{roleid}`；`DELETE /access/roles/{roleid}`
  - 要点：privs 逗号分隔；可选权限全集取自 GET /access/roles/Administrator。
- **认证域** · `access-control/realms` · P3
  - 用户操作：PAM、PVE、LDAP、AD、OpenID：默认域、TFA 要求（OATH/Yubico）、服务器/端口/SSL/证书校验、Base DN、用户属性、绑定用户、同步选项（属性映射、用户/组过滤、组类、默认同步选项）、OpenID（issuer、client id/key、scopes、prompt、acr、用户名声明、自动创建、组声明、query-userinfo）。
  - API：`GET /access/domains`；`POST /access/domains`；`GET /access/domains/{realm}`；`PUT /access/domains/{realm}`；`DELETE /access/domains/{realm}`
  - 要点：type=pam|pve|ldap|ad|openid；sync-defaults-options=`scope=both,enable-new=1,remove-vanished=acl;entry;properties`。check-connection=1 先验证。
- **立即同步域** · `access-control/realm-sync` · P3
  - 用户操作：LDAP/AD 同步用户/组：范围、启用新用户、移除已消失（ACL/条目/属性）、预演。
  - API：`POST /access/domains/{realm}/sync`
  - 要点：参数 scope=users|groups|both、enable-new、remove-vanished、dry-run。返回 UPID。
- **域同步任务** · `access-control/realm-sync-jobs` · P3
  - 用户操作：定时同步任务：域、计划、范围、启用、选项、注释，立即运行。
  - API：`GET /cluster/jobs/realm-sync`；`POST /cluster/jobs/realm-sync/{id}`；`GET /cluster/jobs/realm-sync/{id}`；`PUT /cluster/jobs/realm-sync/{id}`；`DELETE /cluster/jobs/realm-sync/{id}`
- **资源池管理** · `access-control/pools-admin` · P3
  - 用户操作：池列表（支持嵌套 a/b）、创建（ID、注释）、编辑注释、删除（需为空）。
  - API：`GET /pools`；`POST /pools`；`PUT /pools`；`DELETE /pools`；`GET /pools/{poolid}`；`PUT /pools/{poolid}`；`DELETE /pools/{poolid}`
  - 要点：新接口用 query 参数 poolid；/pools/{poolid} 为废弃接口（仅兼容）。
- **VNC ticket 校验（内部）** · `access-control/vnc-ticket` · P3
  - 用户操作：第三方代理校验 vncticket 用，UI 不用。
  - API：`POST /access/vncticket`

### 2.10 HA

- **HA 状态** · `ha/ha-status` · P3
  - 用户操作：quorum、master、各节点 LRM 状态、各资源状态；Arm/Disarm HA（disarm 时资源 freeze 或 ignore）。
  - API：`GET /cluster/ha`；`GET /cluster/ha/status`；`GET /cluster/ha/status/current`；`GET /cluster/ha/status/manager_status`；`POST /cluster/ha/status/arm-ha`；`POST /cluster/ha/status/disarm-ha`
  - 要点：disarm-ha 参数 resource-mode=freeze|ignore（9.2 新功能，用于维护）。
- **HA 资源** · `ha/ha-resources` · P3
  - 用户操作：资源列表（sid、状态、请求状态、节点、最大重启/迁移、failback、auto-rebalance、注释），添加/编辑/删除，迁移/重定位到指定节点。
  - API：`GET /cluster/ha/resources`；`POST /cluster/ha/resources`；`GET /cluster/ha/resources/{sid}`；`PUT /cluster/ha/resources/{sid}`；`DELETE /cluster/ha/resources/{sid}`；`POST /cluster/ha/resources/{sid}/migrate`；`POST /cluster/ha/resources/{sid}/relocate`
  - 要点：state=started|stopped|enabled|disabled|ignored；DELETE 参数 purge（同时从规则中移除）。migrate/relocate 参数 node。
- **HA 亲和规则** · `ha/ha-rules` · P3
  - 用户操作：节点亲和（资源→节点及优先级、strict）与资源亲和（资源之间 positive=同节点 / negative=分开），启用/禁用、注释；显示规则冲突错误。
  - API：`GET /cluster/ha/rules`；`POST /cluster/ha/rules`；`GET /cluster/ha/rules/{rule}`；`PUT /cluster/ha/rules/{rule}`；`DELETE /cluster/ha/rules/{rule}`
  - 要点：type=node-affinity|resource-affinity；resources=`vm:100,ct:101`；nodes=`node1:2,node2:1`；affinity=positive|negative；strict；disable；comment。GET 带 errors 字段（冲突说明）。
- **HA 组（已废弃）** · `ha/ha-groups-legacy` · P3
  - 用户操作：9.x 中组已迁移为节点亲和规则；只读展示旧组以便迁移提示。
  - API：`GET /cluster/ha/groups`；`POST /cluster/ha/groups`；`GET /cluster/ha/groups/{group}`；`PUT /cluster/ha/groups/{group}`；`DELETE /cluster/ha/groups/{group}`
  - 要点：决定：只读，不提供新建。
- **Fencing** · `ha/ha-fencing` · P3
  - 用户操作：显示 fencing 模式（watchdog/hardware），硬件 fencing 设备仅 CLI 配置。
  - API：`GET /cluster/options`
  - 要点：官方 Fencing 页为只读占位（空表 = 使用 watchdog）。
- **CRS 设置入口** · `ha/ha-crs` · P3
  - 用户操作：HA 状态页上的 CRS Settings 快捷编辑。
  - API：`PUT /cluster/options`
  - 要点：crs 属性串。

### 2.11 SDN：Zones / VNets / Options / IPAM / VNet Firewall

- **SDN 状态** · `sdn/sdn-status` · P3
  - 用户操作：各节点各 Zone 的状态（available/error/pending），一键 Apply。
  - API：`GET /cluster/resources`；`GET /cluster/sdn`；`PUT /cluster/sdn`
  - 要点：/cluster/resources?type=sdn。PUT /cluster/sdn = 应用全部 pending 配置到所有节点（返回 UPID）。
- **Zones** · `sdn/sdn-zones` · P3
  - 用户操作：类型 Simple、VLAN、QinQ、VXLAN、EVPN（Faucet 未在 UI）：ID、网桥、MTU、节点、IPAM、DNS/反向 DNS/DNS zone、自动 DHCP、类型专属字段（tag、vlan-protocol、peers、controller、vrf-vxlan、exitnodes、advertise-subnets、mac、rt-import、fabric…）；pending 差异显示。
  - API：`GET /cluster/sdn/zones`；`POST /cluster/sdn/zones`；`GET /cluster/sdn/zones/{zone}`；`PUT /cluster/sdn/zones/{zone}`；`DELETE /cluster/sdn/zones/{zone}`
  - 要点：列表参数 pending=1、running=1。所有 SDN 写接口可带 lock-token（使用全局锁时）。
- **VNets 与 Subnets** · `sdn/sdn-vnets` · P3
  - 用户操作：VNet：ID、别名、Zone、tag、VLAN aware、端口隔离；Subnet：CIDR、网关、SNAT、DNS 前缀、DHCP 范围、DHCP DNS 服务器。
  - API：`GET /cluster/sdn/vnets`；`POST /cluster/sdn/vnets`；`GET /cluster/sdn/vnets/{vnet}`；`PUT /cluster/sdn/vnets/{vnet}`；`DELETE /cluster/sdn/vnets/{vnet}`；`GET /cluster/sdn/vnets/{vnet}/subnets`；`POST /cluster/sdn/vnets/{vnet}/subnets`；`GET /cluster/sdn/vnets/{vnet}/subnets/{subnet}`；`PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet}`；`DELETE /cluster/sdn/vnets/{vnet}/subnets/{subnet}`
  - 要点：subnet id 形如 `<zone>-10.0.0.0-24`；dhcp-range=`start-address=..,end-address=..`（数组）。VNet 权限：VnetACLAdd 写 /sdn/zones/<zone>/<vnet>。
- **Options：Controllers / IPAM / DNS** · `sdn/sdn-options` · P3
  - 用户操作：Controller（EVPN、BGP、ISIS；ASN、peers、loopback、ebgp、route-map in/out、fabric）；IPAM（pve、NetBox、phpIPAM）；DNS（PowerDNS）。
  - API：`GET /cluster/sdn/controllers`；`POST /cluster/sdn/controllers`；`GET /cluster/sdn/controllers/{controller}`；`PUT /cluster/sdn/controllers/{controller}`；`DELETE /cluster/sdn/controllers/{controller}`；`GET /cluster/sdn/ipams`；`POST /cluster/sdn/ipams`；`GET /cluster/sdn/ipams/{ipam}`；`PUT /cluster/sdn/ipams/{ipam}`；`DELETE /cluster/sdn/ipams/{ipam}`；`GET /cluster/sdn/dns`；`POST /cluster/sdn/dns`；`GET /cluster/sdn/dns/{dns}`；`PUT /cluster/sdn/dns/{dns}`；`DELETE /cluster/sdn/dns/{dns}`
- **IPAM 视图** · `sdn/sdn-ipam-view` · P3
  - 用户操作：PVE IPAM 中各 Zone/VNet/Subnet 已分配 IP 与 MAC、对应客户机；手动添加/编辑/删除映射（DHCP 静态租约）。
  - API：`GET /cluster/sdn/ipams/{ipam}/status`；`POST /cluster/sdn/vnets/{vnet}/ips`；`PUT /cluster/sdn/vnets/{vnet}/ips`；`DELETE /cluster/sdn/vnets/{vnet}/ips`
  - 要点：参数 zone、ip、mac、vmid。
- **VNet 防火墙** · `sdn/sdn-vnet-firewall` · P3
  - 用户操作：按 VNet 配置 forward 方向规则与选项（启用、policy_forward、log_level_forward）。
  - API：`GET /cluster/sdn/vnets/{vnet}/firewall`；`GET /cluster/sdn/vnets/{vnet}/firewall/rules`；`POST /cluster/sdn/vnets/{vnet}/firewall/rules`；`GET /cluster/sdn/vnets/{vnet}/firewall/rules/{pos}`；`PUT /cluster/sdn/vnets/{vnet}/firewall/rules/{pos}`；`DELETE /cluster/sdn/vnets/{vnet}/firewall/rules/{pos}`；`GET /cluster/sdn/vnets/{vnet}/firewall/options`；`PUT /cluster/sdn/vnets/{vnet}/firewall/options`
  - 要点：仅 nftables 后端生效；规则编辑器复用 firewall 区域组件。
- **锁 / 回滚 / 差异预览** · `sdn/sdn-lock-rollback` · P3
  - 用户操作：查看将要应用的差异（dry-run），丢弃 pending（rollback），获取/释放全局锁。
  - API：`GET /cluster/sdn/dry-run`；`POST /cluster/sdn/rollback`；`POST /cluster/sdn/lock`；`DELETE /cluster/sdn/lock`
  - 要点：dry-run 参数 node，返回 frr / interfaces 差异文本。lock 返回 lock-token，后续写操作带上；allow-pending。

### 2.12 SDN：Fabrics / Route Maps / Prefix Lists

- **Fabrics** · `sdn-fabrics/sdn-fabrics` · P3
  - 用户操作：Fabric（OpenFabric、OSPF、WireGuard、BGP）：IPv4/IPv6 前缀、hello/csnp 间隔、area、keepalive、redistribute、route filter；节点加入 fabric：路由器 IP、接口（及其 IP/参数）、WireGuard 公钥/endpoint/peers/allowed IPs、角色。
  - API：`GET /cluster/sdn/fabrics`；`GET /cluster/sdn/fabrics/all`；`GET /cluster/sdn/fabrics/fabric`；`POST /cluster/sdn/fabrics/fabric`；`GET /cluster/sdn/fabrics/fabric/{id}`；`PUT /cluster/sdn/fabrics/fabric/{id}`；`DELETE /cluster/sdn/fabrics/fabric/{id}`；`GET /cluster/sdn/fabrics/node`；`GET /cluster/sdn/fabrics/node/{fabric_id}`；`POST /cluster/sdn/fabrics/node/{fabric_id}`；`GET /cluster/sdn/fabrics/node/{fabric_id}/{node_id}`；`PUT /cluster/sdn/fabrics/node/{fabric_id}/{node_id}`；`DELETE /cluster/sdn/fabrics/node/{fabric_id}/{node_id}`；`GET /nodes/{node}/network`
  - 要点：all?pending=1 一次拿 fabric+node 树。protocol=openfabric|ospf|wireguard|bgp。
- **Route Maps** · `sdn-fabrics/sdn-route-maps` · P3
  - 用户操作：Route map 条目：ID、顺序、动作 permit/deny、match、set、call、exit-action。
  - API：`GET /cluster/sdn/route-maps`；`GET /cluster/sdn/route-maps/entries`；`POST /cluster/sdn/route-maps/entries`；`GET /cluster/sdn/route-maps/entries/{route-map-id}`；`GET /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order}`；`PUT /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order}`；`DELETE /cluster/sdn/route-maps/entries/{route-map-id}/entry/{order}`
- **Prefix Lists** · `sdn-fabrics/sdn-prefix-lists` · P3
  - 用户操作：前缀列表与条目（seq、permit/deny、prefix、ge/le）。
  - API：`GET /cluster/sdn/prefix-lists`；`POST /cluster/sdn/prefix-lists`；`GET /cluster/sdn/prefix-lists/{id}`；`PUT /cluster/sdn/prefix-lists/{id}`；`DELETE /cluster/sdn/prefix-lists/{id}`；`GET /cluster/sdn/prefix-lists/{id}/entries`；`POST /cluster/sdn/prefix-lists/{id}/entries`；`GET /cluster/sdn/prefix-lists/{id}/entries/{url_seq}`；`PUT /cluster/sdn/prefix-lists/{id}/entries/{url_seq}`；`DELETE /cluster/sdn/prefix-lists/{id}/entries/{url_seq}`

### 2.13 ACME

- **ACME 账户** · `certificates-acme/acme-accounts` · P2
  - 用户操作：注册账户（名称、邮箱、目录 Let's Encrypt/Staging/自定义、同意 ToS、EAB kid/hmac），查看、更新邮箱、注销。
  - API：`GET /cluster/acme`；`GET /cluster/acme/account`；`POST /cluster/acme/account`；`GET /cluster/acme/account/{name}`；`PUT /cluster/acme/account/{name}`；`DELETE /cluster/acme/account/{name}`；`GET /cluster/acme/directories`；`GET /cluster/acme/meta`；`GET /cluster/acme/tos`
  - 要点：meta?directory= 返回 termsOfService、externalAccountRequired。注册返回 UPID。
- **ACME 插件（DNS challenge）** · `certificates-acme/acme-plugins` · P2
  - 用户操作：standalone/DNS 插件：API 提供商（acme.sh 的 200+ dnsapi）、凭据键值、验证延迟、节点限制、禁用。
  - API：`GET /cluster/acme/plugins`；`POST /cluster/acme/plugins`；`GET /cluster/acme/plugins/{id}`；`PUT /cluster/acme/plugins/{id}`；`DELETE /cluster/acme/plugins/{id}`；`GET /cluster/acme/challenge-schema`
  - 要点：data 为 base64 编码的 `KEY=value` 多行文本；challenge-schema 给出各 API 的字段定义用于生成表单。

### 2.14 Firewall

- **集群防火墙规则** · `firewall/fw-dc-rules` · P2
  - 用户操作：规则表（方向 in/out/forward/group、动作 ACCEPT/DROP/REJECT、宏、接口、协议、源/目的（可用别名/IPSet）、端口、ICMP 类型、日志级别、注释、启用），拖拽排序，复制，插入安全组。
  - API：`GET /cluster/firewall`；`GET /cluster/firewall/rules`；`POST /cluster/firewall/rules`；`GET /cluster/firewall/rules/{pos}`；`PUT /cluster/firewall/rules/{pos}`；`DELETE /cluster/firewall/rules/{pos}`；`GET /cluster/firewall/macros`；`GET /cluster/firewall/refs`
  - 要点：移动 = PUT rules/{pos} moveto=<新位置>。type=group 时 action 为安全组名。refs 参数 type=alias|ipset 给出可引用对象（含 dc/ 与 guest/ 作用域前缀）。所有写操作带 digest。
- **集群防火墙选项** · `firewall/fw-dc-options` · P2
  - 用户操作：启用防火墙（危险：默认策略会生效）、ebtables、输入/输出/forward 默认策略、日志限速。
  - API：`GET /cluster/firewall/options`；`PUT /cluster/firewall/options`
  - 要点：log_ratelimit=`enable=1,rate=1/second,burst=5`。启用前提示确认 8006/22 已放行。
- **安全组** · `firewall/fw-security-groups` · P2
  - 用户操作：安全组列表（重命名、注释、删除）与组内规则编辑。
  - API：`GET /cluster/firewall/groups`；`POST /cluster/firewall/groups`；`GET /cluster/firewall/groups/{group}`；`POST /cluster/firewall/groups/{group}`；`DELETE /cluster/firewall/groups/{group}`；`GET /cluster/firewall/groups/{group}/{pos}`；`PUT /cluster/firewall/groups/{group}/{pos}`；`DELETE /cluster/firewall/groups/{group}/{pos}`
  - 要点：POST /groups 带 rename 即重命名。
- **别名** · `firewall/fw-aliases` · P2
  - 用户操作：名称 → IP/CIDR，注释，重命名。
  - API：`GET /cluster/firewall/aliases`；`POST /cluster/firewall/aliases`；`GET /cluster/firewall/aliases/{name}`；`PUT /cluster/firewall/aliases/{name}`；`DELETE /cluster/firewall/aliases/{name}`
- **IPSet** · `firewall/fw-ipsets` · P2
  - 用户操作：IPSet 列表与成员（CIDR/别名、nomatch、注释）。
  - API：`GET /cluster/firewall/ipset`；`POST /cluster/firewall/ipset`；`GET /cluster/firewall/ipset/{name}`；`POST /cluster/firewall/ipset/{name}`；`DELETE /cluster/firewall/ipset/{name}`；`GET /cluster/firewall/ipset/{name}/{cidr}`；`PUT /cluster/firewall/ipset/{name}/{cidr}`；`DELETE /cluster/firewall/ipset/{name}/{cidr}`
  - 要点：删除非空 IPSet 需 force=1。cidr 在路径中需 URL 编码（含 /）。

### 2.15 Metric Server / Notifications

- **外部指标服务器** · `notifications-metrics/metric-servers` · P3
  - 用户操作：InfluxDB（UDP/HTTP(S)、org、bucket、token、max-body-size、证书校验）、Graphite（UDP/TCP、路径前缀）、OpenTelemetry（9.x：endpoint、协议、压缩、headers、资源属性）；启用/禁用。
  - API：`GET /cluster/metrics`；`GET /cluster/metrics/server`；`POST /cluster/metrics/server/{id}`；`GET /cluster/metrics/server/{id}`；`PUT /cluster/metrics/server/{id}`；`DELETE /cluster/metrics/server/{id}`
  - 要点：注意创建也是 POST 带 id 的路径。
- **集群指标导出（拉取）** · `notifications-metrics/metrics-export` · P3
  - 用户操作：官方 UI 未使用；可用于未来的仪表盘。
  - API：`GET /cluster/metrics/export`
  - 要点：参数 history、local-only、node-list、start-time。
- **通知目标** · `notifications-metrics/notif-targets` · P3
  - 用户操作：目标列表（类型、启用、注释、来源 built-in）；Sendmail（收件人用户/邮箱、发件人、作者）、SMTP（服务器、端口、加密 tls/starttls/insecure、认证、发件人、收件人）、Gotify（服务器、token）、Webhook（URL、方法、headers、body 模板、secrets）；发送测试。
  - API：`GET /cluster/notifications`；`GET /cluster/notifications/targets`；`POST /cluster/notifications/targets/{name}/test`；`GET /cluster/notifications/endpoints`；`GET /cluster/notifications/endpoints/sendmail`；`POST /cluster/notifications/endpoints/sendmail`；`GET /cluster/notifications/endpoints/sendmail/{name}`；`PUT /cluster/notifications/endpoints/sendmail/{name}`；`DELETE /cluster/notifications/endpoints/sendmail/{name}`；`GET /cluster/notifications/endpoints/smtp`；`POST /cluster/notifications/endpoints/smtp`；`GET /cluster/notifications/endpoints/smtp/{name}`；`PUT /cluster/notifications/endpoints/smtp/{name}`；`DELETE /cluster/notifications/endpoints/smtp/{name}`；`GET /cluster/notifications/endpoints/gotify`；`POST /cluster/notifications/endpoints/gotify`；`GET /cluster/notifications/endpoints/gotify/{name}`；`PUT /cluster/notifications/endpoints/gotify/{name}`；`DELETE /cluster/notifications/endpoints/gotify/{name}`；`GET /cluster/notifications/endpoints/webhook`；`POST /cluster/notifications/endpoints/webhook`；`GET /cluster/notifications/endpoints/webhook/{name}`；`PUT /cluster/notifications/endpoints/webhook/{name}`；`DELETE /cluster/notifications/endpoints/webhook/{name}`
  - 要点：webhook 的 header/secret 为 `name=..,value=<base64>` 数组；body 为 base64。密码/secret 读回时不返回值。
- **通知匹配器** · `notifications-metrics/notif-matchers` · P3
  - 用户操作：匹配规则树（all/any、取反）：按严重级别、字段（exact/regex，字段与已知值由服务端提供）、日历时间匹配，选择目标；启用、注释。
  - API：`GET /cluster/notifications/matchers`；`POST /cluster/notifications/matchers`；`GET /cluster/notifications/matchers/{name}`；`PUT /cluster/notifications/matchers/{name}`；`DELETE /cluster/notifications/matchers/{name}`；`GET /cluster/notifications/matcher-fields`；`GET /cluster/notifications/matcher-field-values`
  - 要点：match-field=`exact:type=vzdump`，match-severity=`warning,error`，match-calendar=`mon..fri 8-17`，target 数组。

### 2.16 Resource Mappings / Custom CPU Models

- **PCI 映射** · `resource-mappings/map-pci` · P3
  - 用户操作：集群级 PCI 映射：每节点的设备路径/ID/子系统/IOMMU 组、mdev、可实时迁移；显示各节点设备是否匹配。
  - API：`GET /cluster/mapping`；`GET /cluster/mapping/pci`；`POST /cluster/mapping/pci`；`GET /cluster/mapping/pci/{id}`；`PUT /cluster/mapping/pci/{id}`；`DELETE /cluster/mapping/pci/{id}`；`GET /nodes/{node}/hardware/pci`
  - 要点：map 为数组，每项 `node=pve1,path=0000:01:00.0,id=10de:1eb8,subsystem-id=..,iommugroup=..`；check-node 参数返回校验结果。
- **USB 映射** · `resource-mappings/map-usb` · P3
  - 用户操作：每节点按 vendor:product 或端口路径映射。
  - API：`GET /cluster/mapping/usb`；`POST /cluster/mapping/usb`；`GET /cluster/mapping/usb/{id}`；`PUT /cluster/mapping/usb/{id}`；`DELETE /cluster/mapping/usb/{id}`；`GET /nodes/{node}/hardware/usb`
- **目录映射（virtiofs）** · `resource-mappings/map-dir` · P3
  - 用户操作：每节点主机目录路径，供 VM virtiofs 使用。
  - API：`GET /cluster/mapping/dir`；`POST /cluster/mapping/dir`；`GET /cluster/mapping/dir/{id}`；`PUT /cluster/mapping/dir/{id}`；`DELETE /cluster/mapping/dir/{id}`
- **自定义 CPU 型号** · `resource-mappings/custom-cpu` · P3
  - 用户操作：基于内置型号的自定义 CPU：reported-model、flags、hidden、hv-vendor-id、level、phys-bits、guest-phys-bits。
  - API：`GET /cluster/qemu`；`GET /cluster/qemu/custom-cpu-models`；`POST /cluster/qemu/custom-cpu-models`；`GET /cluster/qemu/custom-cpu-models/{cputype}`；`PUT /cluster/qemu/custom-cpu-models/{cputype}`；`DELETE /cluster/qemu/custom-cpu-models/{cputype}`；`GET /cluster/qemu/cpu-flags`
  - 要点：VM 中引用为 custom-<cputype>。

### 2.17 Bulk Actions

- **数据中心批量操作** · `guest-lifecycle/dc-bulk` · P1
  - 用户操作：数据中心头部 Bulk Start / Shutdown / Suspend / Migrate：跨节点勾选客户机（按节点/类型/状态/标签/池过滤），并发数、超时、强制停止、挂起到磁盘与状态存储、迁移目标与在线/本地盘。
  - API：`GET /cluster/bulk-action`；`GET /cluster/bulk-action/guest`；`POST /cluster/bulk-action/guest/start`；`POST /cluster/bulk-action/guest/shutdown`；`POST /cluster/bulk-action/guest/suspend`；`POST /cluster/bulk-action/guest/migrate`
  - 要点：参数 vms（数组）、max-workers、timeout、force-stop、to-disk、statestorage、target、online、with-local-disks。9.x 新接口，返回 UPID。

### 2.18 其他集群接口

- **集群目录索引** · `app-shell/cluster-index` · P1
  - 用户操作：API 目录索引，仅用于探测。
  - API：`GET /cluster`；`GET /nodes/{node}`；`GET /nodes/{node}/qemu/{vmid}`；`GET /nodes/{node}/lxc/{vmid}`；`GET /nodes/{node}/qemu/{vmid}/status`；`GET /nodes/{node}/lxc/{vmid}/status`；`GET /nodes/{node}/qemu/{vmid}/firewall`；`GET /nodes/{node}/services/{service}`
- **下一个可用 VMID** · `app-shell/nextid` · P1
  - 用户操作：创建/克隆/恢复时建议 VMID。
  - API：`GET /cluster/nextid`

## 3. 节点（Node）

### 3.1 Summary / Notes / 服务 / 系统日志

- **节点状态** · `node-summary/node-status` · P1
  - 用户操作：CPU 使用率/型号/插槽、负载、IO wait、内存、KSM 共享、交换、根分区、内核版本、启动模式（EFI/Secure Boot）、PVE 版本、uptime。
  - API：`GET /nodes/{node}/status`
  - 要点：返回 cpu、cpuinfo、loadavg、memory、swap、rootfs、ksm、kversion、current-kernel、boot-info、pveversion、uptime、wait。
- **节点 RRD 图** · `node-summary/node-rrd` · P1
  - 用户操作：CPU 与 IO delay、负载、内存（含 ZFS ARC、可用）、网络、PSI 压力（CPU/IO/内存）；时间范围 小时/天/周/月/年/十年，平均/最大。
  - API：`GET /nodes/{node}/rrddata`
  - 要点：参数 timeframe=hour|day|week|month|year|decade、cf=AVERAGE|MAX。字段 cpu、iowait、loadavg、maxcpu、memtotal、memused、memavailable、arcsize、swaptotal、swapused、roottotal、rootused、netin、netout、pressure*。
- **节点重启 / 关机** · `node-summary/node-power` · P1
  - 用户操作：节点页顶部 Reboot、Shutdown（危险确认，需输入节点名）。
  - API：`POST /nodes/{node}/status`
  - 要点：command=reboot|shutdown；需 Sys.PowerMgmt。
- **节点备注** · `node-summary/node-notes` · P1
  - 用户操作：查看/编辑节点 Notes（Markdown）。
  - API：`GET /nodes/{node}/config`；`PUT /nodes/{node}/config`
  - 要点：字段 description。
- **服务管理** · `node-summary/node-services` · P1
  - 用户操作：列出 pveproxy、pvedaemon、corosync、chrony、postfix、sshd、cron 等服务的状态，启动/停止/重启/重载，查看服务日志。
  - API：`GET /nodes/{node}/services`；`GET /nodes/{node}/services/{service}`；`GET /nodes/{node}/services/{service}/state`；`POST /nodes/{node}/services/{service}/start`；`POST /nodes/{node}/services/{service}/stop`；`POST /nodes/{node}/services/{service}/restart`；`POST /nodes/{node}/services/{service}/reload`；`GET /nodes/{node}/syslog`
  - 要点：服务日志：GET /nodes/{node}/syslog?service=<name>（官方做法），或 journal 的 unit 参数。重启 pveproxy 会断开当前连接，需提示。
- **系统日志（journal）** · `node-summary/node-journal` · P1
  - 用户操作：实时查看 journal，按时间范围、优先级、服务/unit、仅内核过滤，向上翻页。
  - API：`GET /nodes/{node}/journal`；`GET /nodes/{node}/syslog`
  - 要点：journal：since/until 或 startcursor/endcursor、lastentries；9.2 新增 priority、service（glob）、unit、kernel、structured（JSON 条目）、identifiers/units（筛选候选）。返回行数组，首尾是游标。需 Sys.Syslog。
- **包版本** · `node-summary/package-versions` · P1
  - 用户操作：Summary 的 Package versions：列出 proxmox-ve 相关包及版本，可复制。
  - API：`GET /nodes/{node}/apt/versions`
- **软件源状态提示** · `node-summary/node-repo-status` · P1
  - 用户操作：Summary 中显示软件源/订阅状态提示（无企业订阅、未启用更新源等）。
  - API：`GET /nodes/{node}/apt/repositories`；`GET /nodes/{node}/subscription`
- **系统报告** · `node-summary/node-report` · P1
  - 用户操作：生成并查看/下载节点系统报告（官方在 Subscription 页的 System Report 按钮）。
  - API：`GET /nodes/{node}/report`
  - 要点：返回纯文本，较大，按需加载。
- **网络唤醒** · `node-summary/node-wol` · P1
  - 用户操作：对离线节点发送 Wake-on-LAN（需在节点 Options 配置 MAC）。
  - API：`POST /nodes/{node}/wakeonlan`
  - 要点：在其他在线节点上执行；路径中的 node 为目标节点。
- **节点版本** · `node-summary/node-version` · P1
  - 用户操作：显示节点 pve-manager 版本。
  - API：`GET /nodes/{node}/version`

### 3.2 Shell

- **节点 Shell** · `console/node-shell` · P1
  - 用户操作：节点 Shell（xterm.js 优先，可选 noVNC），手机上提供 Esc/Tab/Ctrl/方向键辅助键栏。
  - API：`POST /nodes/{node}/termproxy`；`POST /nodes/{node}/vncshell`；`GET /nodes/{node}/vncwebsocket`
  - 要点：termproxy 返回 port、ticket、user、upid；连接 wss://…/api2/json/nodes/{node}/vncwebsocket?port=<port>&vncticket=<urlencoded ticket>（需带 PVEAuthCookie）。xterm 协议：连上先发 `<user>:<ticket>\n`，服务端回 OK；输入 `0:<字节长度>:<数据>`，调整尺寸 `1:<cols>:<rows>:`，心跳 `2`（官方每 30s）。cmd=upgrade 用于升级、cmd=ceph_install 用于安装 Ceph（仅 root@pam）。vncshell（websocket=1，width/height）走 noVNC，密码即 ticket。
- **节点 SPICE Shell** · `console/node-spice-shell` · P1
  - 用户操作：下载 .vv 文件用 remote-viewer 打开（桌面场景，手机低优先级）。
  - API：`POST /nodes/{node}/spiceshell`
  - 要点：返回 .vv 配置键值，前端拼成 `[virt-viewer]` 文件下载。

### 3.3 System → Network

- **网络接口列表** · `node-network/net-list` · P2
  - 用户操作：列出 eth/bridge/bond/vlan/alias/OVS/fabric/vnet 接口：名称、类型、活动、自启、VLAN aware、端口/成员、CIDR、网关、注释；显示待应用的配置差异。
  - API：`GET /nodes/{node}/network`；`GET /nodes/{node}/network/{iface}`
  - 要点：type 过滤：bridge|bond|eth|alias|vlan|fabric|OVSBridge|OVSBond|OVSPort|OVSIntPort|vnet|any_bridge|any_local_bridge|include_sdn。响应外层带 changes（/etc/network/interfaces.new 与当前的 diff 文本）。
- **创建/编辑接口** · `node-network/net-create-edit` · P2
  - 用户操作：Linux Bridge（端口、VLAN aware、VID 范围）、Linux Bond（成员、模式、hash 策略、primary）、Linux VLAN（raw device、vlan-id）、OVS Bridge/Bond/IntPort、编辑物理网卡 IP/MTU/注释；IPv4/IPv6 CIDR 与网关、自启。
  - API：`POST /nodes/{node}/network`；`PUT /nodes/{node}/network/{iface}`
  - 要点：PUT 需带 type；清空字段用 delete。所有修改先写入 interfaces.new，不立即生效。
- **删除接口** · `node-network/net-delete` · P2
  - 用户操作：删除接口（写入待应用配置）。
  - API：`DELETE /nodes/{node}/network/{iface}`
- **应用配置** · `node-network/net-apply` · P2
  - 用户操作：Apply Configuration：ifreload -a 生效（返回 UPID），可选重新生成 FRR 配置。
  - API：`PUT /nodes/{node}/network`
  - 要点：参数 regenerate-frr。危险操作：错误配置会断网，需明确确认并展示 diff。
- **还原待应用更改** · `node-network/net-revert` · P2
  - 用户操作：丢弃 interfaces.new。
  - API：`DELETE /nodes/{node}/network`

### 3.4 System → Certificates

- **证书列表** · `certificates-acme/cert-info` · P2
  - 用户操作：显示 pve-ssl / pveproxy-ssl 等证书：主题、SAN、颁发者、有效期、指纹、PEM。
  - API：`GET /nodes/{node}/certificates/info`
- **上传/删除自定义证书** · `certificates-acme/cert-custom` · P2
  - 用户操作：上传 PEM 证书链与私钥（可从文件），替换 pveproxy 证书并重启；删除恢复自签。
  - API：`POST /nodes/{node}/certificates/custom`；`DELETE /nodes/{node}/certificates/custom`
  - 要点：参数 certificates、key、force、restart=1。重启 pveproxy 会使当前连接断开数秒，前端需重连；若通过 Go 服务固定了 PVE_TLS_FINGERPRINT，换证书后 Go 端也需更新（提示用户）。
- **ACME 域名配置** · `certificates-acme/acme-domains` · P2
  - 用户操作：设置节点使用的 ACME 账户；增删域名（standalone 或指定 DNS 插件、别名）。
  - API：`GET /nodes/{node}/config`；`PUT /nodes/{node}/config`；`GET /cluster/acme/account`；`GET /cluster/acme/plugins`
  - 要点：acme=`account=default`、acmedomain0=`domain=pve.example.com,plugin=cf,alias=…`。
- **申请/续期/吊销证书** · `certificates-acme/acme-order` · P2
  - 用户操作：Order Certificates Now、Renew、Revoke（任务日志实时显示）。
  - API：`POST /nodes/{node}/certificates/acme/certificate`；`PUT /nodes/{node}/certificates/acme/certificate`；`DELETE /nodes/{node}/certificates/acme/certificate`
  - 要点：POST=申请、PUT=续期（force）、DELETE=吊销；均返回 UPID，结束后 pveproxy 重载。

### 3.5 System → DNS / Hosts / Options / Time

- **DNS** · `node-system/node-dns` · P2
  - 用户操作：搜索域与最多 3 个 DNS 服务器。
  - API：`GET /nodes/{node}/dns`；`PUT /nodes/{node}/dns`
  - 要点：search、dns1..dns3。
- **Hosts** · `node-system/node-hosts` · P2
  - 用户操作：直接编辑 /etc/hosts 文本。
  - API：`GET /nodes/{node}/hosts`；`POST /nodes/{node}/hosts`
  - 要点：data（全文）、digest。
- **时间** · `node-system/node-time` · P2
  - 用户操作：显示本地/UTC 时间，修改时区。
  - API：`GET /nodes/{node}/time`；`PUT /nodes/{node}/time`
  - 要点：timezone（如 Asia/Shanghai），时区列表前端内置。
- **节点选项** · `node-system/node-options` · P2
  - 用户操作：Wake-on-LAN MAC 与绑定接口、开机自启全部客户机前的延迟、Ballooning 目标百分比、节点位置（覆盖数据中心）。
  - API：`GET /nodes/{node}/config`；`PUT /nodes/{node}/config`
  - 要点：wakeonlan=`mac=..,bind-interface=..,broadcast-address=..`、startall-onboot-delay、ballooning-target、location。

### 3.6 Updates / Repositories

- **可升级包列表** · `node-updates/apt-list` · P2
  - 用户操作：显示可更新的包（包名、当前/新版本、描述、来源），手动刷新。
  - API：`GET /nodes/{node}/apt/update`；`POST /nodes/{node}/apt/update`
  - 要点：POST = apt update（返回 UPID，参数 notify、quiet）；GET 列出可升级包。
- **查看 changelog** · `node-updates/apt-changelog` · P2
  - 用户操作：查看某包的变更日志。
  - API：`GET /nodes/{node}/apt/changelog`
  - 要点：参数 name、version。
- **升级（通过 Shell）** · `node-updates/apt-upgrade` · P2
  - 用户操作：Upgrade 按钮打开节点 Shell 执行 apt dist-upgrade。
  - API：`POST /nodes/{node}/termproxy`
  - 要点：cmd=upgrade（仅 root@pam）。没有 REST 升级接口。
- **软件源** · `node-updates/apt-repos` · P2
  - 用户操作：列出 sources 文件与各源（类型、URI、套件、组件、启用、来源 Proxmox/Debian），状态检查（缺企业订阅、no-subscription 用于生产等警告），启用/禁用，添加标准源（enterprise/no-subscription/test/ceph-*）。
  - API：`GET /nodes/{node}/apt/repositories`；`POST /nodes/{node}/apt/repositories`；`PUT /nodes/{node}/apt/repositories`
  - 要点：GET 返回 files、errors、infos、standard-repos、digest。POST（path、index、enabled）改启用状态；PUT（handle）添加标准源。
- **包版本** · `node-updates/apt-versions` · P2
  - 用户操作：同 Summary 的 Package versions。
  - API：`GET /nodes/{node}/apt/versions`

### 3.7 Firewall

- **节点防火墙** · `firewall/node-firewall` · P2
  - 用户操作：节点规则、节点选项（启用、日志级别 in/out/forward、SMURFS、TCP flags、nf_conntrack 参数、nftables 后端、NDP、SYN flood 保护等）、日志。
  - API：`GET /nodes/{node}/firewall`；`GET /nodes/{node}/firewall/rules`；`POST /nodes/{node}/firewall/rules`；`GET /nodes/{node}/firewall/rules/{pos}`；`PUT /nodes/{node}/firewall/rules/{pos}`；`DELETE /nodes/{node}/firewall/rules/{pos}`；`GET /nodes/{node}/firewall/options`；`PUT /nodes/{node}/firewall/options`；`GET /nodes/{node}/firewall/log`
  - 要点：log 参数 start、limit、since、until。nftables=1 切换到 proxmox-firewall（nft）后端。

### 3.8 Disks

- **磁盘列表** · `node-disks/disk-list` · P2
  - 用户操作：物理盘：设备、类型（HDD/SSD/NVMe/USB）、用途（LVM/ZFS/OSD/分区/mounted）、大小、GPT、型号、序列号、S.M.A.R.T. 状态、磨损；可展开分区。
  - API：`GET /nodes/{node}/disks/list`
  - 要点：参数 include-partitions=1、skipsmart、type=unused|journal_disks。
- **S.M.A.R.T. 详情** · `node-disks/disk-smart` · P2
  - 用户操作：查看属性表或文本输出。
  - API：`GET /nodes/{node}/disks/smart`
  - 要点：参数 disk、healthonly。
- **初始化 GPT** · `node-disks/disk-initgpt` · P2
  - 用户操作：对空盘写 GPT 分区表。
  - API：`POST /nodes/{node}/disks/initgpt`
  - 要点：参数 disk、uuid。返回 UPID。
- **擦除磁盘/分区** · `node-disks/disk-wipe` · P2
  - 用户操作：危险：擦除分区表与签名（输入设备名确认）。
  - API：`PUT /nodes/{node}/disks/wipedisk`
  - 要点：参数 disk。返回 UPID。
- **LVM 卷组** · `node-disks/disk-lvm` · P2
  - 用户操作：列出 VG/PV 与用量；在空盘上创建 VG（可同时添加存储）；删除 VG（可清理存储配置与磁盘）。
  - API：`GET /nodes/{node}/disks/lvm`；`POST /nodes/{node}/disks/lvm`；`DELETE /nodes/{node}/disks/lvm/{name}`
  - 要点：POST 参数 name、device、add_storage；DELETE 参数 cleanup-config、cleanup-disks。
- **LVM-Thin 池** · `node-disks/disk-lvmthin` · P2
  - 用户操作：列出 thin pool 与元数据用量；在空盘上创建；删除。
  - API：`GET /nodes/{node}/disks/lvmthin`；`POST /nodes/{node}/disks/lvmthin`；`DELETE /nodes/{node}/disks/lvmthin/{name}`
  - 要点：DELETE 需 volume-group 参数。
- **目录（文件系统）** · `node-disks/disk-directory` · P2
  - 用户操作：列出 /mnt/pve 下由 systemd mount 管理的目录；在空盘上创建 ext4/xfs 并挂载为目录存储；删除。
  - API：`GET /nodes/{node}/disks/directory`；`POST /nodes/{node}/disks/directory`；`DELETE /nodes/{node}/disks/directory/{name}`
- **ZFS 池** · `node-disks/disk-zfs` · P2
  - 用户操作：列出 zpool（大小、可用、碎片、去重、健康）；详情（vdev 树、scan、errors）；创建（单盘/镜像/RAID10/RAIDZ1-3/dRAID、ashift、压缩、添加存储）；删除。
  - API：`GET /nodes/{node}/disks/zfs`；`GET /nodes/{node}/disks/zfs/{name}`；`POST /nodes/{node}/disks/zfs`；`DELETE /nodes/{node}/disks/zfs/{name}`
  - 要点：POST 参数 name、raidlevel、devices（逗号分隔）、ashift、compression、draid-config、add_storage。

### 3.9 Ceph（节点级）

- **Ceph 安装向导** · `ceph/ceph-install` · P3
  - 用户操作：选择 Ceph 版本（squid/…）与仓库（enterprise/no-subscription/test），Shell 中安装，然后初始化配置（public/cluster 网络、副本数、最小副本数）并创建首个 Monitor。
  - API：`GET /nodes/{node}/ceph/releases`；`POST /nodes/{node}/termproxy`；`POST /nodes/{node}/ceph/init`；`POST /nodes/{node}/ceph/mon/{monid}`
  - 要点：termproxy cmd=ceph_install、cmd-opts 版本与仓库（NUL 分隔）；init 参数 network、cluster-network、size、min_size、pg_bits、disable_cephx。
- **Ceph 状态（节点）** · `ceph/ceph-node-status` · P3
  - 用户操作：同数据中心 Ceph 状态，节点视角。
  - API：`GET /nodes/{node}/ceph/status`；`GET /nodes/{node}/ceph`
- **Ceph 配置** · `ceph/ceph-config` · P3
  - 用户操作：查看 ceph.conf 原文、配置数据库（ceph config dump）、CRUSH map 文本、单项配置值。
  - API：`GET /nodes/{node}/ceph/cfg`；`GET /nodes/{node}/ceph/cfg/raw`；`GET /nodes/{node}/ceph/cfg/db`；`GET /nodes/{node}/ceph/cfg/value`；`GET /nodes/{node}/ceph/crush`
  - 要点：cfg/value 参数 config-keys=`section:key;…`。
- **Monitor / Manager** · `ceph/ceph-mon-mgr` · P3
  - 用户操作：列出 MON、MGR（主机、地址、状态、版本、quorum），创建/销毁，启动/停止/重启，查看服务日志。
  - API：`GET /nodes/{node}/ceph/mon`；`POST /nodes/{node}/ceph/mon/{monid}`；`DELETE /nodes/{node}/ceph/mon/{monid}`；`GET /nodes/{node}/ceph/mgr`；`POST /nodes/{node}/ceph/mgr/{id}`；`DELETE /nodes/{node}/ceph/mgr/{id}`；`POST /nodes/{node}/ceph/start`；`POST /nodes/{node}/ceph/stop`；`POST /nodes/{node}/ceph/restart`；`GET /nodes/{node}/ceph/cmd-safety`；`GET /nodes/{node}/syslog`
  - 要点：start/stop/restart 参数 service=`mon.<id>`/`mgr.<id>`/`osd.<id>`/`mds.<id>`；停止/销毁前用 cmd-safety（service、id、action=stop|destroy）检查是否安全。
- **OSD** · `ceph/ceph-osd` · P3
  - 用户操作：OSD 树（主机/OSD、设备类、状态 up/down in/out、使用率、延迟、版本、PG 数），创建（磁盘、DB/WAL 盘与大小、加密、设备类、每盘 OSD 数），In/Out，Start/Stop/Restart，Scrub/Deep Scrub，销毁（可清理），OSD 详情（元数据、LV 信息），全局 flags 设置。
  - API：`GET /nodes/{node}/ceph/osd`；`POST /nodes/{node}/ceph/osd`；`DELETE /nodes/{node}/ceph/osd/{osdid}`；`GET /nodes/{node}/ceph/osd/{osdid}`；`GET /nodes/{node}/ceph/osd/{osdid}/metadata`；`GET /nodes/{node}/ceph/osd/{osdid}/lv-info`；`POST /nodes/{node}/ceph/osd/{osdid}/in`；`POST /nodes/{node}/ceph/osd/{osdid}/out`；`POST /nodes/{node}/ceph/osd/{osdid}/scrub`；`GET /nodes/{node}/disks/list`
  - 要点：创建参数 dev、db_dev、db_dev_size、wal_dev、wal_dev_size、encrypted、crush-device-class、osds-per-device。lv-info 参数 type=block|db|wal。
- **CephFS 与 MDS** · `ceph/ceph-fs` · P3
  - 用户操作：列出 CephFS、创建（名称、PG 数、自动添加存储）、删除（可删池与存储）；MDS 列表、创建（hotstandby）、销毁、启停。
  - API：`GET /nodes/{node}/ceph/fs`；`POST /nodes/{node}/ceph/fs/{name}`；`DELETE /nodes/{node}/ceph/fs/{name}`；`GET /nodes/{node}/ceph/mds`；`POST /nodes/{node}/ceph/mds/{name}`；`DELETE /nodes/{node}/ceph/mds/{name}`
- **Ceph 池** · `ceph/ceph-pools` · P3
  - 用户操作：池列表（size/min_size、PG、自动伸缩、CRUSH 规则、使用率、application），创建/编辑（副本或纠删码、target size/ratio、pg_num_min、添加存储），删除（可删存储/EC profile），池状态。
  - API：`GET /nodes/{node}/ceph/pool`；`POST /nodes/{node}/ceph/pool`；`GET /nodes/{node}/ceph/pool/{name}`；`PUT /nodes/{node}/ceph/pool/{name}`；`DELETE /nodes/{node}/ceph/pool/{name}`；`GET /nodes/{node}/ceph/pool/{name}/status`；`GET /nodes/{node}/ceph/rules`
  - 要点：erasure-coding=`k=2,m=1,device-class=…`。
- **Ceph 日志** · `ceph/ceph-log` · P3
  - 用户操作：节点 Ceph 集群日志。
  - API：`GET /nodes/{node}/ceph/log`
  - 要点：参数 start、limit。
- **节点 Ceph 服务批量重启** · `ceph/ceph-node-bulk-restart` · P3
  - 用户操作：重启本节点全部指定类型服务（可设置 noout、仅过期版本）。
  - API：`POST /nodes/{node}/ceph/restart-bulk`
  - 要点：参数 service-type、only-outdated、set-noout、dry-run、force、timeout、resume。

### 3.10 Replication

- **节点 Replication** · `replication/node-replication` · P2
  - 用户操作：本节点作为源的复制任务、上次/下次同步、耗时、失败次数、状态；立即同步、日志。
  - API：`GET /nodes/{node}/replication`；`GET /nodes/{node}/replication/{id}`；`GET /nodes/{node}/replication/{id}/status`；`GET /nodes/{node}/replication/{id}/log`；`POST /nodes/{node}/replication/{id}/schedule_now`

### 3.11 Subscription

- **节点订阅** · `dc-options/node-subscription` · P3
  - 用户操作：查看订阅状态/级别/到期/服务器 ID/套接字数，上传密钥，检查（刷新），删除；系统报告。
  - API：`GET /nodes/{node}/subscription`；`PUT /nodes/{node}/subscription`；`POST /nodes/{node}/subscription`；`DELETE /nodes/{node}/subscription`；`GET /nodes/{node}/report`
  - 要点：PUT key=<pve…>；POST force=1 立即联网检查。

### 3.12 批量操作

- **节点批量操作** · `guest-lifecycle/node-bulk` · P1
  - 用户操作：Bulk Start / Shutdown / Suspend / Migrate：勾选本节点客户机，设置并发数、超时、强制停止、目标节点、带本地盘迁移。
  - API：`POST /nodes/{node}/startall`；`POST /nodes/{node}/stopall`；`POST /nodes/{node}/suspendall`；`POST /nodes/{node}/migrateall`
  - 要点：vms=逗号分隔 VMID；startall 参数 force（忽略 onboot）、max-workers；stopall 参数 timeout、force-stop；migrateall 参数 target、with-local-disks、max-workers。返回 UPID。

### 3.13 硬件/能力查询（选择器）

- **主机硬件与能力查询（选择器用）** · `qemu-config/node-hw-scan` · P1
  - 用户操作：PCI/USB 设备列表、CPU 型号、CPU flags、机器类型、迁移能力。
  - API：`GET /nodes/{node}/hardware`；`GET /nodes/{node}/hardware/pci`；`GET /nodes/{node}/hardware/usb`；`GET /nodes/{node}/capabilities`；`GET /nodes/{node}/capabilities/qemu`；`GET /nodes/{node}/capabilities/qemu/cpu`；`GET /nodes/{node}/capabilities/qemu/cpu-flags`；`GET /nodes/{node}/capabilities/qemu/machines`；`GET /nodes/{node}/capabilities/qemu/migration`

### 3.14 节点下的 SDN 浏览

- **节点下的 SDN Zone / Fabric 浏览** · `sdn-fabrics/node-sdn-browse` · P3
  - 用户操作：资源树中节点下的 Zone：VNet 内容、权限、网桥（端口/VLAN）、EVPN IP-VRF / MAC-VRF；Fabric：路由、邻居、接口。
  - API：`GET /nodes/{node}/sdn`；`GET /nodes/{node}/sdn/zones`；`GET /nodes/{node}/sdn/zones/{zone}`；`GET /nodes/{node}/sdn/zones/{zone}/content`；`GET /nodes/{node}/sdn/zones/{zone}/bridges`；`GET /nodes/{node}/sdn/zones/{zone}/ip-vrf`；`GET /nodes/{node}/sdn/vnets/{vnet}`；`GET /nodes/{node}/sdn/vnets/{vnet}/mac-vrf`；`GET /nodes/{node}/sdn/fabrics/{fabric}`；`GET /nodes/{node}/sdn/fabrics/{fabric}/routes`；`GET /nodes/{node}/sdn/fabrics/{fabric}/neighbors`；`GET /nodes/{node}/sdn/fabrics/{fabric}/interfaces`

## 4. QEMU 虚拟机

### 4.1 Summary / 电源

- **VM 状态** · `guest-summary-power/vm-status` · P1
  - 用户操作：Summary：运行状态（含 paused/suspended/prelaunch）、HA 状态、节点、CPU/内存（含 balloon、host 侧内存）、启动磁盘大小、uptime、锁、Guest Agent 是否连接、QEMU 版本/机器类型。
  - API：`GET /nodes/{node}/qemu/{vmid}/status/current`
  - 要点：字段 status、qmpstatus、cpu、cpus、mem、maxmem、memhost、balloon、ballooninfo、maxdisk、uptime、ha、lock、agent、running-machine、running-qemu、tags、template、proxmox-support、pressure*。
- **VM RRD 图** · `guest-summary-power/vm-rrd` · P1
  - 用户操作：CPU、内存（含 host 内存）、网络流量、磁盘 IO、PSI 压力；时间范围与平均/最大切换。
  - API：`GET /nodes/{node}/qemu/{vmid}/rrddata`
  - 要点：timeframe=hour|day|week|month|year，cf=AVERAGE|MAX。字段 cpu、maxcpu、mem、maxmem、memhost、disk、maxdisk、diskread、diskwrite、netin、netout、pressure*。
- **VM IP 地址** · `guest-summary-power/vm-ips` · P1
  - 用户操作：通过 Guest Agent 展示各网卡 IPv4/IPv6 与 MAC，可展开全部。
  - API：`GET /nodes/{node}/qemu/{vmid}/agent/network-get-interfaces`
  - 要点：agent 未启用或未运行时返回 500，需显示“Guest Agent 未运行”。过滤 lo 和链路本地地址。
- **VM 备注** · `guest-summary-power/vm-notes` · P1
  - 用户操作：Summary 中的 Notes（Markdown）查看/编辑。
  - API：`PUT /nodes/{node}/qemu/{vmid}/config`
  - 要点：字段 description（写到配置文件注释）。
- **VM 标签** · `guest-summary-power/vm-tags` · P1
  - 用户操作：标题栏编辑标签（增删、颜色按数据中心 tag-style）。
  - API：`PUT /nodes/{node}/qemu/{vmid}/config`
  - 要点：字段 tags，分号分隔。受 user-tag-access（none/list/existing/free）与 registered-tags 约束。
- **VM 电源操作** · `guest-summary-power/vm-power` · P1
  - 用户操作：启动、关机（ACPI/agent）、停止（硬断电）、重启、重置、暂停、休眠（挂起到磁盘）、恢复。
  - API：`POST /nodes/{node}/qemu/{vmid}/status/start`；`POST /nodes/{node}/qemu/{vmid}/status/shutdown`；`POST /nodes/{node}/qemu/{vmid}/status/stop`；`POST /nodes/{node}/qemu/{vmid}/status/reboot`；`POST /nodes/{node}/qemu/{vmid}/status/reset`；`POST /nodes/{node}/qemu/{vmid}/status/suspend`；`POST /nodes/{node}/qemu/{vmid}/status/resume`
  - 要点：全部返回 UPID。shutdown 参数 timeout、forceStop；stop 参数 overrule-shutdown=1（官方在已有关机任务时勾选“覆盖关机任务”）、timeout；suspend 参数 todisk=1（休眠）+ statestorage；resume 对 paused 与 suspended 都适用（qmpstatus 判断显示哪个）。模板不可启动。HA 管理的 VM 这些操作会转为 HA 请求（任务类型 hastart/hastop）。
- **模板 Summary** · `guest-summary-power/vm-template-summary` · P1
  - 用户操作：模板只显示配置摘要与备注，提供克隆入口。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`
- **Guest Agent 信息（官方 UI 未用，可选）** · `guest-summary-power/vm-agent-extra` · P1
  - 用户操作：可选展示 OS 信息、主机名、时区、用户、文件系统；执行 fstrim、fsfreeze、设置用户密码、执行命令、读写文件。官方 UI 仅用 network-get-interfaces。
  - API：`GET /nodes/{node}/qemu/{vmid}/agent/info`；`GET /nodes/{node}/qemu/{vmid}/agent/get-osinfo`；`GET /nodes/{node}/qemu/{vmid}/agent/get-host-name`；`GET /nodes/{node}/qemu/{vmid}/agent/get-fsinfo`；`GET /nodes/{node}/qemu/{vmid}/agent/get-time`；`GET /nodes/{node}/qemu/{vmid}/agent/get-timezone`；`GET /nodes/{node}/qemu/{vmid}/agent/get-users`；`GET /nodes/{node}/qemu/{vmid}/agent/get-vcpus`；`GET /nodes/{node}/qemu/{vmid}/agent/get-memory-blocks`；`GET /nodes/{node}/qemu/{vmid}/agent/get-memory-block-info`；`GET /nodes/{node}/qemu/{vmid}/agent/get-load`；`GET /nodes/{node}/qemu/{vmid}/agent/get-cpustats`；`GET /nodes/{node}/qemu/{vmid}/agent/get-disks`；`GET /nodes/{node}/qemu/{vmid}/agent/get-diskstats`；`POST /nodes/{node}/qemu/{vmid}/agent/ping`；`POST /nodes/{node}/qemu/{vmid}/agent/fstrim`；`POST /nodes/{node}/qemu/{vmid}/agent/fsfreeze-freeze`；`POST /nodes/{node}/qemu/{vmid}/agent/fsfreeze-thaw`；`POST /nodes/{node}/qemu/{vmid}/agent/fsfreeze-status`；`POST /nodes/{node}/qemu/{vmid}/agent/set-user-password`；`POST /nodes/{node}/qemu/{vmid}/agent/exec`；`GET /nodes/{node}/qemu/{vmid}/agent/exec-status`；`GET /nodes/{node}/qemu/{vmid}/agent/file-read`；`POST /nodes/{node}/qemu/{vmid}/agent/file-write`；`POST /nodes/{node}/qemu/{vmid}/agent/shutdown`；`POST /nodes/{node}/qemu/{vmid}/agent/suspend-disk`；`POST /nodes/{node}/qemu/{vmid}/agent/suspend-ram`；`POST /nodes/{node}/qemu/{vmid}/agent/suspend-hybrid`；`GET /nodes/{node}/qemu/{vmid}/agent`；`POST /nodes/{node}/qemu/{vmid}/agent`
  - 要点：决定：Phase 1 只做 OS 信息/主机名/IP 只读展示；exec、file-write、set-user-password 等写操作排到最后并加二次确认。get-load、get-cpustats、get-disks、get-diskstats（qemu-server ≥ 9.2.14，`guestAgentStats`）在概要页「系统内统计」卡片只读展示，不支持的命令静默隐藏。

### 4.2 Console

- **VM noVNC 控制台** · `console/vm-novnc` · P1
  - 用户操作：嵌入式 noVNC：缩放、全屏、Ctrl+Alt+Del、剪贴板（spice/vnc clipboard）、手机虚拟键盘。
  - API：`POST /nodes/{node}/qemu/{vmid}/vncproxy`；`GET /nodes/{node}/qemu/{vmid}/vncwebsocket`
  - 要点：vncproxy 带 websocket=1，返回 port、ticket、cert、user、upid；WS 地址 /api2/json/nodes/{node}/qemu/{vmid}/vncwebsocket?port=…&vncticket=<encodeURIComponent(ticket)>；noVNC 的 VNC 密码填 ticket。ticket 有效期很短，必须立即连接。VM 未运行时显示“启动”按钮。
- **VM 串口终端（xterm.js）** · `console/vm-xterm-serial` · P1
  - 用户操作：VM 配了 serial0 且显示为 serial 时，用 xterm.js 连串口。
  - API：`POST /nodes/{node}/qemu/{vmid}/termproxy`；`GET /nodes/{node}/qemu/{vmid}/vncwebsocket`
  - 要点：termproxy 参数 serial=serial0..3；协议同节点 Shell。
- **VM SPICE** · `console/vm-spice` · P1
  - 用户操作：vga=qxl/virtio 等 SPICE 显示时，下载 .vv 文件用 virt-viewer 打开。
  - API：`POST /nodes/{node}/qemu/{vmid}/spiceproxy`
  - 要点：参数 proxy（默认用当前访问主机名）。
- **发送按键** · `console/vm-sendkey` · P1
  - 用户操作：向 VM 发送 Ctrl+Alt+Del 等组合键（无需打开控制台）。
  - API：`PUT /nodes/{node}/qemu/{vmid}/sendkey`
  - 要点：参数 key，如 ctrl-alt-delete、ctrl-alt-f1。

### 4.3 Hardware / Cloud-Init / Options / Monitor

- **硬件列表 + pending** · `qemu-config/vm-hw-view` · P1
  - 用户操作：列出全部硬件项；未生效的变更（pending）高亮，可单项“撤销”；硬件和选项页可查看应用条件，并尝试在线应用符合条件且有权限的参数。
  - API：`GET /nodes/{node}/qemu/{vmid}/pending`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 在线重试：按当前生效配置判定，不能使用 pending 中的热插拔开关、NUMA 或 CPU 拓扑；POST 原待生效值及原 digest，等待任务结束后重新读取 pending，逐项确认实际值。没有 dry-run 能力，未知项和设备删除不批量提交；任务 OK 不代表所有参数生效。
  - 要点：/pending 返回 key、value、pending、delete 标记。撤销 = PUT config revert=<key>。
- **内存** · `qemu-config/vm-hw-memory` · P1
  - 用户操作：内存大小、最小内存（Ballooning）、启用/禁用 balloon 设备、KSM 允许。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：memory（9.x 为属性串 `current=<MiB>`，也接受纯数字）、balloon（0=禁用 balloon 设备）、shares、allow-ksm。PUT 同步返回、POST 异步返回 UPID（官方：会创建/导入磁盘的修改用 POST，其余用 PUT）。删除键用 delete=key1,key2；带 digest 防并发覆盖；运行中不能热插的改动进入 pending（GET /pending 可见，带红色标记），revert=key 撤销。
- **处理器** · `qemu-config/vm-hw-cpu` · P1
  - 用户操作：插槽、核心、CPU 类型（含自定义型号）、CPU flags、vCPU 热插数、CPU 限制、CPU 权重、亲和性、NUMA。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/capabilities/qemu/cpu`；`GET /nodes/{node}/capabilities/qemu/cpu-flags`；`GET /cluster/qemu/cpu-flags`；`GET /cluster/qemu/custom-cpu-models`
  - 要点：sockets、cores、vcpus、cpu（属性串 `[cputype=]x86-64-v2-AES,flags=+aes;-pcid,hidden=1,phys-bits=…`；自定义型号写 custom-<name>）、cpulimit、cpuunits、affinity、numa、numa[n]。
- **vCPU 架构** · `qemu-config/vm-hw-arch` · P1
  - 用户操作：x86_64 / aarch64（9.x 新增，可在 x86 主机上模拟 aarch64）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：arch；只能 root@pam 修改。
- **BIOS** · `qemu-config/vm-hw-bios` · P1
  - 用户操作：SeaBIOS / OVMF (UEFI)；切到 OVMF 时提示添加 EFI 盘。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：bios=seabios|ovmf。
- **显示** · `qemu-config/vm-hw-display` · P1
  - 用户操作：显卡类型（default/std/vmware/qxl/virtio/virtio-gl/serial0-3/none 等）、显存、剪贴板（vnc）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：vga 属性串：type、memory、clipboard=vnc。
- **机器类型** · `qemu-config/vm-hw-machine` · P1
  - 用户操作：i440fx / q35、版本固定、vIOMMU、aw-bits、S3/S4。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/capabilities/qemu/machines`
  - 要点：machine 属性串：type（如 pc-q35-9.2+pve1 或 q35）、viommu=intel|virtio、aw-bits、enable-s3、enable-s4。Windows 新建 VM 默认固定版本。
- **SCSI 控制器** · `qemu-config/vm-hw-scsihw` · P1
  - 用户操作：lsi / lsi53c810 / virtio-scsi-pci / virtio-scsi-single / megasas / pvscsi。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：scsihw。
- **硬盘（添加/编辑）** · `qemu-config/vm-hw-disk` · P1
  - 用户操作：选择总线（IDE/SATA/SCSI/VirtIO Block）与编号、存储、大小、格式（raw/qcow2/vmdk）、缓存、Discard、IO thread、SSD 模拟、只读、备份/复制开关、异步 IO、带宽/IOPS 限制；也可直接导入镜像（import-from）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/storage`
  - 要点：新盘写法 `scsi1=<storage>:<sizeGiB>,discard=on,iothread=1,ssd=1`（POST 异步）；导入写法 `scsi1=<storage>:0,import-from=<volid>`。编辑既有盘只改选项（PUT）。存储列表用 /nodes/{node}/storage?content=images&enabled=1。
- **导入硬盘** · `qemu-config/vm-hw-import-disk` · P1
  - 用户操作：从存储中的 import 内容（qcow2/vmdk/raw/ova 内盘）或其他 VM 的磁盘导入为新盘。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/storage/{storage}/content`
  - 要点：scsiN=<target-storage>:0,import-from=<source volid 或绝对路径（root）>。
- **磁盘动作：迁移存储 / 转移给其他客户机 / 扩容 / 分离 / 删除** · `qemu-config/vm-hw-disk-actions` · P1
  - 用户操作：Move Storage（可删除源盘、选格式、限速）、Reassign Owner（转给另一 VM 的指定插槽）、Resize（只能增大，+G）、Detach（变 unused）、Remove unused（删卷）。
  - API：`POST /nodes/{node}/qemu/{vmid}/move_disk`；`PUT /nodes/{node}/qemu/{vmid}/resize`；`PUT /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/unlink`
  - 要点：move_disk 参数 disk、storage、format、delete、bwlimit；reassign 用同一接口带 target-vmid、target-disk（target-digest）。resize 参数 disk、size（`+10G` 或绝对值）。detach = PUT delete=scsi1（变成 unusedN）；彻底删除 unused = PUT delete=unused0（会删卷）。unlink 为替代接口（idlist、force）。
- **CD/DVD 光驱** · `qemu-config/vm-hw-cdrom` · P1
  - 用户操作：添加光驱、选 ISO（存储+文件）、物理光驱或无介质，弹出/更换介质。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/storage/{storage}/content`
  - 要点：`ide2=local:iso/x.iso,media=cdrom` / `ide2=none,media=cdrom` / `cdrom`。运行中可换盘（PUT）。
- **CloudInit 驱动器** · `qemu-config/vm-hw-cloudinit-drive` · P1
  - 用户操作：添加 cloud-init 驱动器（IDE/SATA/SCSI，指定存储）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：`ide0=<storage>:cloudinit`（POST）。
- **网络设备** · `qemu-config/vm-hw-net` · P1
  - 用户操作：网桥、VLAN tag、型号（virtio/e1000/e1000e/vmxnet3/rtl8139…）、MAC、防火墙开关、断开链路、限速、多队列、MTU、Trunks。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/network`
  - 要点：net0=`virtio=BC:24:11:..:..:..,bridge=vmbr0,tag=10,firewall=1,link_down=1,rate=10,queues=4,mtu=1`；可选的 SDN vnet 作为 bridge。网桥列表：GET /nodes/{node}/network?type=any_bridge 加 SDN vnets（/cluster/resources?type=sdn 或 /nodes/{node}/sdn/zones/{zone}/content）。
- **EFI 磁盘** · `qemu-config/vm-hw-efidisk` · P1
  - 用户操作：添加 EFI vars 盘（存储、格式、预注册密钥/Secure Boot、4m 类型），以及“注册新版微软证书（2023）”。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：efidisk0=`<storage>:1,efitype=4m,pre-enrolled-keys=1,ms-cert=2023k`。9.2 硬件页的 Disk Action → Enroll Updated Certificates：PUT efidisk0 加 ms-cert=2023k。
- **TPM 状态** · `qemu-config/vm-hw-tpm` · P1
  - 用户操作：添加 TPM（v1.2/v2.0）到指定存储。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：tpmstate0=`<storage>:1,version=v2.0`（POST）。
- **USB 设备** · `qemu-config/vm-hw-usb` · P1
  - 用户操作：直通主机 USB（按厂商/产品 ID 或端口）、集群映射的 USB、spice 重定向；USB3 选项。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/hardware/usb`；`GET /cluster/mapping/usb`
  - 要点：usb0=`host=1234:5678,usb3=1` / `host=1-2.3` / `mapping=<id>` / `spice`。映射列表 /cluster/mapping/usb?check-node=<node>。
- **PCI 设备** · `qemu-config/vm-hw-pci` · P1
  - 用户操作：直通 PCI/PCIe（原始设备或集群映射）、全部功能、主 GPU、ROM-Bar、PCI-Express、mediated device（vGPU 类型）、设备/厂商 ID 覆盖。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /nodes/{node}/hardware/pci`；`GET /nodes/{node}/hardware/pci/{pci-id-or-mapping}`；`GET /nodes/{node}/hardware/pci/{pci-id-or-mapping}/mdev`；`GET /cluster/mapping/pci`
  - 要点：hostpci0=`0000:01:00,pcie=1,x-vga=1,rombar=1,mdev=nvidia-xx` 或 `mapping=<id>`。需要 q35 才能 pcie=1。PCI 列表参数 pci-class-blacklist、verbose。直通后不能实时迁移（除非映射标记 live-migration-capable）。
- **串口** · `qemu-config/vm-hw-serial` · P1
  - 用户操作：添加串口（socket 或主机设备路径）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：serial0=socket | /dev/ttyS0。
- **音频设备** · `qemu-config/vm-hw-audio` · P1
  - 用户操作：ich9-intel-hda / intel-hda / AC97，驱动 spice/none。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：audio0=`device=ich9-intel-hda,driver=spice`。
- **VirtIO RNG** · `qemu-config/vm-hw-rng` · P1
  - 用户操作：随机数源 /dev/urandom /dev/random /dev/hwrng，限速。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：rng0=`source=/dev/urandom,max_bytes=1024,period=1000`；仅 root 可用 /dev/hwrng。
- **Virtiofs 共享目录** · `qemu-config/vm-hw-virtiofs` · P1
  - 用户操作：把集群目录映射共享进 VM（cache、direct-io、xattr、ACL）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`；`GET /cluster/mapping/dir`
  - 要点：virtiofs0=`dirid=<mapping id>,cache=auto,expose-acl=1`；映射列表 /cluster/mapping/dir?check-node=<node>。
- **AMD SEV / Intel TDX** · `qemu-config/vm-hw-sev-tdx` · P1
  - 用户操作：机密计算：SEV（std/es/snp、no-debug、no-key-sharing、kernel-hashes）与 TDX 设置。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：amd-sev、intel-tdx 属性串；需要 OVMF 与主机支持；仅 root。
- **键盘布局（VNC）** · `qemu-config/vm-hw-keyboard` · P1
  - 用户操作：VM 级 VNC 键盘布局（已不推荐）。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：keyboard。
- **未使用磁盘** · `qemu-config/vm-hw-unused` · P1
  - 用户操作：unusedN 列表：重新挂载（选总线）或删除。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：挂载 = PUT scsiX=<volid 原值>；删除 = PUT delete=unusedN。
- **Cloud-Init 配置** · `qemu-config/vm-cloudinit` · P1
  - 用户操作：用户名、密码、DNS 域/服务器、SSH 公钥（可上传文件）、升级包开关、各网卡 IP 配置（DHCP/静态/SLAAC）、自定义 cicustom、类型；“重新生成镜像”；查看生成的 user/network/meta 数据。
  - API：`GET /nodes/{node}/qemu/{vmid}/cloudinit`；`PUT /nodes/{node}/qemu/{vmid}/cloudinit`；`GET /nodes/{node}/qemu/{vmid}/cloudinit/dump`；`PUT /nodes/{node}/qemu/{vmid}/config`
  - 要点：字段 ciuser、cipassword（写入后只回显 **********）、searchdomain、nameserver、sshkeys（URL 编码！官方用 encodeURIComponent 后再提交）、ciupgrade、citype=nocloud|configdrive2|opennebula、cicustom=`user=local:snippets/u.yaml,...`、ipconfigN=`ip=dhcp,ip6=auto` 或 `ip=10.0.0.2/24,gw=10.0.0.1`。GET /cloudinit 返回各项 pending 差异；PUT /cloudinit 重新生成镜像；dump 参数 type=user|network|meta。
- **VM 选项** · `qemu-config/vm-options` · P1
  - 用户操作：名称、开机自启、启动/关机顺序与延时、OS 类型、启动顺序（拖拽排序）、平板指针、热插拔、ACPI、KVM 硬件虚拟化、启动时冻结 CPU、RTC 本地时间、RTC 起始日期、SMBIOS type1、QEMU Guest Agent（启用、fs-freeze、fstrim、类型）、保护、SPICE 增强、VM 状态存储、hookscript。
  - API：`GET /nodes/{node}/qemu/{vmid}/config`；`PUT /nodes/{node}/qemu/{vmid}/config`；`POST /nodes/{node}/qemu/{vmid}/config`
  - 要点：name、onboot、startup=`order=1,up=30,down=60`、ostype（l26/win11/…）、boot=`order=scsi0;ide2;net0`、tablet、hotplug=`disk,network,usb,memory,cpu`（0 关闭）、acpi、kvm、freeze、localtime、startdate、smbios1（uuid、manufacturer…，值需 base64 时加 base64=1）、agent=`enabled=1,freeze-fs-on-backup=1,fstrim_cloned_disks=1,type=virtio`、protection、spice_enhancements=`foldersharing=1,videostreaming=all`、vmstatestorage、hookscript=`local:snippets/x.pl`（仅 root）。
- **QEMU Monitor** · `qemu-config/vm-monitor` · P1
  - 用户操作：交互输入 HMP 命令（info status、info block…）查看输出（仅 root 有完整权限）。
  - API：`POST /nodes/{node}/qemu/{vmid}/monitor`
  - 要点：参数 command，返回文本。非 root 只允许 info 类命令（Sys.Audit）。

### 4.4 Snapshots / Backup / 恢复

- **VM 快照** · `guest-snapshots-backup/vm-snapshots` · P1
  - 用户操作：快照树（含 NOW）：创建（名称、描述、包含内存 vmstate）、回滚（可选回滚后启动）、编辑描述、删除（可强制）。
  - API：`GET /nodes/{node}/qemu/{vmid}/snapshot`；`POST /nodes/{node}/qemu/{vmid}/snapshot`；`GET /nodes/{node}/qemu/{vmid}/snapshot/{snapname}`；`GET /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config`；`PUT /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/config`；`POST /nodes/{node}/qemu/{vmid}/snapshot/{snapname}/rollback`；`DELETE /nodes/{node}/qemu/{vmid}/snapshot/{snapname}`；`GET /nodes/{node}/qemu/{vmid}/feature`
  - 要点：列表项 name、parent、snaptime、description、vmstate、running；name=current 表示当前状态。能否快照先查 GET /feature?feature=snapshot（存储不支持时禁用按钮）。创建/回滚/删除返回 UPID。rollback 参数 start=1。
- **VM Backup 页** · `guest-snapshots-backup/vm-backup-tab` · P1
  - 用户操作：选择存储，列出该 VM 的全部备份（时间、大小、加密、校验、备注、保护），立即备份、恢复、删除、显示配置、编辑备注、切换保护、文件级恢复（PBS）。
  - API：`GET /nodes/{node}/storage`；`GET /nodes/{node}/storage/{storage}/content`；`GET /nodes/{node}/vzdump/extractconfig`；`PUT /nodes/{node}/storage/{storage}/content/{volume}`；`DELETE /nodes/{node}/storage/{storage}/content/{volume}`
  - 要点：content 参数 content=backup&vmid=<id>。显示配置 = GET /vzdump/extractconfig?volume=<volid>。备注/保护 = PUT content/{volume} notes、protected。
- **立即备份** · `guest-snapshots-backup/vm-backup-now` · P1
  - 用户操作：选择存储、模式（snapshot/suspend/stop）、压缩（zstd/lzo/gzip/none）、通知方式、受保护、备注模板（{{guestname}} 等变量）、PBS 变更检测模式（CT）。
  - API：`GET /nodes/{node}/vzdump/defaults`；`POST /nodes/{node}/vzdump`
  - 要点：POST 参数 vmid、storage、mode、compress、remove（按保留策略清理，默认 1）、notes-template（换行需转义为 \n）、protected、notification-mode=auto|legacy-sendmail|notification-system、mailto、pbs-change-detection-mode=legacy|data|metadata。defaults?storage= 返回该存储的默认值（prune-backups 等）。返回 UPID。
- **从备份恢复 VM** · `guest-snapshots-backup/vm-restore` · P1
  - 用户操作：覆盖当前 VM 或恢复为新 VMID：选目标存储、限速、唯一化（新 MAC 等）、恢复后启动、实时恢复（PBS）、覆盖名称/内存/CPU、加入 HA。
  - API：`POST /nodes/{node}/qemu`；`GET /nodes/{node}/vzdump/extractconfig`；`GET /cluster/nextid`
  - 要点：POST /nodes/{node}/qemu：vmid、archive=<volid>、storage、force=1（覆盖已有 VM）、unique、bwlimit、start、live-restore=1（与 start 互斥地自动启动）、name/memory/cores/sockets 覆盖、pool、ha-managed=1。返回 UPID（qmrestore）。

### 4.5 Replication

- **VM Replication 页** · `replication/vm-replication-tab` · P2
  - 用户操作：该 VM 的复制任务列表与状态、新增/编辑/删除、立即同步、查看日志。
  - API：`GET /nodes/{node}/replication`；`GET /cluster/replication`；`POST /cluster/replication`；`GET /nodes/{node}/replication/{id}/status`；`GET /nodes/{node}/replication/{id}/log`；`POST /nodes/{node}/replication/{id}/schedule_now`
  - 要点：节点列表接口带 guest=<vmid> 过滤。

### 4.6 Firewall

- **VM 防火墙** · `firewall/vm-firewall` · P2
  - 用户操作：规则、选项（启用、DHCP、NDP、RA、MAC/IP 过滤、默认策略、日志级别）、别名、IPSet（含 ipfilter-netX 自动集合）、日志。
  - API：`GET /nodes/{node}/qemu/{vmid}/firewall`；`GET /nodes/{node}/qemu/{vmid}/firewall/rules`；`POST /nodes/{node}/qemu/{vmid}/firewall/rules`；`GET /nodes/{node}/qemu/{vmid}/firewall/rules/{pos}`；`PUT /nodes/{node}/qemu/{vmid}/firewall/rules/{pos}`；`DELETE /nodes/{node}/qemu/{vmid}/firewall/rules/{pos}`；`GET /nodes/{node}/qemu/{vmid}/firewall/options`；`PUT /nodes/{node}/qemu/{vmid}/firewall/options`；`GET /nodes/{node}/qemu/{vmid}/firewall/aliases`；`POST /nodes/{node}/qemu/{vmid}/firewall/aliases`；`GET /nodes/{node}/qemu/{vmid}/firewall/aliases/{name}`；`PUT /nodes/{node}/qemu/{vmid}/firewall/aliases/{name}`；`DELETE /nodes/{node}/qemu/{vmid}/firewall/aliases/{name}`；`GET /nodes/{node}/qemu/{vmid}/firewall/ipset`；`POST /nodes/{node}/qemu/{vmid}/firewall/ipset`；`GET /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}`；`POST /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}`；`DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}`；`GET /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr}`；`PUT /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr}`；`DELETE /nodes/{node}/qemu/{vmid}/firewall/ipset/{name}/{cidr}`；`GET /nodes/{node}/qemu/{vmid}/firewall/log`；`GET /nodes/{node}/qemu/{vmid}/firewall/refs`
  - 要点：与数据中心/节点规则编辑器共用组件；见“防火墙”通用说明。网卡需 firewall=1 才生效。

### 4.7 Permissions

- **VM 权限页** · `access-control/vm-permissions` · P3
  - 用户操作：查看/添加/删除作用于 /vms/<vmid> 的 ACL。
  - API：`GET /access/acl`；`PUT /access/acl`
  - 要点：过滤 path=/vms/<vmid>；需 Permissions.Modify。

### 4.8 迁移 / 克隆 / 模板 / 删除 / HA

- **迁移 VM** · `guest-lifecycle/vm-migrate` · P1
  - 用户操作：选目标节点、在线/离线、目标存储（本地盘）、带 conntrack 状态；显示前置检查（本地磁盘、本地资源、映射资源、HA 阻塞/依赖资源、不允许的节点）。
  - API：`GET /nodes/{node}/qemu/{vmid}/migrate`；`POST /nodes/{node}/qemu/{vmid}/migrate`；`GET /nodes/{node}/capabilities/qemu/migration`
  - 要点：GET /migrate?target= 返回 running、allowed_nodes、not_allowed_nodes{node:{unavailable-resources, blocking-ha-resources}}、local_disks、local_resources、mapped-resource-info、dependent-ha-resources、has-dbus-vmstate。POST 参数 target、online、with-local-disks、targetstorage（可 `src:dst` 映射）、force（本地资源）、with-conntrack-state、bwlimit。HA VM 迁移会变成 HA 请求。跨集群 remote_migrate 官方 UI 未提供（仅 CLI）。
- **克隆 VM** · `guest-lifecycle/vm-clone` · P1
  - 用户操作：目标节点、新 VMID、名称、资源池、模式（链接克隆/完整克隆，模板才可链接）、目标存储与格式、从快照克隆。
  - API：`POST /nodes/{node}/qemu/{vmid}/clone`；`GET /nodes/{node}/qemu/{vmid}/feature`；`GET /nodes/{node}/qemu/{vmid}/snapshot`；`GET /cluster/nextid`
  - 要点：参数 newid、name、target、full、storage、format、pool、snapname、description、bwlimit。feature?feature=clone 检查能否链接克隆。返回 UPID。
- **转换为模板** · `guest-lifecycle/vm-template` · P1
  - 用户操作：把停止的 VM 转为模板（不可逆，确认）。
  - API：`POST /nodes/{node}/qemu/{vmid}/template`
  - 要点：参数 disk（可只转换单盘，UI 不用）。
- **删除 VM** · `guest-lifecycle/vm-remove` · P1
  - 用户操作：危险确认（输入 VMID）；可选从任务配置（备份/复制/HA）中清除、删除未引用的磁盘。
  - API：`DELETE /nodes/{node}/qemu/{vmid}`
  - 要点：参数 purge=1、destroy-unreferenced-disks=1、skiplock。VM 必须已停止；protection=1 时拒绝。返回 UPID。
- **加入/管理 HA** · `guest-lifecycle/vm-ha-quick` · P1
  - 用户操作：更多菜单 → Manage HA：把 VM 加为 HA 资源（请求状态、最大重启/迁移次数、failback）。
  - API：`GET /cluster/ha/resources/{sid}`；`POST /cluster/ha/resources`；`PUT /cluster/ha/resources/{sid}`
  - 要点：sid=vm:<vmid>。

### 4.9 创建向导

- **创建 VM：常规** · `guest-create/vm-create-general` · P1
  - 用户操作：节点、VMID（自动建议）、名称、资源池、开机自启、启动顺序/延时、标签、加入 HA。
  - API：`GET /cluster/nextid`；`GET /pools`；`GET /nodes`
  - 要点：nextid 返回下一个可用 VMID（遵守数据中心 next-id 范围）；传 vmid 参数可校验是否可用（不可用返回 400）。
- **创建 VM：操作系统** · `guest-create/vm-create-os` · P1
  - 用户操作：选择 ISO（存储+文件）/物理光驱/无介质，客户机 OS 类型与版本；Windows 可额外挂 VirtIO 驱动 ISO。
  - API：`GET /nodes/{node}/storage`；`GET /nodes/{node}/storage/{storage}/content`
  - 要点：ostype 决定后续默认值（官方 PVE.qemu.OSDefaults：Windows 默认 SATA→SCSI+VirtIO、q35、OVMF、TPM 等）。
- **创建 VM：系统** · `guest-create/vm-create-system` · P1
  - 用户操作：显卡、机器类型、BIOS、添加 EFI 盘（存储/预注册密钥）、SCSI 控制器、Guest Agent、添加 TPM（存储/版本）。
  - API：`GET /nodes/{node}/capabilities/qemu/machines`
- **创建 VM：磁盘** · `guest-create/vm-create-disks` · P1
  - 用户操作：可添加多块盘：总线/编号、存储、大小、格式、缓存、Discard、IO thread、SSD、备份/复制、只读、异步 IO、限速。
  - API：`GET /nodes/{node}/storage`
- **创建 VM：CPU** · `guest-create/vm-create-cpu` · P1
  - 用户操作：插槽、核心、类型、vCPU、限制、权重、亲和、NUMA、flags。
  - API：`GET /nodes/{node}/capabilities/qemu/cpu`
- **创建 VM：内存** · `guest-create/vm-create-memory` · P1
  - 用户操作：内存、最小内存、balloon 开关、KSM。
  - API：无（纯前端）
- **创建 VM：网络** · `guest-create/vm-create-network` · P1
  - 用户操作：无网络 或 网桥/VLAN/型号/MAC/防火墙/限速/多队列/MTU。
  - API：`GET /nodes/{node}/network`
- **创建 VM：确认并创建** · `guest-create/vm-create-confirm` · P1
  - 用户操作：展示最终参数键值表，可勾选“创建后启动”。
  - API：`POST /nodes/{node}/qemu`
  - 要点：一次 POST 提交全部参数（vmid、name、ostype、ide2、scsihw、scsi0…、net0、start、ha-managed 等）。返回 UPID（qmcreate）。

## 5. LXC 容器

### 5.1 Summary / 电源

- **CT 状态** · `guest-summary-power/ct-status` · P1
  - 用户操作：Summary：状态、HA、CPU、内存、交换、根盘用量（CT 可直接读到实际用量）、uptime、锁、非特权标记。
  - API：`GET /nodes/{node}/lxc/{vmid}/status/current`
  - 要点：字段 status、cpu、cpus、mem、maxmem、swap、maxswap、disk、maxdisk、netin、netout、uptime、ha、lock、tags、template、pressure*。
- **CT RRD 图** · `guest-summary-power/ct-rrd` · P1
  - 用户操作：CPU、内存、网络、磁盘 IO、PSI 压力。
  - API：`GET /nodes/{node}/lxc/{vmid}/rrddata`
  - 要点：同 VM。
- **CT IP 地址** · `guest-summary-power/ct-ips` · P1
  - 用户操作：显示容器内各网卡 IP（不需要 agent）。
  - API：`GET /nodes/{node}/lxc/{vmid}/interfaces`
  - 要点：仅运行中可用；返回 name、hwaddr、inet、inet6。
- **CT 备注与标签** · `guest-summary-power/ct-notes-tags` · P1
  - 用户操作：编辑 Notes（Markdown）和标签。
  - API：`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：description、tags。
- **CT 电源操作** · `guest-summary-power/ct-power` · P1
  - 用户操作：启动、关机、停止、重启。挂起/恢复 API 存在（实验性），官方 UI 不提供入口，决定：不在 UI 中提供。
  - API：`POST /nodes/{node}/lxc/{vmid}/status/start`；`POST /nodes/{node}/lxc/{vmid}/status/shutdown`；`POST /nodes/{node}/lxc/{vmid}/status/stop`；`POST /nodes/{node}/lxc/{vmid}/status/reboot`；`POST /nodes/{node}/lxc/{vmid}/status/suspend`；`POST /nodes/{node}/lxc/{vmid}/status/resume`
  - 要点：shutdown 参数 timeout、forceStop；stop 参数 overrule-shutdown；start 参数 debug=1（调试日志）。返回 UPID。CT 处于 suspended（freeze）状态时官方禁用 Shutdown。

### 5.2 Console

- **CT 控制台** · `console/ct-console` · P1
  - 用户操作：xterm.js（默认，支持复制粘贴、自适应尺寸）或 noVNC；按容器 cmode（tty/console/shell）决定行为。
  - API：`POST /nodes/{node}/lxc/{vmid}/termproxy`；`POST /nodes/{node}/lxc/{vmid}/vncproxy`；`GET /nodes/{node}/lxc/{vmid}/vncwebsocket`；`POST /nodes/{node}/lxc/{vmid}/spiceproxy`
  - 要点：termproxy/vncwebsocket 协议同节点 Shell。vncproxy 参数 websocket=1、width、height。

### 5.3 Resources / Network / DNS / Options

- **内存与交换** · `lxc-config/ct-memory` · P1
  - 用户操作：内存 MiB、交换 MiB。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：memory、swap。PUT 同步返回（新建/删除卷时也同步执行，可能较慢）；delete=key；digest；运行中不能生效的改动进 pending（GET /pending），revert=key 撤销。
- **CPU** · `lxc-config/ct-cpu` · P1
  - 用户操作：核心数（可空=不限）、CPU 限制、CPU 权重。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：cores、cpulimit、cpuunits。
- **根磁盘** · `lxc-config/ct-rootfs` · P1
  - 用户操作：根盘存储/大小（只读展示），ACL、配额、挂载选项（noatime/nodev/nosuid/noexec/lazytime/discard）、复制开关、idmap。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：rootfs=`local-lvm:vm-101-disk-0,size=8G,mountoptions=noatime;nosuid,acl=1`。
- **挂载点** · `lxc-config/ct-mountpoint` · P1
  - 用户操作：添加存储卷挂载点（存储、大小、路径）或绑定挂载主机目录（仅 root）、ACL、只读、备份开关、配额、跳过复制、共享、挂载选项、idmap。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`；`GET /nodes/{node}/storage`
  - 要点：新卷 `mp0=<storage>:<sizeGiB>,mp=/data,backup=1`；绑定挂载 `mp1=/host/path,mp=/data`。
- **卷动作：迁移存储 / 转移所有者 / 扩容 / 分离 / 删除** · `lxc-config/ct-volume-actions` · P1
  - 用户操作：Move Storage（可删源）、Reassign Owner（转给另一个 CT）、Resize（只能增大）、Detach（变 unused）、删除 unused。
  - API：`POST /nodes/{node}/lxc/{vmid}/move_volume`；`PUT /nodes/{node}/lxc/{vmid}/resize`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：move_volume 参数 volume、storage、delete、bwlimit，或 target-vmid、target-volume（reassign）。resize 参数 disk、size（返回 UPID）。运行中移动卷不支持。
- **设备直通** · `lxc-config/ct-device` · P1
  - 用户操作：把主机设备节点（/dev/…）直通给容器，设置 uid/gid/mode、禁止写。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：dev0=`/dev/dri/renderD128,gid=104,mode=0660`；仅 root@pam。
- **资源 pending/撤销** · `lxc-config/ct-pending` · P1
  - 用户操作：显示待重启生效的更改并撤销。
  - API：`GET /nodes/{node}/lxc/{vmid}/pending`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：revert=<key>。
- **CT 网络** · `lxc-config/ct-network` · P1
  - 用户操作：网卡列表：名称（eth0）、MAC、网桥、VLAN、IPv4/IPv6（静态/DHCP/SLAAC）与网关、防火墙、断开链路、限速、MTU、Trunks、host-managed；运行中显示实际 IP。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`；`GET /nodes/{node}/lxc/{vmid}/interfaces`；`GET /nodes/{node}/network`
  - 要点：net0=`name=eth0,bridge=vmbr0,hwaddr=BC:24:11:..,ip=dhcp,ip6=auto,tag=10,firewall=1,gw=…`。热插可直接生效。
- **CT DNS** · `lxc-config/ct-dns` · P1
  - 用户操作：DNS 域、DNS 服务器（空=用主机设置），容器内 hostname。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：hostname、searchdomain、nameserver（空格分隔）。
- **CT 选项** · `lxc-config/ct-options` · P1
  - 用户操作：开机自启、启动/关机顺序、OS 类型、架构、控制台开关、TTY 数、控制台模式、保护、非特权（只读展示）、特性（nesting、keyctl、fuse、mknod、mount 类型、force_rw_sys）、hookscript、Entrypoint、环境变量（OCI 容器）。
  - API：`GET /nodes/{node}/lxc/{vmid}/config`；`PUT /nodes/{node}/lxc/{vmid}/config`
  - 要点：onboot、startup、ostype、arch、console、tty、cmode=tty|console|shell、protection、features=`nesting=1,keyctl=1,fuse=1,mount=nfs;cifs`（部分需 root）、hookscript、entrypoint、env（NUL 分隔列表，UI 以键值表编辑）、timezone。

### 5.4 Snapshots / Backup / 恢复

- **CT 快照** · `guest-snapshots-backup/ct-snapshots` · P1
  - 用户操作：快照树：创建（名称、描述）、回滚、编辑描述、删除。
  - API：`GET /nodes/{node}/lxc/{vmid}/snapshot`；`POST /nodes/{node}/lxc/{vmid}/snapshot`；`GET /nodes/{node}/lxc/{vmid}/snapshot/{snapname}`；`GET /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config`；`PUT /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/config`；`POST /nodes/{node}/lxc/{vmid}/snapshot/{snapname}/rollback`；`DELETE /nodes/{node}/lxc/{vmid}/snapshot/{snapname}`；`GET /nodes/{node}/lxc/{vmid}/feature`
  - 要点：CT 无内存快照。绑定挂载/不支持快照的存储会使 feature 检查失败。
- **CT Backup 页与立即备份** · `guest-snapshots-backup/ct-backup-tab` · P1
  - 用户操作：同 VM：列出备份、立即备份（含 PBS 变更检测模式）、恢复、删除、显示配置、备注/保护、文件级恢复。
  - API：`GET /nodes/{node}/storage/{storage}/content`；`POST /nodes/{node}/vzdump`；`GET /nodes/{node}/vzdump/defaults`；`GET /nodes/{node}/vzdump/extractconfig`
  - 要点：pbs-change-detection-mode 仅对 CT + PBS 有意义。
- **从备份恢复 CT** · `guest-snapshots-backup/ct-restore` · P1
  - 用户操作：覆盖或新建：目标存储、限速、唯一化、特权/非特权、恢复后启动、覆盖主机名/内存/核心、加入 HA。
  - API：`POST /nodes/{node}/lxc`；`GET /nodes/{node}/vzdump/extractconfig`
  - 要点：POST /nodes/{node}/lxc：vmid、ostemplate=<备份 volid>、restore=1、force=1、storage、unique、unprivileged、bwlimit、start、hostname、memory、cores、pool、ha-managed、ignore-unpack-errors。

### 5.5 Replication

- **CT Replication 页** · `replication/ct-replication-tab` · P2
  - 用户操作：同 VM。
  - API：`GET /nodes/{node}/replication`；`POST /cluster/replication`；`POST /nodes/{node}/replication/{id}/schedule_now`

### 5.6 Firewall

- **CT 防火墙** · `firewall/ct-firewall` · P2
  - 用户操作：规则、选项、别名、IPSet、日志（同 VM）。
  - API：`GET /nodes/{node}/lxc/{vmid}/firewall`；`GET /nodes/{node}/lxc/{vmid}/firewall/rules`；`POST /nodes/{node}/lxc/{vmid}/firewall/rules`；`GET /nodes/{node}/lxc/{vmid}/firewall/rules/{pos}`；`PUT /nodes/{node}/lxc/{vmid}/firewall/rules/{pos}`；`DELETE /nodes/{node}/lxc/{vmid}/firewall/rules/{pos}`；`GET /nodes/{node}/lxc/{vmid}/firewall/options`；`PUT /nodes/{node}/lxc/{vmid}/firewall/options`；`GET /nodes/{node}/lxc/{vmid}/firewall/aliases`；`POST /nodes/{node}/lxc/{vmid}/firewall/aliases`；`GET /nodes/{node}/lxc/{vmid}/firewall/aliases/{name}`；`PUT /nodes/{node}/lxc/{vmid}/firewall/aliases/{name}`；`DELETE /nodes/{node}/lxc/{vmid}/firewall/aliases/{name}`；`GET /nodes/{node}/lxc/{vmid}/firewall/ipset`；`POST /nodes/{node}/lxc/{vmid}/firewall/ipset`；`GET /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}`；`POST /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}`；`DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}`；`GET /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr}`；`PUT /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr}`；`DELETE /nodes/{node}/lxc/{vmid}/firewall/ipset/{name}/{cidr}`；`GET /nodes/{node}/lxc/{vmid}/firewall/log`；`GET /nodes/{node}/lxc/{vmid}/firewall/refs`

### 5.7 Permissions

- **CT 权限页** · `access-control/ct-permissions` · P3
  - 用户操作：作用于 /vms/<vmid> 的 ACL。
  - API：`GET /access/acl`；`PUT /access/acl`

### 5.8 迁移 / 克隆 / 模板 / 删除 / HA

- **迁移 CT** · `guest-lifecycle/ct-migrate` · P1
  - 用户操作：目标节点、重启模式迁移（运行中 CT 先关机再迁移再启动，超时）、目标存储；前置检查。
  - API：`GET /nodes/{node}/lxc/{vmid}/migrate`；`POST /nodes/{node}/lxc/{vmid}/migrate`
  - 要点：POST 参数 target、restart=1、timeout、target-storage、bwlimit、online（CT 不支持真正在线迁移）。
- **克隆 CT** · `guest-lifecycle/ct-clone` · P1
  - 用户操作：目标节点、新 ID、主机名、资源池、链接/完整、目标存储、从快照。
  - API：`POST /nodes/{node}/lxc/{vmid}/clone`；`GET /nodes/{node}/lxc/{vmid}/feature`；`GET /nodes/{node}/lxc/{vmid}/snapshot`
  - 要点：参数 newid、hostname、target、full、storage、pool、snapname、description、bwlimit。
- **转换为模板** · `guest-lifecycle/ct-template` · P1
  - 用户操作：停止的 CT 转模板。
  - API：`POST /nodes/{node}/lxc/{vmid}/template`
- **删除 CT** · `guest-lifecycle/ct-remove` · P1
  - 用户操作：危险确认；purge、删除未引用磁盘、强制（运行中也删）。
  - API：`DELETE /nodes/{node}/lxc/{vmid}`
  - 要点：参数 purge、destroy-unreferenced-disks、force。
- **加入/管理 HA** · `guest-lifecycle/ct-ha-quick` · P1
  - 用户操作：sid=ct:<vmid>。
  - API：`POST /cluster/ha/resources`；`PUT /cluster/ha/resources/{sid}`

### 5.9 创建向导

- **创建 CT：常规** · `guest-create/ct-create-general` · P1
  - 用户操作：节点、CT ID、主机名、非特权（默认勾选）、嵌套（默认勾选）、资源池、root 密码（两次）、SSH 公钥（可上传文件）、标签、加入 HA。
  - API：`GET /cluster/nextid`；`GET /pools`
  - 要点：密码与 SSH 公钥二选一必填。nesting 对非特权容器默认开启。
- **创建 CT：模板** · `guest-create/ct-create-template` · P1
  - 用户操作：选存储与模板（vztmpl，也支持 OCI 镜像 tar）。
  - API：`GET /nodes/{node}/storage`；`GET /nodes/{node}/storage/{storage}/content`
  - 要点：content=vztmpl。
- **创建 CT：磁盘** · `guest-create/ct-create-disks` · P1
  - 用户操作：根盘存储/大小、ACL、挂载选项、配额；可额外添加挂载点。
  - API：`GET /nodes/{node}/storage`
  - 要点：rootfs=`<storage>:<GiB>`。
- **创建 CT：CPU 与内存** · `guest-create/ct-create-cpu-mem` · P1
  - 用户操作：核心、内存、交换。
  - API：无（纯前端）
- **创建 CT：网络** · `guest-create/ct-create-network` · P1
  - 用户操作：eth0：网桥、VLAN、防火墙、IPv4/IPv6（静态/DHCP/SLAAC）与网关、MTU、限速。
  - API：`GET /nodes/{node}/network`
- **创建 CT：DNS** · `guest-create/ct-create-dns` · P1
  - 用户操作：DNS 域、DNS 服务器（留空用主机设置）。
  - API：无（纯前端）
- **创建 CT：确认并创建** · `guest-create/ct-create-confirm` · P1
  - 用户操作：参数汇总，可勾选创建后启动。
  - API：`POST /nodes/{node}/lxc`
  - 要点：参数 vmid、ostemplate、hostname、password、ssh-public-keys、unprivileged、features、rootfs、mp0…、cores、memory、swap、net0、nameserver、searchdomain、pool、tags、start、ha-managed。返回 UPID（vzcreate）。

## 6. 存储（节点下的 Storage）

### 6.1 Summary / 内容 / 上传 / 下载 / 模板 / 恢复 / 导入

- **存储 Summary** · `storage-browser/storage-summary` · P1
  - 用户操作：类型、启用/激活、内容类型、共享、用量与 RRD 图（用量随时间）。
  - API：`GET /nodes/{node}/storage/{storage}/status`；`GET /nodes/{node}/storage/{storage}/rrddata`；`GET /storage/{storage}`
  - 要点：rrddata 参数 timeframe、cf；字段 used、total。
- **内容浏览（按类型）** · `storage-browser/storage-content-list` · P1
  - 用户操作：按 Backups / VM Disks / CT Volumes / ISO Images / CT Templates / Snippets / Import 分页签，名称、日期、格式、大小、备注、受保护、加密、校验状态；按 VMID 过滤。
  - API：`GET /nodes/{node}/storage/{storage}/content`
  - 要点：参数 content=backup|images|rootdir|iso|vztmpl|snippets|import，vmid。条目 volid、format、size、used、ctime、vmid、notes、protected、encrypted、verification、subtype（备份：qemu/lxc）。
- **上传文件** · `storage-browser/storage-upload` · P1
  - 用户操作：上传 ISO、CT 模板、导入文件（OVA/qcow2/vmdk/raw），可选校验和（md5/sha1/sha224/sha256/sha384/sha512），进度条。
  - API：`POST /nodes/{node}/storage/{storage}/upload`
  - 要点：Snippets 不能通过 API 上传（content 仅支持 iso|vztmpl|import），只能浏览/删除。multipart/form-data：content=iso|vztmpl|import、filename（会被规范化）、checksum、checksum-algorithm、file（最后一个字段）。PVE 先写 /var/tmp 再起任务，返回 UPID；大文件需注意 Go 反代不缓冲、无大小上限与超时。需要 Datastore.AllocateTemplate。
- **从 URL 下载** · `storage-browser/storage-download-url` · P1
  - 用户操作：填 URL → “查询 URL”自动取文件名与大小 → 可选校验和、解压（ISO 支持 gz/lzo/zst/bz2）、校验证书 → 下载任务。
  - API：`GET /nodes/{node}/query-url-metadata`；`POST /nodes/{node}/storage/{storage}/download-url`
  - 要点：query-url-metadata 参数 url、verify-certificates，返回 filename、size、mimetype。download-url 参数 url、content、filename、checksum、checksum-algorithm、compression、verify-certificates。需 Sys.Audit+Sys.Modify 或 Sys.AccessNetwork。
- **CT 模板目录（appliance）** · `storage-browser/storage-templates` · P1
  - 用户操作：浏览官方模板目录（系统/TurnKey），按分区/OS 过滤，一键下载到该存储。
  - API：`GET /nodes/{node}/aplinfo`；`POST /nodes/{node}/aplinfo`
  - 要点：GET 返回 package、template、section、os、version、headline、description、infopage；POST 参数 storage、template。目录需要节点上运行 pveam update（每日自动）。
- **拉取 OCI 镜像（应用容器）** · `storage-browser/storage-oci-pull` · P1
  - 用户操作：输入镜像引用（如 docker.io/library/nginx），列出 tags，拉取为 CT 模板。
  - API：`GET /nodes/{node}/query-oci-repo-tags`；`POST /nodes/{node}/storage/{storage}/oci-registry-pull`
  - 要点：query-oci-repo-tags 参数 reference；pull 参数 reference（带 tag）、filename。9.x 新功能。
- **删除内容** · `storage-browser/storage-delete-volume` · P1
  - 用户操作：删除 ISO/模板/备份/孤立磁盘（磁盘仍被引用时禁止）。
  - API：`DELETE /nodes/{node}/storage/{storage}/content/{volume}`
  - 要点：参数 delay（等待秒数）。返回 UPID 或 null。受保护备份不能删。
- **备注与保护** · `storage-browser/storage-volume-attrs` · P1
  - 用户操作：编辑备份备注、切换受保护标记。
  - API：`GET /nodes/{node}/storage/{storage}/content/{volume}`；`PUT /nodes/{node}/storage/{storage}/content/{volume}`
  - 要点：notes、protected。
- **从存储恢复备份** · `storage-browser/storage-restore` · P1
  - 用户操作：Backups 页签选中备份 → 恢复为 VM/CT（同客户机恢复窗口）；显示备份配置。
  - API：`POST /nodes/{node}/qemu`；`POST /nodes/{node}/lxc`；`GET /nodes/{node}/vzdump/extractconfig`；`GET /cluster/nextid`
- **清理备份（Prune）** · `storage-browser/storage-prune` · P1
  - 用户操作：按 VMID 组设置 keep-last/hourly/daily/weekly/monthly/yearly，预览将保留/删除的备份，执行清理。
  - API：`GET /nodes/{node}/storage/{storage}/prunebackups`；`DELETE /nodes/{node}/storage/{storage}/prunebackups`
  - 要点：参数 prune-backups=`keep-last=3,keep-daily=7`、type=qemu|lxc、vmid。GET 为预演（mark=keep|remove|protected|renamed）。
- **文件级恢复（PBS）** · `storage-browser/storage-file-restore` · P1
  - 用户操作：浏览 PBS 备份内的文件树，下载单个文件或目录（zip / tar.zst）。
  - API：`GET /nodes/{node}/storage/{storage}/file-restore/list`；`GET /nodes/{node}/storage/{storage}/file-restore/download`
  - 要点：参数 volume、filepath（base64 编码路径，根为 `/`）；download 加 tar=1 则为 tar.zst。VM 备份首次浏览会启动恢复用小虚拟机，较慢（需超时提示）。
- **导入客户机（ESXi / OVA）** · `storage-browser/storage-guest-import` · P1
  - 用户操作：Import 页签（ESXi 存储为 Virtual Guests）：读取 OVF/VMX 元数据，向导设置 VMID、名称、CPU/内存、OS、默认存储/网桥、磁盘与网卡映射、VirtIO 准备、唯一 MAC、实时导入、工作存储，生成配置后创建。
  - API：`GET /nodes/{node}/storage/{storage}/import-metadata`；`POST /nodes/{node}/qemu`
  - 要点：import-metadata 参数 volume，返回 create-args、disks、net、warnings（如 ova-needs-extracting）、source、type。POST /nodes/{node}/qemu 用 scsiN=`<storage>:0,import-from=<volid>`、live-restore=1（实时导入）、import-working-storage（OVA 解包用）。
- **VM 磁盘 / CT 卷** · `storage-browser/storage-orphan-images` · P1
  - 用户操作：列出该存储上的 VM 磁盘与 CT 卷，标出所属 VMID；对孤立卷提供删除。
  - API：`GET /nodes/{node}/storage/{storage}/content`；`DELETE /nodes/{node}/storage/{storage}/content/{volume}`
  - 要点：content=images / rootdir。若 VM 仍存在且引用该卷则禁止删除（官方提示先在 VM 硬件里删）。
- **分配卷（官方 UI 未用）** · `storage-browser/storage-alloc-volume` · P1
  - 用户操作：直接在存储上分配一个空卷（CLI 用，UI 不做）。
  - API：`POST /nodes/{node}/storage/{storage}/content`；`POST /nodes/{node}/storage/{storage}/content/{volume}`
  - 要点：POST content/{volume} 为“复制卷”，官方标注实验性勿用。决定：不实现。
- **节点存储列表 / 选择器** · `storage-browser/storage-node-list` · P1
  - 用户操作：所有存储选择器（磁盘、ISO、备份目标）用节点视角的存储列表与可用空间。
  - API：`GET /nodes/{node}/storage`；`GET /nodes/{node}/storage/{storage}`
  - 要点：参数 content、enabled=1、format=1、target（迁移目标节点可用性）、storage。

### 6.2 Permissions

- **存储权限页** · `access-control/storage-permissions` · P3
  - 用户操作：作用于 /storage/<id> 的 ACL。
  - API：`GET /access/acl`；`PUT /access/acl`

## 7. 资源池（Pool）

### 7.1 Summary

- **资源池 Summary** · `overview/pool-summary` · P1
  - 用户操作：池备注、成员客户机/存储状态汇总。
  - API：`GET /pools`
  - 要点：官方用 GET /pools?poolid=<id>（嵌套池用 a/b 形式）。返回 members 数组（type=qemu|lxc|storage）。

### 7.2 Members / Permissions

- **资源池成员管理** · `access-control/pool-members` · P3
  - 用户操作：添加/移除 VM、CT、存储成员；允许在池间移动。
  - API：`GET /pools`；`PUT /pools`
  - 要点：PUT /pools 参数 poolid、vms、storage、delete=1（移除）、allow-move=1。旧接口 /pools/{poolid} 已废弃（不支持嵌套池）。
- **资源池权限页** · `access-control/pool-permissions` · P3
  - 用户操作：作用于 /pool/<id> 的 ACL。
  - API：`GET /access/acl`；`PUT /access/acl`

## 8. 通用 API 约定与易错点（所有 area 都适用）

- **编码**：写请求用 `application/x-www-form-urlencoded`。布尔值传 `1`/`0`。数组参数（如 `vms`、`match-field`、`dhcp-range`、`target`）通过重复同名键传多个值。`net[n]`、`scsi[n]` 这类参数的实际键名是 `net0`、`scsi1`。
- **属性串（property string）**：大量配置值是 `k=v,k2=v2` 形式，可能带一个默认键（如 `net0=virtio=MAC,bridge=vmbr0`、`memory=current=2048`）。值内的列表用 `;` 分隔（如 `hotplug`、`mountoptions`、`cpu flags`）。`api/` 层需要提供通用的 `parsePropertyString`/`printPropertyString`，并对不认识的键原样保留。
- **删除字段**：用 `delete=key1,key2`，不要提交空字符串。
- **并发保护**：配置类 GET 返回 `digest`，PUT 时带回，冲突时 PVE 返回 400。
- **pending**：客户机配置修改后，运行中无法生效的部分进入 pending。用 `GET .../pending` 查看，用 `revert=key` 撤销，重启或热插后生效。UI 需要标出待生效项。
- **异步任务**：返回字符串 `UPID:...` 的接口都是异步任务，统一交给 `useTask(upid)` 轮询 `GET /nodes/{node}/tasks/{upid}/status` 和 `/log`。UPID 中的 node 可能不是当前页面的 node，例如迁移任务。客户机 `POST /config` 是异步的，`PUT /config` 是同步的。
- **权限与 caps**：登录返回的 `cap` 是粗粒度能力表，官方 UI 用它控制按钮显隐。细粒度判断用 `GET /access/permissions?path=...`。按钮应按 caps 隐藏或禁用，后端仍会二次校验并返回 403。
- **错误格式**：400 时 `errors` 是字段级错误对象（字段名 → 消息），需要映射到表单字段上显示。HTTP 状态行中的 message 是摘要。
- **websocket**：`vncwebsocket` 依赖 cookie `PVEAuthCookie` 加上查询参数 `port` 和 `vncticket`。vncticket 需要 URL 编码，有效期很短（约 30 秒），拿到后要立即连接。Go 反代需要透传 `Sec-WebSocket-Protocol: binary`（noVNC）。
- **上传**：`POST .../upload` 使用 multipart，文件字段放在最后。Go 反代不能缓冲整个请求体，也不能设置过短的超时。PVE 会先把文件落到节点 `/var/tmp`，再起任务移动。
- **轮询节奏（参考官方）**：资源列表约 3 秒一次，任务列表 15 秒一次，状态面板 1–3 秒一次（只在页面可见时轮询），RRD 图按时间范围 30–60 秒一次。
- **名字规范化**：上传和下载时的 `filename` 会被服务端规范化，非法字符会替换为 `_`。前端应预先提示。
- **危险操作清单**，需要确认弹层，删除类还要输入名称或 ID：VM/CT 停止、重置、删除、回滚快照、删除快照；节点重启/关机；网络 Apply；磁盘 wipe/initgpt；删除 LVM/ZFS/目录；启用防火墙；删除存储/备份/卷；集群加入；HA disarm；Ceph OSD 销毁、池删除；SDN Apply/Rollback；证书替换。

## 附录 A. 官方 WebUI 菜单树（9.2.21）与 area 对照

**数据中心**：Summary(`overview`) · Notes(`overview`) · Cluster(`cluster`) · Ceph(`ceph`) · Options(`dc-options`) · Storage(`storage-config`) · Backup(`backup-jobs`) · Replication(`replication`) · Permissions → Users / API Tokens / Two Factor / Groups(`access-users`)、Pools / Roles / Realms / Realm Sync Jobs(`access-control`) · HA → Affinity Rules / Fencing(`ha`) · SDN → Zones / VNets / Options / IPAM / VNet Firewall(`sdn`)、Fabrics / Route Maps / Prefix Lists(`sdn-fabrics`) · ACME(`certificates-acme`) · Firewall → Options / Security Group / Alias / IPSet(`firewall`) · Metric Server(`notifications-metrics`) · Resource Mappings(`resource-mappings`) · Custom CPU Models(`resource-mappings`) · Notifications(`notifications-metrics`) · Support(`dc-options`)；顶部按钮 Bulk Start / Shutdown / Suspend / Migrate(`guest-lifecycle`)。

**节点**：Summary(`node-summary`) · Notes(`node-summary`) · Shell(`console`) · System → Network(`node-network`)、Certificates(`certificates-acme`)、DNS / Hosts / Options / Time(`node-system`)、System Log(`node-summary`) · Updates → Repositories(`node-updates`) · Firewall → Options / Log(`firewall`) · Disks → LVM / LVM-Thin / Directory / ZFS(`node-disks`) · Ceph → Configuration / Monitor / OSD / CephFS / Pools / Log(`ceph`) · Replication(`replication`) · Task History(`tasks-logs`) · Subscription(`dc-options`)；顶部按钮 Reboot / Shutdown(`node-summary`)、Shell(`console`)、Bulk Actions(`guest-lifecycle`)、Wake-on-LAN(`node-summary`)。

**QEMU 虚拟机**：Summary(`guest-summary-power`) · Console(`console`) · Hardware(`qemu-config`) · Cloud-Init(`qemu-config`) · Options(`qemu-config`) · Task History(`tasks-logs`) · Monitor(`qemu-config`) · Backup(`guest-snapshots-backup`) · Replication(`replication`) · Snapshots(`guest-snapshots-backup`) · Firewall → Options / Alias / IPSet / Log(`firewall`) · Permissions(`access-control`)；顶部按钮 Start / Shutdown▾(Stop, Reboot, Pause, Hibernate, Reset) / Console▾ / More▾(Clone, Convert to template, Manage HA, Remove)、Migrate(`guest-summary-power` + `guest-lifecycle`)。

**LXC 容器**：Summary · Console · Resources · Network · DNS · Options · Task History · Backup · Replication · Snapshots · Firewall(+Options/Alias/IPSet/Log) · Permissions；顶部按钮 Start / Shutdown▾(Stop, Reboot) / Console▾ / More▾(Clone, Convert to template, Manage HA, Remove)、Migrate；没有 Reset/Pause/Hibernate。

**存储（节点下）**：Summary · Backups · VM Disks · CT Volumes · ISO Images · CT Templates · Snippets · Import（ESXi 存储显示为 Virtual Guests）· Permissions(`access-control`)；内容页按钮 Upload / Download from URL / Templates / Pull from OCI Registry / Remove / Restore / Show Configuration / Edit Notes / Change Protection / Prune group / File Restore / Import(`storage-browser`)。

**资源池**：Summary(`overview`) · Members · Permissions(`access-control`)。

**全局**：顶部搜索(`app-shell`)、任务/集群日志面板(`tasks-logs`)、用户菜单 My Settings / Password / TFA / Language / Color Theme / Logout(`auth`、`app-shell`)、Create VM / Create CT 按钮(`guest-create`)、登录窗口（realm、TFA、OpenID、同意书）(`auth`)。

## 附录 B. 未被任何功能引用的 API 端点

以下端点存在于 9.2 API，但官方 WebUI 不使用或仅供 CLI/内部使用；本项目默认不实现（如需要再归入对应 area）。

- `GET /access/openid` — Directory index.（目录索引或官方 UI 未使用）
- `GET /access/ticket` — Dummy. Useful for formatters which want to provide a login page.（目录索引或官方 UI 未使用）
- `GET /nodes/{node}/apt` — Directory index for apt (Advanced Package Tool).（目录索引或官方 UI 未使用）
- `GET /nodes/{node}/certificates` — Node index.（目录索引或官方 UI 未使用）
- `GET /nodes/{node}/certificates/acme` — ACME index.（目录索引或官方 UI 未使用）
- `GET /nodes/{node}/disks` — Node index.（目录索引或官方 UI 未使用）
- `POST /nodes/{node}/execute` — Execute multiple commands in order, root only.（批量执行 API（root，内部））
- `POST /nodes/{node}/lxc/{vmid}/mtunnel` — Migration tunnel endpoint - only for internal use by CT migration.（跨集群迁移隧道（内部））
- `GET /nodes/{node}/lxc/{vmid}/mtunnelwebsocket` — Migration tunnel endpoint for websocket upgrade - only for internal use by VM migration.（跨集群迁移隧道（内部））
- `POST /nodes/{node}/lxc/{vmid}/remote_migrate` — Migrate the container to another cluster. Creates a new migration task. EXPERIMENTAL feature!（跨集群迁移，官方 UI 无入口（仅 CLI qm/pct remote-migrate））
- `GET /nodes/{node}/lxc/{vmid}/rrd` — Read VM RRD statistics (returns PNG)（旧 PNG 图接口，用 rrddata 代替）
- `GET /nodes/{node}/netstat` — Read tap/vm network device interface counters（官方 UI 未用）
- `POST /nodes/{node}/qemu/{vmid}/dbus-vmstate` — Control the dbus-vmstate helper for a given running VM.（迁移内部使用）
- `POST /nodes/{node}/qemu/{vmid}/mtunnel` — Migration tunnel endpoint - only for internal use by VM migration.（跨集群迁移隧道（内部））
- `GET /nodes/{node}/qemu/{vmid}/mtunnelwebsocket` — Migration tunnel endpoint for websocket upgrade - only for internal use by VM migration.（跨集群迁移隧道（内部））
- `POST /nodes/{node}/qemu/{vmid}/remote_migrate` — Migrate virtual machine to a remote cluster. Creates a new migration task. EXPERIMENTAL feature!（跨集群迁移，官方 UI 无入口（仅 CLI qm/pct remote-migrate））
- `GET /nodes/{node}/qemu/{vmid}/rrd` — Read VM RRD statistics (returns PNG)（旧 PNG 图接口，用 rrddata 代替）
- `GET /nodes/{node}/rrd` — Read node RRD statistics (returns PNG)（旧 PNG 图接口，用 rrddata 代替）
- `GET /nodes/{node}/storage/{storage}/rrd` — Read storage RRD statistics (returns PNG).（旧 PNG 图接口，用 rrddata 代替）
