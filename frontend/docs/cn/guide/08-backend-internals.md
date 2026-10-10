# 附录：后端命令行内部机制

本文是开发者参考，介绍 NLC 后端如何在命令行层面驱动节点进程，以及开发期间如何手工将容器连接到 `ioulive86` 桥接。

以下路径均假定使用 `/opt/nlc/backend` 下的默认布局。

---

## 1. `wrapper-linux`：控制台/进程包装器

每个 IOU 节点、每个容器控制台以及浏览器 Shell，都通过 `wrapper-linux`（`addons/iou/wrapper-linux`）运行其子进程。它 fork 出子进程，独占一个 TCP 端口，并将子进程的控制台以 **telnet 风格的流**对外提供，前端终端（经由后端的 WebSocket 桥接）连接到该流。即使没有客户端连接，它也会保持子进程运行，并向下一个连接的客户端回放最后约 32 KB 的输出，因此启动日志始终可见。

```
wrapper-linux -m /path/to/image -p <port> [-t "Title"] [-d delay] [-P] -- [child options]
```

| 选项                 | 含义                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------- |
| `-m <image>`         | 要运行的可执行文件（IOU 镜像、`podman`、`/usr/bin/ssh`……）。必须具有可执行权限。       |
| `-p <port>`          | 控制台监听的 TCP 端口（1025–65535）。NLC 使用 `consoleBasePort (20000) + instanceId`。 |
| `-t "Title"`         | 控制台窗口标题（节点名称）。                                                           |
| `-d <delay>`         | 启动子进程前等待的秒数。                                                               |
| `-P`                 | 为子进程分配一个 **pty**（`podman exec -it` 和 `ssh` 等交互式 shell 需要）。           |
| `-- <child options>` | `--` 之后的所有内容都原样传给子进程。                                                  |

同一时间只允许一个控制台会话；第二个连接会收到一行 "busy" 提示后被关闭。向包装器发送 `SIGTERM`/`SIGINT` 会停止子进程；`SIGHUP` 会断开当前客户端，但保持子进程运行。

**NLC 的调用方式**

IOU 路由器/交换机（管道模式；`--` 之后是 IOU 自身的参数——`-e` Ethernet、`-s` Serial、`-n` nvram、`-m` ram、`-l` L2 keepalive、`-W` 不使用 watchdog、`-N` 忽略 NETMAP，最后是实例 ID）：

```bash
wrapper-linux -m <IOU image> -p 20055 -d 0 -t r1 -- -e 2 -s 0 -n 64 -m 256 55
```

容器控制台（pty 模式，通过 `podman exec` 进入正在运行的容器）。shell 在一个 "Press RETURN" 提示后循环运行，因此退出 shell 不会结束包装器（否则会关闭控制台端口，使节点看起来像已停止）：

```bash
wrapper-linux -P -m /usr/bin/sudo -p 20005 -t c1 -- -n /usr/bin/podman exec -it nlc-<nodeId> \
  /bin/sh -c 'trap : INT; while :; do echo; echo "[nlc] Press RETURN to start <shell>"; read _ || sleep 1; <shell>; done'
```

