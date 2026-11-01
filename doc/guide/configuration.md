# 连接与安全配置

Tiller 的服务端通过环境变量配置，修改后需要重启进程。浏览器里的「外观与偏好」只影响当前设备，不会修改这些服务端参数。

## 两段连接

```text
浏览器 ── HTTPS ── Tiller ── HTTPS ── Proxmox VE
                   /docs/            :8006
```

浏览器到 Tiller 的证书与 Tiller 到 PVE 的证书分别配置。浏览器显示安全锁，并不代表上游 PVE 的证书已经正确校验。

## PVE 地址与证书

| 环境变量 | 用途 |
| --- | --- |
| `PVE_URL` | PVE 地址，只填协议、主机和端口。默认 `https://127.0.0.1:8006`；只有 Tiller 与 PVE 同机时才通常适用 |
| `PVE_TLS_FINGERPRINT` | 固定信任 PVE 叶子证书的 SHA-256 指纹，接受冒号分隔或纯十六进制形式 |
| `PVE_CA_FILE` | 用指定 CA 文件校验 PVE，例如 PVE 根证书的副本 |
| `PVE_INSECURE_TLS=1` | 跳过 PVE 证书校验，仅用于实验环境；不能与固定指纹同时使用 |
| `PVE_ALLOW_HTTP=1` | 允许通过明文 HTTP 连接非本机 PVE 地址；通常无需启用 |

可以在 PVE 的证书页面查看证书，或在 PVE 主机上执行 `pvenode cert info` 核对指纹。不要使用未经核对的证书指纹。PVE 证书更换后，固定指纹也需要更新。

不设置指纹或自定义 CA 时，Tiller 按系统信任链验证 PVE 证书。自签名证书通常需要固定指纹或提供 CA 文件。

## Tiller 的监听与 HTTPS

| 环境变量 | 用途 |
| --- | --- |
| `LISTEN` | 监听地址，默认 `:8080`。同机反向代理可用 `127.0.0.1:8080` |
| `TLS_CERT_FILE` | Tiller HTTPS 证书文件，与私钥一起设置 |
| `TLS_KEY_FILE` | Tiller HTTPS 私钥文件 |
| `WEB_DIR` | 从指定磁盘目录提供前端与文档，主要用于调试；通常使用二进制内嵌版本即可 |

手机添加到主屏幕、WebAuthn 等浏览器能力需要安全上下文。使用客户端信任的 HTTPS 地址，避免靠忽略证书错误长期访问。

## 访问范围与反向代理

| 环境变量 | 用途 |
| --- | --- |
| `ALLOW_FROM` | 允许访问的客户端 IP 或网段，逗号分隔，例如 `192.168.1.0/24,10.8.0.5`；本机地址总是允许 |
| `TRUSTED_PROXIES` | 信任哪些代理发来的 `X-Forwarded-For`，填写代理的 IP 或网段 |

只把实际使用的代理加入 `TRUSTED_PROXIES`，这样登录限速和日志才能识别真实客户端地址。`ALLOW_FROM` 也适用于文档；无需登录不代表绕过实例的访问限制。

Tiller 向 PVE 转发 `X-Forwarded-For`。如果需要在 pveproxy 访问日志里查看真实客户端地址，可按 PVE 的配置设置 `PROXY_REAL_IP_HEADER` 和 `PROXY_REAL_IP_ALLOW_FROM`。pveproxy 的访问控制仍可能只看到 Tiller 的地址，应在 Tiller 上配置客户端范围。

## 登录信息如何处理

网页登录使用的 ticket 存在 HttpOnly 会话 Cookie 中，前端脚本不能读取。Tiller 不在服务端持久化密码或 ticket；转发请求时使用 PVE 的认证和权限体系。

连续登录失败会触发限速。遇到等待提示先检查用户名、认证域和密码，详情见[登录失败排查](troubleshooting.md#登录失败或提示等待)。
