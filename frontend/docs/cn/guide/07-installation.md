# 附录：安装指南

本指南介绍如何在 64 位 Ubuntu/Debian Linux 系统（包括 WSL2）上安装 NLC 及其依赖。

---

## 1. 部署目录与运行用户

随附的 sudoers 规则和 systemd 服务文件默认 NLC 位于 `/opt/nlc`，后端以 `nlc` 用户运行。按默认方式部署：

```bash
sudo mkdir -p /opt/nlc
# 将 NLC 代码放入 /opt/nlc（包含 backend/、frontend/、deploy/ 目录）
sudo useradd -r -s /usr/sbin/nologin -d /opt/nlc nlc
sudo chown -R nlc:nlc /opt/nlc
```

> 本地开发时可以用自己的账户运行后端。此时，第 5、6 节安装 sudoers 规则前，要把文件中的 `nlc` 改成你的用户名；如果代码不在 `/opt/nlc`，还要同时修改文件中的路径。

---

## 2. 基础依赖

### Node.js

NLC 需要 Node.js 24 或更高版本。

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

### 其他软件包

```bash
sudo apt-get install -y psmisc python3 openssh-server
```

| 软件包           | 用途                                                   |
| ---------------- | ------------------------------------------------------ |
| `psmisc`         | 提供 `fuser`，后端按控制台端口判断和停止节点进程       |
| `python3`        | Virtual PC、占位镜像和容器网络辅助程序都是 Python 脚本 |
| `openssh-server` | **设置 → Shell** 通过 SSH 登录后端服务器本身           |

WSL 等环境中 `sshd` 可能没有自动启动，需要手动启动并为账户设置密码：

```bash
sudo service ssh start
sudo passwd <用户名>
```

---

## 3. IOU/IOL 运行环境

### 3.1 32 位运行时库

传统 IOU 镜像（`.bin`）是 32 位程序，需要 32 位运行时库：

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y libc6:i386 libstdc++6:i386 zlib1g:i386
```

| 软件包            | 提供                                         |
| ----------------- | -------------------------------------------- |
| `libc6:i386`      | 32 位 C 标准库（`ld-linux.so.2` 动态链接器） |
| `libstdc++6:i386` | 32 位 C++ 标准库（同时带入 `libgcc_s`）      |
| `zlib1g:i386`     | 压缩库（`libssl0.9.8` 需要）                 |

64 位的 IOL 镜像（`.iol`）不需要这些库。

### 3.2 旧版 OpenSSL 0.9.8（部分较旧镜像需要）

部分较旧的 IOU 镜像会查找 `libcrypto.so.4`。用 `ldd <镜像文件>` 检查，如果输出中有 `libcrypto.so.4 => not found`，再执行：

```bash
wget -q http://old-releases.ubuntu.com/ubuntu/pool/main/o/openssl/libssl0.9.8_0.9.8g-4ubuntu3.20_i386.deb \
     -O /tmp/libssl0.9.8_i386.deb
