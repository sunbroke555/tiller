# Docker 部署

使用 Docker Compose 运行 Tiller，无需在宿主机安装 Go、Node.js 或另外部署前端。镜像内包含管理界面和使用文档。

## 准备条件

- 安装 Docker Engine 和 [Docker Compose 插件](https://docs.docker.com/compose/install/)，或使用自带 Compose 的 Docker Desktop。
- 运行 `docker compose version` 确认命令可用；当前用户需有 Docker 操作权限，按系统配置使用 `sudo`。
- 容器能够访问 PVE 的 HTTPS 地址，通常为 `https://你的PVE地址:8006`。

公开镜像为 `ghcr.io/sunbroke555/tiller:latest`，支持 `linux/amd64` 和 `linux/arm64`，Docker 会选择对应架构。`latest` 随主分支发布更新；需要固定版本时，使用镜像仓库中实际存在的标签或摘要。

## 创建 Compose 配置

新建一个部署目录：

```sh
mkdir -p tiller
cd tiller
```

在目录中创建 `compose.yaml`，写入以下内容：

```yaml
services:
  tiller:
    image: ghcr.io/sunbroke555/tiller:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      LISTEN: :8080
      PVE_URL: ${PVE_URL:-}
      PVE_TLS_FINGERPRINT: ${PVE_TLS_FINGERPRINT:-}
      PVE_NAME: ${PVE_NAME:-默认 PVE}
      TILLER_AUTH_FILE: /data/tiller-auth.json
      TILLER_INSTANCES_FILE: /data/tiller-instances.json
      TRUSTED_PROXIES: ${TRUSTED_PROXIES:-}
    volumes:
      - tiller-data:/data
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  tiller-data:
```

也可以使用[仓库中的 compose.yaml](https://github.com/sunbroke555/tiller/blob/main/compose.yaml)。后续命令均在这个部署目录中执行。

### 预设 PVE 连接

在同目录创建 `.env`，将地址和指纹替换成自己的值：

```dotenv
PVE_URL=https://pve.example.internal:8006
PVE_TLS_FINGERPRINT=替换为PVE证书的完整SHA256指纹
PVE_NAME=我的PVE
```

在 PVE 的证书页面或通过 `pvenode cert info` 获取并核对 SHA-256 指纹。PVE 账号、密码或 API Token 在页面填写，不需要放在 `.env` 中。

支持独立 Tiller 管理员的版本可以省略 `.env`，首次登录后在页面添加全部 PVE 连接。直接使用 PVE 账号登录的旧版镜像需要先配置上面的 PVE 地址及证书。

## 启动与访问

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

查看启动日志：

```sh
docker compose logs --tail=100 tiller
```

默认将端口发布到宿主机的 `127.0.0.1:8080`。在宿主机本地可打开 `http://localhost:8080`；其他设备通过 HTTPS 反向代理访问，文档位于同一地址的 `/docs/`。

### 配置访问地址

- **反向代理在宿主机上**：上游填写 `http://127.0.0.1:8080`，对外提供自己的 HTTPS 域名。代理需支持 WebSocket 并保留 Host，控制台和终端也会经过它。
- **反向代理也在 Docker 中**：将代理和 Tiller 加入同一个 Docker 网络，上游填写 `http://tiller:8080`。代理容器里的 `127.0.0.1` 指向它自身，不能用来访问 Tiller 容器。
- **只在局域网临时试用**：将端口映射改成 `"8080:8080"`，重新执行 `docker compose up -d`，通过 `http://宿主机IP:8080` 访问。此方式会通过明文 HTTP 传输登录信息，长期使用应配置 HTTPS。

端口冲突时可将映射左侧改为其他宿主机端口，例如 `"127.0.0.1:8081:8080"`，容器内仍使用 8080。

如需识别真实客户端 IP，在 `.env` 中设置 `TRUSTED_PROXIES` 为实际代理地址或网段，再执行 `docker compose up -d`。Docker 网络可能改变 Tiller 看到的对端地址，应按自己的网络配置填写。更多说明见[访问范围与反向代理](configuration.md#访问范围与反向代理)。

## 首次登录

打开页面后，根据镜像所包含的版本操作：

- 显示 **设置管理员**：创建 Tiller 管理员账户，再在实例管理中添加 PVE；已有数据卷则使用原来的管理员账户。没有通用默认密码。详见[首次设置与登录](first-run.md)。
- 直接显示 **PVE 登录**：这是尚未包含独立管理员功能的旧版镜像，使用预设 PVE 的账号、认证域和密码登录。需要新版功能时，使用包含对应改动的镜像版本，或按下文从对应源码构建镜像。

## 更新与停止

更新前备份数据，然后在原部署目录执行：

```sh
docker compose pull
docker compose up -d
```

更新会重建容器并继续使用原数据卷。保持相同的部署目录名和 Compose 项目名，避免创建新的空卷。更新后可能需要重新登录。

只暂停服务：

```sh
docker compose stop
docker compose start
```

移除容器和网络、保留数据卷：

```sh
docker compose down
```

**需要保留配置时不要加 `-v`**：`docker compose down -v` 会同时删除该项目的数据卷。

## 数据持久化与备份

`tiller-data` 卷挂载到容器的 `/data`。支持独立管理员的版本在这里保存管理员配置、凭据加密密钥、实例配置及硬件监控连接配置。应备份整个目录，丢失 `.key` 文件会导致已保存的 PVE 凭据无法解密。Docker 数据卷独立于容器生命周期，详见 [Docker 数据卷说明](https://docs.docker.com/engine/storage/volumes/)。

停止写入后，将数据卷打包到当前目录；临时容器使用相同的数据卷，不会启动 Tiller 或占用服务端口：

```sh
docker compose stop tiller
docker compose run --rm --no-deps -T --entrypoint tar tiller -C /data -czf - . > tiller-backup.tar.gz
docker compose start tiller
```

确认备份命令成功后，妥善保存 `tiller-backup.tar.gz`、`compose.yaml` 和 `.env`。备份包含敏感配置与密钥。

恢复时使用原来的 Compose 配置，在启动服务前执行：

```sh
docker compose stop tiller
docker compose run --rm --no-deps -T --entrypoint tar tiller -C /data -xzf - < tiller-backup.tar.gz
docker compose up -d
```

恢复会覆盖同名文件；建议恢复到新的数据卷，或先备份现有数据。容器以 UID/GID `65532:65532` 运行，默认命名卷已处理目录权限；改用宿主机目录挂载时，需要保证该用户可以读写。

## 从源码构建 Docker 镜像

在需要部署的源码版本的仓库根目录执行：

```sh
docker build -t tiller:local .
```

Docker 会在构建阶段安装 Go、Node.js 及依赖，宿主机只需 Docker。在部署目录的 `compose.yaml` 中将镜像改为：

```yaml
    image: tiller:local
```

启动时使用本地镜像：

```sh
docker compose up -d --pull never
```

后续源码更新后重新执行 `docker build`，再执行上述启动命令；本地镜像的更新不使用 `docker compose pull`。
