# 抓包

NLC 支持在 Lab 拓扑中的链路上进行实时抓包（容器链路除外）。抓取的流量可以直接在浏览器中查看，也可以流式传输到外部 Wireshark 实例。

## 工作原理

NLC 在 **netio** 层拦截流量，netio 是 IOU/IOL 节点之间交换帧所用的 Unix 数据报套接字。在某条链路上开始抓包时，NLC 会在两个端点之间插入一个透明代理。经过的每一帧都会被复制一份并转发到抓包流中，而不会影响 Lab 流量。

由于这种方式工作在接口层之下，它适用于所有 netio 链路，包括串行（HDLC、PPP、Frame Relay）链路和 Ethernet 链路。连接容器的链路是内核 veth，不经过 netio，不支持抓包。

## 开始抓包

1. 打开 Lab 的拓扑查看器。
2. 点击画布中的一条**链路**（边）。左侧的概览面板会切换到抓包模式。
3. 如果该链路属于**多链路**（multilink）捆绑，使用链路选择按钮选择要抓包的具体链路。
4. 选择与该链路匹配的**封装**类型：
   - **Ethernet**——用于 L2 Ethernet 链路（默认）
   - **PPP**——用于 PPP 串行链路
   - **HDLC**——用于 HDLC 串行链路
   - **Frame Relay**——用于 Frame Relay 链路
5. 点击 **开始抓包**（Start Capture）。

抓包会话会被分配一个 ID 和一个 TCP 端口。多个抓包可以同时在相同或不同的链路上运行。

## 查看抓包

### 浏览器内查看器（推荐）

点击任意活动抓包旁的 **查看**（View）按钮（位于概览面板或抓包标签页中）。这会打开一个专用的抓包查看器页面，界面类似 Wireshark：

- **数据包列表**——显示帧编号、时间戳、源、目的、协议、长度和信息，并使用 Wireshark 的配色规则。
- **协议树**——点击任意一行即可展开完整的解析树，与 Wireshark 的中间窗格相同。
- **十六进制转储**——原始字节显示在协议树旁边。
- **显示过滤器**——输入 Wireshark 显示过滤器表达式（例如 `tcp`、`ip.addr == 10.0.0.1`、`ospf`），按 Enter 或点击 **应用**（Apply）即可过滤数据包列表。

查看器通过 WebSocket 连接并实时接收数据包。数据包在服务器端由 **sharkd**（Wireshark 守护进程）解析，因此所有 Wireshark 解析器均可使用。

### 通过 TCP 流使用外部 Wireshark

每个抓包还会开放一个原始 pcap TCP 流，可以直接通过管道传给 Wireshark。将 `<BACKEND_IP>` 替换为 NLC 后端主机的 IP 地址，将 `<PORT>` 替换为抓包面板中显示的端口。

**Windows（WSL——推荐）**

```bash
wsl nc <BACKEND_IP> <PORT> | "C:\Program Files\Wireshark\Wireshark.exe" -k -i -
```

**Windows（ncat）**

```bash
ncat -v <BACKEND_IP> <PORT> | "C:\Program Files\Wireshark\Wireshark.exe" -k -i -
```

**macOS / Linux**

```bash
nc <BACKEND_IP> <PORT> | wireshark -k -i -
```

> 该 TCP 流采用标准 pcap 格式。同一个抓包端口同一时间只允许一个外部客户端连接。如需同时查看，请使用浏览器内查看器。

## 管理抓包

拓扑查看器中的 **抓包**（Captures）标签页列出当前 Lab 的所有活动抓包。在这里可以：

- **查看**——打开该抓包的浏览器内查看器。
- **停止**（Stop）——终止抓包并释放端口。

选中某条链路时，概览面板中也会列出抓包，但只显示该链路上的抓包。

## 停止抓包

在概览面板或抓包标签页中，点击抓包旁的 **停止**。TCP 端口会被释放，抓包会话被销毁。任何已打开的浏览器内查看器都会自动断开连接。

在以下情况下，抓包也会自动停止：

- Lab 被**卸载**。
- 链路所涉及的某个**节点**被停止。

## 封装参考

| 封装        | DLT 值 | 典型用途                        |
| ----------- | ------ | ------------------------------- |
| Ethernet    | 1      | L2 Ethernet，大多数链路的默认值 |
| PPP         | 9      | PPP 串行链路                    |
| HDLC        | 104    | Cisco HDLC 串行链路             |
| Frame Relay | 107    | Frame Relay 串行链路            |

选择错误的封装会导致 Wireshark 错误解析帧。如果不确定，请在节点上检查接口封装（`show interface`）。