sudo dpkg -i /tmp/libssl0.9.8_i386.deb
sudo ln -s /lib/libcrypto.so.0.9.8 /lib/libcrypto.so.4
```

### 3.3 IOU/IOL 镜像

NLC 不分发 IOU/IOL 镜像。推荐在 **设置 → 镜像**（Settings → Images）中上传（参见[快速入门](./01-getting-started.md)），上传时会自动设置可执行权限。

也可以手动将镜像放入 `backend/addons/iou/`，并添加可执行权限：

| 文件               | 说明                |
| ------------------ | ------------------- |
| `I86BI_LINUX-*`    | Router IOU/IOL 镜像 |
| `I86BI_LINUX_L2-*` | Switch IOU/IOL 镜像 |

```bash
chmod +x backend/addons/iou/I86BI_LINUX*
```

---

## 4. sharkd（用于抓包）

抓包查看器通过 `sharkd` 解析报文：

```bash
sudo apt-get install -y wireshark-common
which sharkd
```

安装过程中会询问是否允许非超级用户抓包，选 **Yes** 或 **No** 都可以：NLC 自己采集报文，`sharkd` 只负责解析，不需要抓包权限。

---

## 5. IOULive86 物理网络桥接

**IOULive86 Bridge** 节点将 Lab 中的虚拟接口连接到服务器上的真实网卡（参见[拓扑编辑器](./02-topo-editor.md)指南）。它需要 `CAP_NET_RAW`，因此通过免密 `sudo` 启动。

> 如果不使用 IOULive86 Bridge 节点，请跳过本节。

### 5.1 安装 sudoers 规则

随附的 `deploy/nlc-ioulive86.sudoers` 只为 `ioulive86` 这一个程序授予免密 `sudo`：

```
Cmnd_Alias NLC_IOULIVE86 = /opt/nlc/backend/addons/iou/ioulive86
nlc  ALL=(root) NOPASSWD: NLC_IOULIVE86
```

如有需要，先按[第 1 节](#1-部署目录与运行用户)修改用户名和路径，然后安装：

```bash
sudo install -m 0440 /opt/nlc/deploy/nlc-ioulive86.sudoers /etc/sudoers.d/nlc-ioulive86
sudo visudo -c
```

`visudo -c` 必须报告该文件解析正常（parsed OK）。

### 5.2 验证

以后端用户身份运行以下命令，应当打印出用法行，且不要求输入密码：

```bash
sudo -n /opt/nlc/backend/addons/iou/ioulive86 2>&1 | head -1
```

---

## 6. 容器节点（Podman）

**容器**节点运行 rootful Podman 容器（参见[拓扑编辑器](./02-topo-editor.md#容器)指南）。后端通过免密 `sudo` 调用 `podman`，并通过辅助程序 `nlc-netns-helper` 连接容器的虚拟链路。

> 如果不使用容器节点，请跳过本节。

> **安全提示：** 免密 `sudo podman` 等同于把 root 权限交给后端用户（例如 `podman run --privileged -v /:/host`）。请在专用主机上运行 NLC。

### 6.1 安装 Podman

```bash
sudo apt-get install -y podman
sudo podman info
```

### 6.2 将辅助程序设为 root 所有

辅助程序必须归 `root` 所有，且后端用户**不可写**，否则对它的免密 `sudo` 就会变成提权到 root 的途径：

```bash
sudo chown root:root /opt/nlc/backend/addons/helper/nlc-netns-helper
sudo chmod 0755      /opt/nlc/backend/addons/helper/nlc-netns-helper
```

### 6.3 安装 sudoers 规则

随附两个文件：`deploy/nlc-podman.sudoers`（允许 `podman`）和 `deploy/nlc-netns-helper.sudoers`（只允许辅助程序）。如有需要，先按[第 1 节](#1-部署目录与运行用户)修改用户名和路径，然后安装：

```bash
sudo install -m 0440 /opt/nlc/deploy/nlc-podman.sudoers /etc/sudoers.d/nlc-podman
sudo install -m 0440 /opt/nlc/deploy/nlc-netns-helper.sudoers /etc/sudoers.d/nlc-netns-helper
sudo visudo -c
```

`visudo -c` 必须报告两个文件都解析正常（parsed OK）。

### 6.4 验证

以后端用户身份运行以下命令，都不应要求输入密码：

```bash
sudo -n podman --version
sudo -n /opt/nlc/backend/addons/helper/nlc-netns-helper 2>&1 | head -1   # 打印辅助程序的用法
```

容器镜像的导入参见[快速入门](./01-getting-started.md)。

---

## 7. 构建与启动

后端：

```bash
cd /opt/nlc/backend
npm install
npm run build
npm start       # 默认监听 8080 端口
```

前端：

```bash
cd /opt/nlc/frontend
npm install
rm -rf .next/cache
npm run build
npm start       # 默认监听 3000 端口
```

后端将 Lab 定义存放在 `backend/labs/`，已保存的设备配置存放在 `backend/configurations/<labId>/`（每个配置一个 Markdown 文件，以配置名称命名），节点运行时文件存放在 `backend/running/`（卸载时删除）。请将 `labs/` 和 `configurations/` 纳入备份。

---

## 8. 使用 systemd 和 Nginx 进行生产部署

长期运行的服务器部署，建议在 systemd 下运行前后端两个服务，并在前面放置 Nginx。

### 8.1 安装 systemd 服务

随附的服务文件以 `nlc` 用户运行，使用[第 2 节](#2-基础依赖)安装的 `/usr/bin/node`。如果 Node.js 装在别处（例如用 nvm 安装），先按 `which node` 的结果修改两个服务文件中的 `ExecStart`。

```bash
sudo cp /opt/nlc/deploy/nlc-backend.service /etc/systemd/system/
sudo cp /opt/nlc/deploy/nlc-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nlc-backend nlc-frontend
```

检查状态与日志：

```bash
sudo systemctl status nlc-backend nlc-frontend
journalctl -u nlc-backend -u nlc-frontend -f
```

### 8.2 配置 Nginx（HTTPS）

```bash
sudo apt-get install -y nginx
```

生成自签名证书（有效期一年）。把 `nlc.lab.com` 和 `192.168.56.129` 换成服务器的域名和 IP：

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /etc/nginx/ssl/nlc.key -out /etc/nginx/ssl/nlc.crt \
  -subj "/CN=nlc" -addext "subjectAltName=DNS:nlc.lab.com,IP:192.168.56.129"
sudo chmod 600 /etc/nginx/ssl/nlc.key
```

安装站点配置：

```bash
sudo cp /opt/nlc/deploy/nginx.conf /etc/nginx/sites-available/nlc
sudo ln -s /etc/nginx/sites-available/nlc /etc/nginx/sites-enabled/nlc
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

站点配置会把 HTTP 重定向到 HTTPS，`/v1/` 转发到后端（8080），其余转发到前端（3000）。如果 `nginx -t` 报 `$connection_upgrade` 重复定义，删掉站点配置开头的 `map` 块即可。

之后用 `https://<服务器 IP>` 访问。自签名证书不受浏览器信任，首次访问需在警告页面中选择继续访问。证书过期后重新执行上面的 `openssl` 命令，再 `sudo systemctl reload nginx`。

### 8.3 后端 URL

**设置 → 后端**（Settings → Backend）保持默认即可：Internal URL 为 `http://localhost:8080`，Public URL 留空。浏览器会按页面地址自动经 Nginx 的 `/v1/` 连接后端（参见[设置](./06-settings.md#public-url)）。
