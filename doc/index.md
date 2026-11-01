# Tiller 使用手册

手机上也能稳稳掌舵你的 Proxmox VE。

Tiller 是基于 Proxmox VE 官方 API 的管理界面。用现有 PVE 账号登录，即可查看集群资源、管理虚拟机和容器、打开控制台、跟踪备份与任务。

这份手册提供在线版本，也随 Tiller 一起打包，无需登录。电脑左侧是章节目录，手机点击「文档目录」展开；顶部搜索可以直接查找按钮名称、问题或配置项。

## 第一次使用

1. **[安装与运行](guide/install.md)**：构建 Tiller，连接已有的 PVE，打开登录页面。
2. **[连接与安全配置](guide/configuration.md)**：设置证书、监听地址和反向代理。
3. **[首次登录](guide/first-run.md)**：选择认证域，用 PVE 账号完成登录和两步验证。
4. **[导航与资源概览](manual/navigation.md)**：找到节点、虚拟机、容器和存储，开始日常管理。

::: tip 已经能打开管理界面？
可以直接从[虚拟机与容器](manual/guests.md)开始。在 Tiller 内打开文档时，顶部的「返回 Tiller」会回到当前实例；在线文档则提供「项目主页」入口。
:::

## 按要做的事查找

| 你想做什么 | 对应说明 |
| --- | --- |
| 开关机、修改硬件、克隆或迁移客户机 | [虚拟机与容器](manual/guests.md) |
| 上传 ISO、下载模板、备份或恢复 | [存储、快照与备份](manual/storage-backup.md) |
| 打开 Shell、操作屏幕、查看失败原因 | [控制台与任务日志](manual/console-tasks.md) |
| 配置节点网络、计划备份、集群与高可用 | [节点与数据中心](manual/administration.md) |
| 修改密码、设置两步验证、检查操作权限 | [账户与权限](manual/account.md) |
| 切换主题、调整列表密度、添加到手机主屏幕 | [外观与手机使用](manual/appearance.md) |
| 登录失败、控制台断开、找不到按钮 | [常见问题与排查](guide/troubleshooting.md) |
| 不理解 VM、CT、认证域、UPID 等名称 | [常见名词](guide/terms.md) |

## 操作前先看清对象

Tiller 直接操作连接的 PVE。执行启动、关机、保存配置或删除时，作用对象就是页面中的节点、客户机或存储；文档里的地址和名称都是示例。

耗时操作会产生任务。提交成功后，打开任务日志确认最终结果，再判断操作是否完成。删除、恢复和网络变更前，先核对目标与备份。

可见页面和可执行操作受 PVE 版本、账号权限及资源配置影响。具体能力以当前界面和 PVE 返回结果为准。

---

Tiller 是独立项目，与 Proxmox Server Solutions GmbH 无关。Proxmox 是其注册商标。
