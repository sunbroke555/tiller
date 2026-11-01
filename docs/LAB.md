# 实验机（嵌套 PVE）

所有写操作测试只对这台实验机做。生产 PVE（192.168.0.6）只读，任何测试都不能指向它写入。

## 概况

| 项目 | 值 |
| --- | --- |
| 宿主 | 生产 PVE 上的 VM 9900 “pve-web-lab”（嵌套 PVE，宿主侧由编排脚本管理，测试不要碰） |
| 地址 | `https://192.168.0.245:8006`（自签证书） |
| 节点名 | **`pve-lab`**（fqdn `pve-lab.lan`） |
| 版本 | Proxmox VE 9.2（Debian trixie），apt 已切到 no-subscription 源（pve + ceph-squid），企业源已停用 |
| 资源 | 3 GiB 内存（客户机实际可用约 1.4 GiB）、2 GiB swap；嵌套 KVM 可用（`/dev/kvm`，nested=Y） |
| 存储 | `local`（dir，约 16 GB，放 ISO/CT 模板/备份）、`local-lvm`（lvmthin，约 21.6 GB，放磁盘） |
| 网络 | `vmbr0` 桥接到局域网（192.168.0.0/24）。客户机网卡默认用 `ip=manual` 或不配 IP，避免和局域网地址冲突 |

## 访问方式

- 连接信息存在测试服务器 `~/.config/pve-web/lab.env`（权限 600，**不入库**）。用法：`set -a; . ~/.config/pve-web/lab.env; set +a`。
  - `PVE_LAB_URL`、`PVE_LAB_HOST`、`PVE_LAB_NODE`（= `pve-lab`）
  - `PVE_LAB_USER`（`root@pam`）/ `PVE_LAB_PASSWORD`
  - `PVE_LAB_TESTER_USER`（`tester@pve`）/ `PVE_LAB_TESTER_PASSWORD`
  - `PVE_LAB_FINGERPRINT`：pve-ssl 证书的 SHA-256 指纹（冒号分隔的大写十六进制），用于校验证书
- 在测试服务器上执行 `ssh pvelab` 可以 root 登录实验机，用于准备或清理测试数据（如 `qm`、`pct`、`pvesh`、`pveum`）。
- 本地开发示例：`rt -- bash -c 'set -a; . ~/.config/pve-web/lab.env; PVE_URL=$PVE_LAB_URL PVE_INSECURE_TLS=1 make dev'`。

## 用户与权限

| 用户 | 权限 | 用途 |
| --- | --- | --- |
| `root@pam` | 全部 | 常规功能和写操作测试 |
| `tester@pve` | `/` 上 `PVEAuditor`，`/vms/100` 上 `PVEVMUser` | 受限用户测试：能看到全部资源，但只能操作 VM 100（启停、控制台、快照等）；对其他资源的写操作应返回 403，界面应隐藏或禁用对应按钮 |

资源池：`lab-pool`，成员 VM 101。

## 固定样例客户机

测试可以读取这些客户机，也可以做**可逆**操作（启停、改配置后改回、快照后删除），但用完要恢复原状，不要删除。

| VMID | 名称 | 类型 | 配置 | 状态 |
| --- | --- | --- | --- | --- |
| 100 | `tiny-vm` | QEMU | 128MB，1 核，`scsi0` local-lvm 1G（无系统），virtio 网卡，标签 `test;demo`，快照 `base` | 关机 |
| 101 | `tiny-vm-2` | QEMU | 64MB，1 核，无磁盘，virtio 网卡，属于 `lab-pool` | 运行 |
| 200 | `alpine-ct` | LXC（非特权） | 128MB，swap 0，rootfs local-lvm 1G，Alpine 3.24，`net0` vmbr0 `ip=manual`，onboot=0 | 运行 |
| 9000 | `tpl-tiny` | QEMU 模板 | 64MB，1G 磁盘 | 模板 |

可用镜像：

