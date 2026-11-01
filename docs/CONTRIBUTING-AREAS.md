# 功能区（area）开发约定

第一阶段由多个 agent 并行开发 10 个功能区。为了尽量不改共享文件、不互相冲突，所有区都建立在下面这套共享契约上。先读 [ARCHITECTURE.md](ARCHITECTURE.md)，端点、参数和坑见 [feature-map.md](feature-map.md)（按 area id 查找）。

## 1. 谁拥有哪些文件

每个区只改自己名下的文件。占位文件已经建好并注册（能编译、能导航），把它们换成真实实现即可，**不需要改注册表**。

| area id | 目录 | API 文件 | 已注册的占位文件（替换它们） |
|---|---|---|---|
| `tasks-logs` | `features/tasks/` | `api/tasks-logs.ts` | `TasksPage.tsx`（/tasks）、`GuestTasksTab.tsx`、`NodeTasksTab.tsx`；另外拥有 `lib/taskTypes.ts`（任务类型中文名） |
| `node-summary` | `features/node-summary/` | `api/node-summary.ts` | `SummaryTab.tsx`、`ServicesTab.tsx`、`SyslogTab.tsx`、`actions.ts`、`commands.ts` |
| `console` | `features/console/`、`features/shell/` | `api/console.ts` | `ConsolePage.tsx`（/console/:node/:type/:vmid、/console/:node/shell）、`GuestConsoleTab.tsx`、`NodeShellTab.tsx`、`actions.ts`、`commands.ts`、`features/shell/ShellPage.tsx`（/shell） |
| `guest-summary-power` | `features/guest-core/` | `api/guest-core.ts` | `SummaryTab.tsx`、`actions.ts`（电源操作）、`commands.ts` |
| `qemu-config` | `features/qemu-config/` | `api/qemu-config.ts` | `HardwareTab.tsx`、`CloudInitTab.tsx`、`OptionsTab.tsx`、`MonitorTab.tsx` |
| `lxc-config` | `features/lxc-config/` | `api/lxc-config.ts` | `ResourcesTab.tsx`、`NetworkTab.tsx`、`DnsTab.tsx`、`OptionsTab.tsx` |
| `guest-snapshots-backup` | `features/guest-backup/` | `api/guest-backup.ts` | `SnapshotsTab.tsx`、`BackupTab.tsx`、`actions.ts` |
| `guest-create` | `features/guest-create/` | `api/guest-create.ts` | `CreateQemuPage.tsx`（/create/qemu）、`CreateLxcPage.tsx`（/create/lxc）、`commands.ts` |
| `guest-lifecycle` | `features/guest-lifecycle/` | `api/guest-lifecycle.ts` | `actions.ts`（客户机操作 + 节点批量操作 `nodeBulkActions`）、`commands.ts` |
| `storage-browser` | `features/storage-browser/` | `api/storage-browser.ts` | `SummaryTab.tsx`、`ContentTab.tsx`（所有内容类型共用，按 `content` 区分）、`actions.ts`；也可以改进 `features/storage/StoragePage.tsx`（存储列表） |

区内可以随意新增文件（组件、hooks、测试、e2e spec）。目录名就是 import 路径：`@/features/qemu-config/...`。

**共享文件**（改之前想清楚，改动要小、要向后兼容，并在提交说明里写明）：

- `api/client.ts`、`api/queries.ts`、`api/types.ts`、`api/tasks.ts`、`api/auth.ts`、`api/session.ts`
- `components/**`（含 `components/ui/`、`components/form/`、`components/page/`、`components/tasks/`、`components/layout/`）
- `lib/format.ts`、`lib/propstring.ts`、`lib/size.ts`、`lib/resources.ts`、`lib/errors.ts`
- `features/guest/`、`features/node/`、`features/storage/`（页面外壳、注册表、类型）
- `features/command/`（命令面板注册表）、`routes.tsx`、`index.css`、`App.tsx`

确实需要新的共享能力时：先在自己的区里实现；两个以上区都要用，再提到共享位置。

