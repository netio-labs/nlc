# 快速入门

本指南介绍首次设置，并完整演示如何运行第一个 Lab。

## 第 1 步：登录

在浏览器中打开 NLC，你会被重定向到登录页面。使用默认凭据登录：

| 用户名  | 密码       |
| ------- | ---------- |
| `admin` | `changeme` |

## 第 2 步：上传 IOU/IOL 镜像

进入 **设置 → 镜像**（Settings → Images），点击 **上传镜像**（Upload Image），选择你的镜像文件。

镜像文件名规则：

| Profile | 文件名前缀       |
| ------- | ---------------- |
| Router  | `I86BI_LINUX`    |
| Switch  | `I86BI_LINUX_L2` |

后端会拒绝不符合这些前缀的文件名。

> 系统默认附带一个占位镜像（`I86BI_LINUX-FAKE-M-15.0.py` / `I86BI_LINUX_L2-FAKE-M-15.0.py`）。它可以打开控制台并显示一条提示，但不具备任何路由或交换功能。在获得真实镜像之前，可用它来验证环境是否正常工作。

## 第 3 步：设置 IOU/IOL 密钥

进入 **设置 → 运行时**（Settings → Runtime）。页面会自动显示后端主机名。在 **更新 IOU/IOL 密钥**（Update IOU/IOL key）字段中输入密钥，然后点击 **保存**（Save）。

节点是否检查 `iourc` 取决于镜像：

- **部分 IOU/IOL 镜像**会在启动时校验 `iourc` 密钥，如果没有对应后端主机名的有效密钥将无法运行。
- **部分较新的 IOL 镜像**启动时并不严格要求 `iourc`，没有密钥也能运行。

## 第 4 步：准备容器镜像（可选）

如果只使用 IOU/IOL，可以跳过这一步。

容器镜像存放在服务器的 rootful Podman 中，需要在服务器上用 `sudo podman` 管理：

1. 进入 **设置 → Shell**（Settings → Shell），用后端服务器的 Linux 账户登录（参见 [Shell](./06-settings.md#shell)）。
2. 在终端中用以下命令管理镜像。

| 操作                                 | 命令                                                      |
| ------------------------------------ | --------------------------------------------------------- |
| 从镜像仓库拉取                       | `sudo podman pull docker.io/frrouting/frr:latest`         |
| 导入厂商提供的镜像包（如 cRPD、XRd） | `sudo podman load -i <镜像包文件>`                        |
| 导入 cEOS（rootfs 压缩包）           | `sudo podman import cEOS64-lab-<版本>.tar.xz ceos:<版本>` |
| 查看已有镜像                         | `sudo podman images`                                      |
| 删除镜像                             | `sudo podman rmi <镜像名>:<标签>`                         |

注意事项：

- **必须加 `sudo`。** NLC 只读取 root 的镜像存储；已经导入到用户存储中的镜像可以这样复制过去：`podman save <镜像名> | sudo podman load`。
- 厂商的镜像包需要先用 scp 传到服务器上。

## 第 5 步：创建 Lab

要创建新 Lab，进入 **Labs** 页面并点击 **新建**（Create）。这会打开拓扑编辑器，画布为空白。

1. 在顶栏中输入 **Lab 名称**（Lab name）。
2. 使用画布底部的工具栏添加节点：
   - Router 图标——添加 Router 节点
   - Switch 图标——添加 Switch 节点
   - Container 图标——添加容器节点
3. 拖动任意节点上的连接柄，将其连接到另一个节点。
4. 点击 **保存 Lab**（Save Lab）。

完整说明参见[拓扑编辑器](./02-topo-editor.md)。

## 第 6 步：运行 Lab

保存后，点击顶栏中的 **查看**（View），或从 Labs 页面打开该 Lab。在拓扑查看器中：

1. 点击 **加载**（Load）——分配资源并写入 netmap。
2. 点击 **全部启动**（Start All）——启动所有节点进程。
3. 点击 **控制台**（Console）——为所有节点打开浏览器终端。

完整说明参见 [Lab 操作](./03-lab.md)。