- ISO：`local:iso/alpine-virt-3.24.3-x86_64.iso`（约 67MB，用于创建向导）
- CT 模板：`local:vztmpl/alpine-3.24-default_20260714_amd64.tar.xz`

样例被改乱时的恢复方式（在 `ssh pvelab` 中执行）：

```sh
qm stop 100 2>/dev/null; qm rollback 100 base      # VM 100 回到 base 快照
qm start 101 2>/dev/null; pct start 200 2>/dev/null  # 101 和 200 应保持运行
```

## 客户机规格规则（必须遵守）

实验机内存很小，超出规格会导致客户机启动失败或实验机换页卡死。

- **VM**：内存 32–64MB；不加磁盘，或只加一块 ≤1G 的 local-lvm 磁盘；1 核；不挂系统盘也能启动（只验证 API 和界面）。
- **CT**：内存 64MB，swap 0，rootfs ≤1G（local-lvm），使用上面的 Alpine 模板，网卡 `ip=manual` 或不加网卡。
- 同一时间由测试启动的客户机不超过 3 台（不含固定样例），用完马上停止。
- 网卡一律接 `vmbr0`，不要配静态 IP，避免和局域网冲突。
- 备份写到 `local`，只备份 ≤1G 的客户机，测试结束删除备份文件。
- **自己创建的东西自己清理**：测试结束（包括失败时，放在 `afterEach`/`afterAll` 里）删除创建的客户机、快照、备份、用户、存储等，必要时加 `--purge`。

## VMID 分区

每个功能区只在自己的号段内创建客户机，避免并行测试互相干扰。创建前先检查 VMID 是否被占用（可以用 `/cluster/nextid?vmid=<id>` 检查），残留的同号客户机可以直接销毁。

| 功能区 | VMID 号段 |
| --- | --- |
| tasks | 3000–3099 |
| node | 3100–3199 |
| console | 3200–3299 |
| guest-core | 3300–3399 |
| qemu-config | 3400–3499 |
| lxc-config | 3500–3599 |
| snapshots-backup | 3600–3699 |
| create | 3700–3799 |
| storage | 3800–3899 |
| shell-polish | 3900–3999 |
| e2e-full | 4000–4999 |
| replication（实验集群） | 5700–5799 |

保留 VMID：100、101、200、9000（固定样例）。其他号段不要使用。

## 安全约束

- 只有实验机（192.168.0.245）可以写。生产主机 192.168.0.6 及其上的客户机绝不写入，应用也不能以可写方式连到它。
- 实验机宿主侧（生产主机上的 VM 9900）由编排脚本管理，测试不要关闭、重启或修改它。
- 密码只放在测试服务器的 `lab.env` 中。不要打印，也不要写进仓库、日志、截图或测试报告。
- 不要在实验机上做 `apt full-upgrade`、重启节点、修改 `vmbr0` 或管理网络等可能导致失联的操作。节点重启类测试只在界面上验证确认流程，不真的提交。

## 实验集群（3 节点，第二、三期用）

需要多节点的功能（存储复制、HA、迁移、集群、Ceph、SDN）在这个集群上测。它跑在另一台宿主 192.168.0.5 上（宿主上其他客户机一律不碰）。

| 项目 | 值 |
| --- | --- |
| 宿主 | 192.168.0.5 上的 VM 9901–9903（标签 `pve-web-lab`，快照 `fresh`） |
| 集群名 | `pve-web-lab` |
| 节点 | `pvelab-c1` 192.168.0.246、`pvelab-c2` 192.168.0.247、`pvelab-c3` 192.168.0.248 |
| 资源 | 每节点 2 核、3 GiB 内存；32G 系统盘 + 两块 16G 空盘（`sdb`、`sdc`，留给磁盘管理 / ZFS / Ceph OSD 测试） |
| 软件源 | pve-no-subscription、ceph-squid no-subscription（企业源已停用）；Ceph Squid 19.2 已安装（见下面“Ceph”） |

