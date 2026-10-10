[← API 参考](./index.md)

# Lab 规格

Lab 规格（Lab Spec）是定义 Lab 拓扑的 JSON 文档，用于 `POST /v1/labs` 和 `PUT /v1/labs/:labId`。

```json
{
  "lab": {
    "id": "0aab910b-991a-434c-89fc-2c866facdd4f",
    "name": "My Lab",
    "description": "optional"
  },
  "nodes": [
    {
      "type": "iou",
      "id": "22222222-2222-4222-8222-222222222226",
      "name": "r1",
      "vendor": "cisco",
      "profile": "iouRouter",
      "image": "I86BI_LINUX_L2-FAKE-M-15.0.py",
      "runtime": { "ram": 256, "nvram": 64 },
      "interfaces": [
        { "family": "ethernet", "uiPrefix": "e", "slotCount": 2, "portsPerSlot": 4 },
        { "family": "serial", "uiPrefix": "s", "slotCount": 2, "portsPerSlot": 4 }
      ]
    }
  ],
  "links": [
    {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      "source": "22222222-2222-4222-8222-222222222226",
      "target": "33333333-3333-4333-8333-333333333336",
      "endpoints": [
        { "family": "ethernet", "slot": 0, "port": 0 },
        { "family": "ethernet", "slot": 0, "port": 0 }
      ],
      "description": "r1 e0/0 <-> r2 e0/0"
    }
  ]
}
```

**`type`** 表示模拟器后端：`iou`（Cisco IOU 路由器/交换机，以及 Virtual PC）、`ioulive86`（物理接口桥接）或 `container`（Podman 容器，以 root 运行）。

**IOULive86 Bridge** 节点使用 `type: "ioulive86"`，并通过 `runtime.interface` 指定要桥接的主机网卡（取自 `GET /v1/host/interfaces`）。将 `interface` 设为 `"auto"` 时桥接的是一个相连的容器，而不是物理网卡。其端口数量取决于模式：桥接主机网卡时为一个以太网端口（`portsPerSlot` 1），`auto` 模式下为两个（`portsPerSlot` 2）。端口 0 始终是 `netio` 一侧（连接 IOU / Virtual PC 节点）；端口 1 仅在 `auto` 模式下存在，是连接容器的 `veth` 链路：

```json
{
  "type": "ioulive86",
  "id": "6d1e0b2a-3333-4b1b-8a1a-000000000002",
  "name": "lan1",
  "vendor": "nlc",
  "profile": "ioulive86",
  "image": "ioulive86",
  "runtime": { "interface": "eth0" },
  "interfaces": [
    { "family": "ethernet", "uiPrefix": "e", "slotCount": 1, "portsPerSlot": 1 }
  ]
}
```

**容器（Container）** 节点使用 `type: "container"`，至少有一个以太网端口，`image` 设为容器镜像引用（取自 `GET /v1/image/container`），并可带一个可选的 `runtime` 对象：

```json
{
  "type": "container",
  "id": "6d1e0b2a-5555-4b1b-8a1a-000000000005",
  "name": "c1",
  "vendor": "nlc",
  "profile": "container",
  "image": "docker.io/library/alpine:latest",
  "runtime": {
    "command": ["sleep", "infinity"],
    "runArgs": ["--privileged", "-v", "myvol:/config"],
    "addresses": [
      { "port": 0, "address": "10.1.1.2", "prefix": 24, "gateway": "10.1.1.1" }
    ]
  },
  "interfaces": [
    { "family": "ethernet", "uiPrefix": "eth", "slotCount": 1, "portsPerSlot": 1 }
  ]
}
```

容器 `runtime` 字段（均为可选）：**`command`**——在容器内运行的 argv，位于镜像之后（为空或缺省时使用镜像的 entrypoint）；**`runArgs`**——位于镜像之前的 `podman run` 参数（不要包含 `--network`，它由 NLC 管理）；`{{volume:<name>}}` 会展开为每节点卷 `nlc-<node id>-<name>`（这是唯一支持的占位符；`{{ }}` 中的其他任何内容都会以 `INVALID_LAB_SPEC` 拒绝），该卷在停止/启动之间保留，在卸载时或通过[清空数据（Wipe Data）](./06-nodes.md#post-v1labslabidnodesnodeidwipe)删除；**`shell`**——控制台在容器内运行的命令，可带参数（默认 `/bin/sh`）；**`addresses`**——按端口的 IPv4 配置，每项为 `{ port, address, prefix, gateway? }`，在链路建立时于容器内应用；**`catalog`**——`command` / `runArgs` / `shell` 所复制自的[容器支持库](../guide/02-topo-editor.md#容器支持库)条目（编辑器记录用，后端忽略）。

**`profile`** 决定镜像以及适用哪些 `runtime` 字段：

| Profile     | `type`      | 镜像                           | Runtime 字段                       |
| ----------- | ----------- | ------------------------------ | ---------------------------------- |
| `iouRouter` | `iou`       | 文件名前缀 `I86BI_LINUX`         | `ram`、`nvram`                     |
| `iouSwitch` | `iou`       | 文件名前缀 `I86BI_LINUX_L2`      | `ram`、`nvram`                     |
| `vpc`       | `iou`       | 固定为 `NETIO_VIRTUAL_PC`        | 无                                 |
| `ioulive86` | `ioulive86` | 固定为 `ioulive86`               | `interface`（必填；`auto` 表示桥接容器） |
| `container` | `container` | 容器镜像引用                     | `command`、`runArgs`、`shell`、`addresses`、`catalog`（均为可选） |

IOU 的 `runtime.ram` 单位为 MB，`runtime.nvram` 单位为 KB。后端按给定值使用（仅在字段缺省时回退为 256 / 64）；按镜像区分的默认值——`.bin`（经典 IOU）为 256 MB，`.iol`（IOL 17.x）为 512 MB——由拓扑编辑器应用，参见 [IOU 镜像与默认 RAM](../guide/02-topo-editor.md#iou-镜像与默认-ram)。

Virtual PC 节点始终只有一个以太网端口（`slotCount` 1，`portsPerSlot` 1），没有串口；IOULive86 节点有一个端口，`auto` 模式下有两个。容器节点有一个或多个以太网端口，没有串口。

## 链路类型

链路有一个可选的 **`kind`** 字段，默认为 `"netio"`。两种类型的 `endpoints` 结构相同——均为 `linkEndpoint` 对象（`{ family, slot, port }`）：

- **`netio`**（默认）——IOU / Virtual PC / IOULive86 端口之间的标准链路。
- **`veth`**——任何连接到**容器**节点的链路都会自动使用该类型。它实现为内核中直连的 `veth` 对（容器 ↔ 容器，或容器 ↔ IOULive86 `auto` 节点）。veth 链路的端点始终使用 `family: "ethernet"` 和 `slot: 0`，只有 `port` 不同。哪些链路必须是 `veth`（即连接容器的链路）由代码强制约束，而非 schema。在 IOULive86 节点上，`netio` 链路必须使用端口 0，`veth` 链路必须使用端口 1；不符合的规格会以 `INVALID_LAB_SPEC` 拒绝。

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
  "kind": "veth",
  "source": "6d1e0b2a-5555-4b1b-8a1a-000000000005",
  "target": "6d1e0b2a-5555-4b1b-8a1a-000000000006",
  "endpoints": [
    { "family": "ethernet", "slot": 0, "port": 0 },
    { "family": "ethernet", "slot": 0, "port": 0 }
  ],
  "description": "c1 eth0 <-> c2 eth0"
}
```