## 2. API 组织

- 每个区把自己的端点、hooks、类型写在 `api/<area>.ts`（见上表）。类型也放在那里，`api/types.ts` 只放多个区共用的核心类型（集群资源、节点、存储列表、任务状态……）。
- 请求一律用 `get/post/put/del`，路径插值用 ``p`/nodes/${node}/qemu/${vmid}/config` ``。错误统一是 `PveApiError`。
- **查询 key 建立在作用域前缀上**，这样一次失效能刷新同一对象的所有数据：

  ```ts
  [...queryKeys.guest(node, 'qemu', vmid), 'config']     // ['pve','nodes',node,'qemu','100','config']
  [...queryKeys.node(node), 'services']
  [...queryKeys.storage(node, storage), 'content', 'iso']
  ```

- 已有的共享 hooks（`api/queries.ts`）：`useClusterResources`、`useClusterStatus`、`useNodes`、`useVersion`、`useTasks`、`useNodeRrd`、`useNodeStorages(node, content)`、`useNodeNetworks(node, type)`、`useNextId()`、`fetchNextId()`、`checkVmidFree(vmid)`。
- 轮询节奏：资源 5 秒、状态与任务 10 秒、RRD 60 秒（`POLL`）。

## 3. 长任务：`runTask`

返回 UPID 的操作（启动、停止、克隆、迁移、备份、下载……）一律通过 `runTask`：

```ts
import { runTask, fireTask } from '@/components/tasks/tracker'

// 在 ConfirmDialog / FormDialog / 注册表 action 的 run 里：返回这个 promise
run: ({ node, type, vmid, name }) =>
  runTask(post(p`/nodes/${node}/${type}/${vmid}/status/start`), { title: `启动 ${name}` })

// 没有弹层的普通按钮：启动失败时自动弹错误提示
fireTask(post(...), { title: '刷新软件包索引' })
```

- `runTask(start, opts)` 在 API 调用成功后立即 resolve，得到 `{ upid, done }`；`done` 在任务结束时 resolve 为 `{ state: 'ok' | 'warning' | 'error', exitstatus }`。需要等任务结束再跳转（例如创建向导）就 `await handle.done`。
- 调用本身失败时 reject（不弹 toast），由 ConfirmDialog / FormDialog 显示；`fireTask` 会弹 toast。
- 任务出现在底部任务提示（手机在导航栏上方，桌面在右下角），显示最新日志行和进度（日志里的百分比）；点击打开实时日志（可停止、可下载）。失败的任务保留并显示退出状态，直到用户关闭。
- 结束后默认刷新 `['pve']` 下所有正在显示的查询；用 `invalidate: [queryKeys.guest(node, type, vmid)]` 缩小范围，`[]` 不刷新。
- 同步接口（返回 null，例如部分 config PUT）也能交给 `runTask`：会弹一个“已完成”提示并刷新查询（`syncSuccessMessage: false` 关闭提示）。
- 打开任意任务的日志：`openTaskLog({ node, upid, title? })`；或直接用组件 `<TaskLogSheet node upid open onOpenChange />`。
- 底层（`api/tasks.ts`）：`parseUpid`、`isUpid`、`taskState`、`exitStatusState`、`TASK_STATE_LABEL`、`fetchTaskStatus`、`fetchTaskLog`（增量 start/limit）、`fetchFullTaskLog`、`stopTask`、`useTaskStatus(node, upid)`、`useTaskLog(node, upid, { follow })`、`parseTaskProgress`。任务中文名：`describeTask`、`describeUpid`、`taskTypeLabel`（`lib/taskTypes.ts`）。图标：`TaskStateIcon`、`TaskStateBadge`。

## 4. 配置编辑：property string 与 diff

