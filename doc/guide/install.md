# 安装与运行

Tiller 同时提供管理界面、这份文档，以及通往 PVE API 的代理，不需要另外运行前端服务器。

常规部署可以直接使用 [Docker Compose 教程](docker.md)，包含启动、访问、登录、更新和数据备份。下面介绍从源码构建并直接运行 `tiller` 程序的方式。

## 准备条件

- 一台或多台已运行的 Proxmox VE，以及有相应权限的 PVE 账号密码或 API Token。
- 运行 Tiller 的主机能访问 PVE 的 HTTPS 地址，通常是 `https://<PVE 主机>:8006`。
- 从源码构建需要 Git、Go 1.25+、Node.js 22.12+（含 npm）、make 和 Bash。构建完成后，运行主机无需安装 Go 或 Node.js。

## 从源码构建

获取源码并构建：

```sh
git clone https://github.com/sunbroke555/tiller.git
cd tiller
make server
```

构建会自动下载依赖，将管理界面及文档打包进 `server/tiller`。默认生成适用于当前操作系统和处理器架构的程序，可复制到相同平台的运行主机。构建时无需连接 PVE。

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

更新时保留管理员配置、对应的 `.key` 密钥文件和实例配置文件；实例的 PVE 密码或 Token 已加密保存在其中。资源和权限由 PVE 管理，主题等个人偏好保存在浏览器。启动配置、证书和私钥也应保留。服务重启后需要重新登录 Tiller。