浏览器 Shell（pty 模式，通过 `ssh` 连接到后端主机——参见[设置指南](./06-settings.md#shell)）：

```bash
wrapper-linux -P -m /usr/bin/ssh -p <port> -t "ssh user@localhost" -- -tt -o StrictHostKeyChecking=accept-new -l <user> localhost
```

---

## 2. `ioulive86`：IOU 与 Linux 接口之间的桥接

`ioulive86`（`addons/iou/ioulive86`）将 IOU 节点的 NETIO 套接字桥接到一个真实的 Linux L2 接口：一块**物理网卡**（IOULive86 Bridge 节点），或者一个另一端位于容器网络命名空间中的 **veth**（`interface=auto`）。抓取原始 Ethernet 帧需要 `CAP_NET_RAW`，因此它通过 `sudo` 启动（参见[安装指南](./07-installation.md#5-ioulive86-物理网络桥接)）。

```
ioulive86 -i <interface> [-n NETMAP] [-p <console port>] [-t <title>] <instance ID>
```

| 参数                | 含义                                                               |
| ------------------- | ------------------------------------------------------------------ |
| `-i <interface>`    | 要桥接的 Linux 接口（例如 `eth0`，或一个 `podveth<N>` veth）。     |
| `-n <NETMAP>`       | Lab 的 `NETMAP` 文件路径，该文件描述 IOU 与 ioulive86 的配对关系。 |
| `-p <console port>` | 状态屏幕控制台端口（`20000 + instanceId`）。                       |
| `-t <title>`        | 控制台标题（节点名称）。                                           |
| `<instance ID>`     | ioulive86 的实例 ID；它通过 NETIO 与一个 IOU 实例 ID 配对。        |

**NLC 的调用方式**（注意开头的 `-n` 是 `sudo` 的“非交互”参数，后面跟的是程序路径）：

```bash
sudo -n /opt/nlc/backend/addons/iou/ioulive86 -i eth0 -n <lab dir>/NETMAP -p 20056 -t lan1 56
```

IOU 一侧通过位于 `/tmp/netio<uid>/<instanceId>` 的 NETIO Unix 数据报套接字通信；`NETMAP`（位于 Lab 运行时目录中）将 IOU 实例映射到 ioulive86 实例。

`ioulive86` 的控制台是一个实时状态屏幕，而不是 CLI：

```
ioulive86 is working with physical interface veth0
  IOU instance 55 0/0 <-> ioulive86 instance 56 (IOU socket present)
  frames LAN->IOU: 46   IOU->LAN: 6870   dropped: 0   raw errors: 0
  offload fixes: checksum 0   vlan tag 0
```

出现 `IOU socket present` 且帧计数器不断增长，说明数据路径已打通。

---

## 3. 容器与 veth 连接

容器节点在 **rootful Podman**（`sudo -n podman`）下运行，并以 `--network none` 启动——由 NLC 自行注入接口。将 veth 的一端移入容器的网络命名空间，需要借助下面的辅助程序。

### 3.1 `nlc-netns-helper`

`addons/helper/nlc-netns-helper` 是一个小型的、归 root 所有的 Python 辅助程序，通过 `sudo -n` 调用。它只会操作 `podveth<N>` 接口（参见[安装指南](./07-installation.md#6-容器节点podman)）。它有三个子命令：

```bash
# Container ↔ ioulive86: one veth pair, root end stays in the host, cont end goes into the container
nlc-netns-helper create --pid <container pid> --root-veth podveth<N> --cont-veth eth<k> \
                        [--addr 10.1.1.2] [--prefix 24] [--gateway 10.1.1.1]

# Tear a root veth down (idempotent)
nlc-netns-helper delete --root-veth podveth<N>

# Container ↔ container: a veth pair with each end injected into a different netns
nlc-netns-helper pair --a-pid <pidA> --a-cont-veth eth<k> [--a-addr … --a-prefix … --a-gateway …] \
                      --b-pid <pidB> --b-cont-veth eth<m> [--b-addr … --b-prefix … --b-gateway …]
```

- **容器 ↔ IOU / 物理网卡**：`create` 创建一对 `podveth<N>`，将容器一端以 `eth<k>` 注入容器，并将 `podveth<N>` 留在主机中，供 `ioulive86 -i podveth<N>` 桥接。
- **容器 ↔ 容器**：`pair` 创建一对 veth，并将两端分别直接注入各自容器的 netns——不需要 `ioulive86`，也不需要 NETIO。

### 3.2 手工演练（开发用）

以下是辅助程序所自动化的手工步骤，保留作参考。它将单个 Alpine 容器连接到一个 `ioulive86` 桥接，并验证与配置为 `10.1.1.1` 的 IOU 路由器之间的连通性。（这里的 veth `veth0`/`veth1` 是预先存在的一对测试接口；在生产环境中，辅助程序会以 `podveth<N>` 的名称创建它们。）

```bash
# 1. Start a container with no networking
sudo podman run -d --name nlc-alpine --network none alpine sleep infinity

# 2. Find its main PID — this is the handle to its network namespace
sudo podman inspect -f '{{.State.Pid}}' nlc-alpine   # e.g. 117303

# 3. Move one veth end into the container netns, rename it, bring it up, address it
sudo ip link set veth1 netns 117303
sudo nsenter -t 117303 -n ip link set veth1 name eth1
sudo nsenter -t 117303 -n ip link set eth1 up
sudo nsenter -t 117303 -n ip addr add 10.1.1.2/24 dev eth1

# 4. The other end (veth0) stays in the host for ioulive86 to bridge:
#    ioulive86 -i veth0 ... <instanceId>   (IOU router on the far side, 10.1.1.1)

# 5. Verify from inside the container
sudo podman exec -it nlc-alpine /bin/sh   # note: alpine has /bin/sh, not /bin/bash
/ # ping 10.1.1.1

# 6. Clean up (removing the container frees the netns and destroys its veth end)
sudo podman rm -f nlc-alpine
```

### 3.3 使用 `nsenter` 检查命名空间

`nsenter -t <pid> -n <cmd>` 会在进程 `<pid>` 的网络命名空间内运行 `<cmd>`——这是从主机查看容器 netns 内部情况的方法：

```bash
# What interfaces / addresses does the container see?
sudo nsenter -t <pid> -n ip -o link show
sudo nsenter -t <pid> -n ip addr show

# Routing and reachability from inside the container's netns
sudo nsenter -t <pid> -n ip route
sudo nsenter -t <pid> -n ping -c3 10.1.1.1
```

在**主机**一侧，对端位于容器中的 veth 会显示对端索引和 `link-netnsid`，例如 `veth0@if3 … link-netnsid 0`；而在容器内，对应的接口显示为 `eth1@if4 … link-netnsid 0`。对照两边视图中的 `@ifN` 索引，即可确认哪个主机 veth 与哪个容器接口配对。

> 在 `backend/src/config.ts` 中启用 `enableDebug.container` / `enableDebug.ioulive86` / `enableDebug.shell`，即可记录后端实际执行的 `podman`、辅助程序、`ioulive86` 和 `wrapper-linux` 命令行——这是了解需要手工复现什么的最快方法。

---

## 4. Python 模拟镜像（`netio_sim`）

Virtual PC 以及占位路由器/交换机都是直接使用 NETIO 通信的 Python 程序（Unix 数据报套接字位于 `/tmp/netio<uid>/<instance>`，对端信息来自 `NETMAP`），像任何 IOU 镜像一样由 `wrapper-linux` 启动。

镜像列表就是 `addons/iou` 中的**文件**集合，因此那里的每个镜像都只是一个很薄的入口；代码位于 `addons/iou/netio_sim/` 包中：

| 镜像文件                        | 入口                                |
| ------------------------------- | ----------------------------------- |
| `NETIO_VIRTUAL_PC`              | `netio_sim.vpc_cli.main()`          |
| `I86BI_LINUX-FAKE-M-15.0.py`    | `netio_sim.fake_iou.main("router")` |
| `I86BI_LINUX_L2-FAKE-M-15.0.py` | `netio_sim.fake_iou.main("switch")` |

| 模块          | 内容                                                       |
| ------------- | ---------------------------------------------------------- |
| `netio.py`    | NETIO 套接字路径、`NETMAP` 解析、8 字节 NETIO 头部（共享） |
| `packets.py`  | Ethernet / ARP / IPv4 / ICMP / TCP / UDP 报文构造与校验和  |
| `tcp.py`      | 客户端 TCP 连接                                            |
| `dhcp.py`     | DHCP 客户端（租约计时器、续租/重新绑定、释放、调试输出）   |
| `apps.py`     | `telnet`、`ssh`、`get`、`web`——`VirtualPC` 上的一个 mixin  |
| `vpc.py`      | `VirtualPC`：接收/分发、ARP、ping、配置文件、`show`        |
| `console.py`  | Virtual PC 行编辑（历史记录、`?`、后台消息后的重绘）       |
| `vpc_cli.py`  | Virtual PC 命令分发、帮助文本、`main()`                    |
| `fake_iou.py` | 占位控制台 + 针对每个对端的周期性免费 ARP（便于抓包）      |

节点从其运行时目录执行指向镜像的符号链接；入口程序通过 `realpath` 解析该链接以找到包。`netio_sim/` 下的改动会在节点下一次启动时生效——正在运行的节点继续使用其启动时的代码。