- 连接信息：测试服务器 `~/.config/pve-web/lab-cluster.env`（变量名同 `lab.env`，另有 `PVE_LAB_NODES`、`PVE_LAB_NODE_IPS`），`PVE_LAB_URL` 指向 c1。
- SSH：测试服务器上 `ssh pvelab-c1` / `pvelab-c2` / `pvelab-c3`；宿主 `ssh pve5`（只用于快照回滚，测试不要直接操作宿主）。
- 样例客户机和用户与单机实验机相同（在 c1 上：100、101、200、9000 模板、`tester@pve`、`lab-pool`）。VMID 在整个集群内唯一，号段规则同上。
- 回滚：在测试服务器上 `ssh pve5 'for i in 9901 9902 9903; do qm rollback $i fresh; qm start $i; done'`。
- 重建：`~/pvelab-build/cluster/cluster-setup.sh`（需要先用自动安装 ISO 装好 3 台节点）。
- 存储复制（`replication` 区，VMID 5700–5799）：c1、c2 的 `sdb` 上各有一个 ZFS 池 `e2erep`，集群存储 `e2e-rep`（zfspool，节点 pvelab-c1、pvelab-c2，content images,rootdir）。由 `e2e/tests/replication.spec.ts` 按需创建（幂等），测试结束后**保留**，留给后续阶段（HA、迁移）使用；c1、c2 的 `sdc` 现在是 Ceph OSD（见下）。不需要时：`pvesm remove e2e-rep`，再在 c1、c2 上 `zpool destroy e2erep && wipefs -a /dev/sdb`。
- Ceph（`ceph` 区）：三个节点都装了 Ceph Squid 19.2（`pveceph install --version squid --repository no-subscription`），公共网络和集群网络都是 `192.168.0.0/24`（`pveceph init --network 192.168.0.0/24`）。保留的状态：
  - 3 个监视器（每个节点一个）、1 个管理器（`pvelab-c1`）、3 个 OSD：`pvelab-c1:/dev/sdc`、`pvelab-c2:/dev/sdc`、`pvelab-c3:/dev/sdb`（c1、c2 的 `sdb` 属于 `e2erep`，不要用）。缺少的监视器和 OSD 由 `e2e/tests/ceph.spec.ts` 通过界面创建（幂等）。
  - **内存**：每节点只有 3 GiB，OSD 默认会占 4 GiB 缓存。已在配置数据库里调低：`ceph config set osd osd_memory_target 939524096`（896 MiB，Ceph 允许的最小值）。新建 OSD 自动生效；不要再调高。
  - 测试创建的对象一律叫 `e2e-ceph-*`（存储池、CephFS 和它的两个池、MDS），第二个管理器建在 `pvelab-c2` 上，`noout` 标志会被打开再关掉；测试结束（包括失败时）在 `afterAll` 里清理。正常状态是 `HEALTH_OK`。
  - 已知问题（PVE 9.2.2 + Ceph 19.2.6）：新集群的 admin 密钥是 60 字符、以单个 `=` 结尾（aes256k），而 PVE 的 `ceph_check_keyfile` 要求 RBD 密钥以 `==` 结尾，所以"添加为存储"生成的 `/etc/pve/priv/ceph/<存储>.keyring` 被判为"Not a proper rbd authentication file"：不带 force 销毁存储池会失败，用这类 RBD 存储放客户机磁盘也会失败。测试用"强制销毁"绕过；需要真正使用 RBD 存储时要先处理这个问题。
  - 销毁 CephFS 前必须停止所有 MDS（Ceph 要求），界面的销毁对话框默认先停止它们。
  - 没有 Ceph 的实验环境（单机实验机、未安装的集群）上 `@lab` Ceph 测试自动跳过。
  - 完全移除（一般不需要）：先删除存储池/CephFS，再在每个节点上 `pveceph osd destroy <id> --cleanup`（先 `ceph osd out <id>` 并停止）、`pveceph mon destroy <node>`、`pveceph mgr destroy <node>`，最后 `pveceph purge`。或者回滚快照 `pre-phase3`。