```ts
import { parseDrive, parseQemuNet, stringifyQemuNet, updatePropertyString, configUpdateParams } from '@/lib/propstring'

const disk = parseDrive(config.scsi0)          // { file: 'local-lvm:vm-100-disk-0', size: '32G', iothread: '1' }
const net = parseQemuNet(config.net0)          // { model: 'virtio', macaddr: 'BC:..', options: { bridge: 'vmbr0' } }
const next = updatePropertyString(config.net0, { tag: 20, firewall: null })   // 改一部分键，保留顺序

// 只提交改动：没改的键不发，清空的键进 delete，带 digest 防并发覆盖；没变化返回 null
const params = configUpdateParams(config, { memory: 4096, balloon: '', onboot: true })
if (params) await put(p`/nodes/${node}/qemu/${vmid}/config`, params)
```

- `parsePropertyString(str, defaultKey?)` / `stringifyPropertyString(obj, defaultKey | { defaultKey, sort })`：默认键（`file`、`volume`、`cputype`…）写在最前面且不带键名；数组用 `;` 连接；空值去掉。
- 其他：`parseMountPoint`、`parseVolumeId`、`parseListValue`、`propBool`、`propNumber`、`QEMU_NIC_MODELS`。
- 大小：`lib/size.ts` 的 `parsePveSize('32G')`、`formatPveSize(bytes)`、`convertSize`、`bestSizeUnit`。
- `configUpdateParams` 只比较 `after` 里出现的键（加上 `opts.keys`），表单只传自己管理的字段，不会误删别的配置。

## 5. 表单与弹层

全部从 `@/components/form` 导入：

| 组件 | 用途 |
|---|---|
| `ResponsiveDialog`（`@/components/ResponsiveDialog`） | 手机底部抽屉 / 桌面居中对话框，头部、可滚动正文、固定底栏 |
| `FormDialog` | ResponsiveDialog + `<form>`：回车提交、忙碌状态、失败不关闭；`PveApiError.errors` 自动显示到同名字段下，消息显示在顶部 |
| `FormField`（`label`、`hint`、`error`、`name`、`required`）、`FormRow`（并排，手机竖排）、`FormSection`（分组，`collapsible` 用于“高级选项”）、`FormError` | 布局 |
| `FieldInput`、`FieldTextarea` | 自动接上 FormField 的 id 和 aria |
| `NumberInput`（`unit`、`stepper`、`min/max`、`decimal`）、`SizeInput`（`baseUnit` MiB/GiB，可切单位） | 数字 |
| `SelectField`（`options`、`emptyOption` 表示“默认/不设置”）、`SwitchField`、`CheckboxField`、`pveFlag()` | 选择与开关 |
| `StorageSelect node content`、`BridgeSelect node`、`NodeSelect`、`VmidInput`（自动填下一个 ID 并检查占用） | PVE 资源选择 |

危险操作用 `ConfirmDialog`（`destructive`，删除类加 `typeToConfirm`）。新增的 shadcn 组件已有：checkbox、radio-group、textarea、progress、accordion、collapsible、table、slider、hover-card（主题已适配）。

## 6. 页面外壳与注册表

客户机页 `/guest/:node/:type/:vmid/:tab?`、节点页 `/node/:node/:tab?`、存储页 `/storage/:node/:storage/:tab?` 都由外壳渲染：头部（名称、状态、标签、面包屑）、操作栏（桌面在头部右侧；手机是导航栏上方的悬浮条，最多 3 个主按钮，其余在“更多”里）、标签栏（手机可横向滚动）。

