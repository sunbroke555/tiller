# 安装与运行

完成后，你会得到一个 `tiller` 程序。它同时提供管理界面、这份文档，以及通往 PVE API 的代理，不需要另外运行前端服务器。

## 准备条件

- 一台已运行的 Proxmox VE，以及能够登录它的账号。
- 运行 Tiller 的主机能访问 PVE 的 HTTPS 地址，通常是 `https://<PVE 主机>:8006`。
- 从源码构建需要 Go 1.25+、Node.js 22.12+ 和 make。构建完成后，运行主机无需安装 Node.js。

## 从源码构建

在 Tiller 仓库根目录执行：

```sh
make server
```

构建会安装所需前端和文档依赖，将管理界面及文档打包进 `server/tiller`。把这个程序复制到相同操作系统、相同处理器架构的运行主机即可。

本仓库的开发环境约定把构建放到测试服务器执行：

```sh
rt --back server/tiller -- make server
```

取回的是测试服务器所用平台的二进制，不能直接当成 macOS 程序运行。

## 连接 PVE 并启动

先准备 PVE 证书的 SHA-256 指纹，以及用于访问 Tiller 的 HTTPS 证书和私钥。把以下占位内容替换成自己的值：

```sh
PVE_URL=https://pve.example.internal:8006 \
PVE_TLS_FINGERPRINT='<PVE 证书的完整 SHA-256 指纹>' \
TLS_CERT_FILE=/etc/tiller/cert.pem \
TLS_KEY_FILE=/etc/tiller/key.pem \
LISTEN=:8443 \
./server/tiller
```

浏览器打开 `https://<Tiller 主机>:8443`，然后按[首次登录](first-run.md)操作。这份文档位于同一地址的 `/docs/`。

`PVE_TLS_FINGERPRINT` 用来确认连接的是你的 PVE；`TLS_CERT_FILE` 和 `TLS_KEY_FILE` 则保护浏览器到 Tiller 的连接，两者负责不同的一段网络。详情见[连接与安全配置](configuration.md)。

::: warning 仅供临时实验
没有配置 HTTPS 的 Tiller 会通过明文 HTTP 传输登录密码和会话信息。`PVE_INSECURE_TLS=1` 还会跳过上游 PVE 的证书校验。它们适用于隔离的实验环境，正式使用请配置证书或 TLS 反向代理。
:::

## 放在反向代理后面

如果 Caddy、nginx 等已经负责 HTTPS，让 Tiller 只监听代理能访问的地址。同机部署可使用：

```sh
PVE_URL=https://pve.example.internal:8006 \
PVE_CA_FILE=/etc/tiller/pve-root-ca.pem \
LISTEN=127.0.0.1:8080 \
TRUSTED_PROXIES=127.0.0.1,::1 \
./server/tiller
```

把代理的站点根路径指向 `http://127.0.0.1:8080`，保留客户端访问的 Host，支持 WebSocket，并正确转发客户端地址。Tiller 目前按站点根路径运行，请使用独立域名或端口。

## 更新与重启

从更新后的源码重新执行 `make server`，停止旧进程，替换程序后使用原来的环境变量启动。正在使用的控制台连接会断开，重新进入即可。

Tiller 不在服务端保存 PVE 凭据或资源数据；资源和权限由 PVE 管理，主题等个人偏好保存在浏览器。替换程序时仍应保留自己的启动配置、证书和私钥。