- 标签：`features/guest/registry.ts` 的 `guestTabs`、`features/node/registry.ts` 的 `nodeTabs`、`features/storage/registry.ts` 的 `storageTabs`。都已预先注册，指向各区的文件；组件懒加载，各区自成一个 chunk，单个标签崩溃不影响整页（ErrorBoundary）。
- 标签组件的 props：客户机 `GuestTabProps { node, type, vmid, guest }`（`features/guest/types.ts`），深层组件用 `useGuestContext()`；节点 `NodeTabProps { node, resource }`；存储 `StorageTabProps { node, storage, resource, content? }`。`guest`/`resource` 来自 `/cluster/resources`，随轮询更新。
- 操作：在自己区的 `actions.ts` 里往数组加 `ActionDef`（`components/page/registry.ts`）：

  ```ts
  {
    id: 'shutdown', label: '关机', icon: Power, order: 110, placement: 'primary', section: '电源',
    visible: ({ guest }) => guest.status === 'running',
    disabled: ({ guest }) => guest.lock && `已锁定（${guest.lock}）`,      // 返回字符串 = 禁用并提示原因
    confirm: ({ name }) => ({ title: `关闭 ${name}？` }),                    // 可选：先确认
    run: (ctx) => runTask(post(...), { title: `关机 ${ctx.name}` }),        // 返回 runTask 的 promise
  }
  // 或者打开自己的弹层：dialog: lazy(() => import('./MigrateDialog'))   // props: { ctx, open, onOpenChange }
  ```

  顺序区间：客户机页 guest-core 100–199、console 200–249、guest-backup 300–349、guest-lifecycle 400–499；节点页 node-summary 100–199、console 200–249、guest-lifecycle（批量）300–399；存储页 storage-browser 100–199。`types: QEMU | LXC` 限定客户机类型。
- 第二、三阶段的标签用 `comingSoonTab('说明', 2)` 占位。
- 路径工具（`lib/resources.ts`）：`guestPath(g, tab?)`、`nodePath(node, tab?)`、`storagePath(node, storage, tab?)`、`consolePath(g)`、`nodeShellPath(node)`、`createGuestPath(type, node?)`。

## 7. 命令面板

在自己区的 `commands.ts` 里加命令（类型见 `features/command/types.ts`），由 `features/command/registry.ts` 汇总：

- `scope: 'global'`：总是列出（例如“创建虚拟机”）。
- `scope: 'guest'` / `'node'`：在当前客户机/节点页面置顶显示；用户输入搜索词时，对所有匹配的客户机/节点列出（“启动 web-01”）。`visible`、`confirm`、`run` 拿到资源对象和 `{ navigate, resources }`。
- 用 `keywords` 加英文动词方便搜索（start、reboot…）。

## 8. 测试

测试分层（详见 README「开发」）：

- **每次改动**：`rt -- make test`（go vet/test、vitest、tsc），必须保持通过。
- **改某个区**：`make e2e-area AREA=<area id>`，只跑这个区的 spec、只跑桌面布局。
- **阶段合并之后**：`make e2e` 跑一次全部（桌面 + 手机）。
- **视觉巡检**：`make e2e-visual`，只在阶段结束、有人要求时跑；截图留在 `e2e/test-results/`，不提交进仓库。

- 单元测试（vitest）放在区内：`features/<area>/*.test.ts(x)`。
- e2e（Playwright）：spec 放在 `e2e/tests/<area>.spec.ts`，从 `../fixtures` 导入：

  ```ts
  import { expect, test } from '../fixtures'

  test('关机', { tag: '@lab' }, async ({ page, pve, cleanup }) => {
    const vmid = await pve.createTestVm({ vmid: 3010, name: 'e2e-tasks-power' })  // 走 API，等任务结束并出现在资源列表
    cleanup.guest(vmid)                                                         // 测试结束（含失败）后销毁
    await page.goto(`/guest/${pve.node}/qemu/${vmid}`)                          // page 已登录
  })
  ```

  - **标签决定在哪个项目里跑**：会改实验机的测试（电源、快照、备份/恢复、克隆、创建、配置写入、上传、用户、服务）或很慢的测试标 `@lab`，只在桌面跑一次；只属于桌面界面的标 `@desktop`（资源树、任务状态栏、快捷键），只属于手机的标 `@mobile`（底部导航、操作坞、控制台辅助按键）。其余测试两种布局都跑。整组可以写 `test.describe('…', { tag: '@lab' }, …)`。
  - **手机项目只读**：只检查布局和交互（导航、底部弹层、表单能打开、菜单项），在共享示例客户机上打开对话框后取消。需要数据或状态时用 `page.route()` 模拟（例子：`tasks-logs.spec.ts` 的运行中任务、`node-summary.spec.ts` 的重启拦截）。手机测试里 `pve` 拒绝写操作，页面发出的非 GET 请求（登录和控制台 ticket 除外）会让测试失败。
  - **并行**：spec 文件在 2 个 worker 里并行，同一文件内按顺序跑。只用自己区的 VMID 段，不要用 `nextId()` 建客户机，也不要按「第一个运行中的客户机」这类条件挑别人的客户机（别的区正在并行创建和销毁）；要读的示例用固定的 100、101、200、9000。全局状态（节点/数据中心备注、服务、`tester@pve`）只在 `@lab` 测试里改，改完恢复。
  - **超时**：默认单个测试 90 秒、单个操作 20 秒。已知慢的测试（备份恢复、扩容、启动客户机）自己写 `test.setTimeout(150_000)` 之类，不要放宽整个文件。

  - `page` 已登录（每个 worker 通过界面登录一次并复用 storageState）；要未登录页面：`test.use({ storageState: { cookies: [], origins: [] } })`。
  - `pve`：通过 app 服务器直连实验机的 API（`get/post/put/del`、`run`（自动等任务）、`waitTask`、`waitForGuest`、`nextId`、`guests`、`createTestVm`、`destroyGuest`、`sweep`）。写操作前会确认服务器连的是实验机节点 `pve-lab`，否则拒绝。
  - 测试创建的对象一律命名 `e2e-<area>-…`；`pve.sweep()` 清理崩溃残留。
  - `mobile` 为 true 表示手机布局（iPhone 15 尺寸，Chromium；测试服务器跑不了 WebKit）。手机上操作按钮在 `getByRole('toolbar', { name: '操作' })`，桌面在页面头部。
  - 截图类的视觉检查写成 `e2e/tests/<area>.visual.spec.ts`：默认不运行，只在 `E2E_SCREENSHOTS=1`（`make e2e-visual`）时运行。
  - `/cluster/resources` 会比真实状态晚几秒，等状态变化用 `expect(...).toBeVisible({ timeout: 30_000 })` 或 `pve.waitForGuest(vmid, g => g.status === 'running')`。
- 运行一个区的 e2e（在本机仓库目录执行，命令在测试服务器上跑）：

  ```sh
  rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e-area AREA=tasks-logs PORT=8101'
  ```

  `make e2e*` 会在需要时构建 `server/pve-web`，在 `PORT` 上启动并连接实验机，跑完（无论成败）都会停掉服务器。area id 对应的 spec 见 `scripts/e2e-area.sh`（例如 `guest-lifecycle` → `guest-core.spec.ts`）。单个 spec 或单个测试：`make e2e SPEC=tests/tasks-logs.spec.ts E2E_ARGS="--project=desktop -g 集群日志"`；顺带检查手机布局：`make e2e SPEC=tests/<area>.spec.ts`；取回报告和 trace：`rt --back e2e/playwright-report --back e2e/test-results -- …`。
- 想手动看效果：`rt -- bash -lc 'set -a; . ~/.config/pve-web/lab.env; set +a; make e2e-server PORT=8101'`，然后在本机打开 `http://192.168.0.32:8101`；用完 `make e2e-stop PORT=8101`。
- 并行跑 e2e 时每个区用自己的端口，避免冲突：

  | area | PORT |
  |---|---|
  | tasks-logs | 8101 |
  | node-summary | 8102 |
  | console | 8103 |
  | guest-summary-power | 8104 |
  | qemu-config | 8105 |
  | lxc-config | 8106 |
  | guest-snapshots-backup | 8107 |
  | guest-create | 8108 |
  | guest-lifecycle | 8109 |
  | storage-browser | 8110 |

- 实验机是共享的：只操作自己创建的 `e2e-*` 对象，不改别人的客户机、存储或用户；生产主机 192.168.0.6 永远只读。

## 9. 界面要求

中文文案；手机优先（≥44px 点击目标，`pointer-coarse:` 放大），桌面 ≥1024px；颜色只用主题 token；每个界面在暗色玻璃、浅色玻璃、纸质三套主题下都要好看。
