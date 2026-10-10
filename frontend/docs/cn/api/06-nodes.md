[← API 参考](./index.md)

# 节点

所有节点接口都位于 `/v1/labs/:labId/nodes` 下。

## `POST /v1/labs/:labId/nodes/start`

启动 Lab 中的所有节点。

**响应 `200`**

```json
{ "ok": true, "data": { "started": 2 }, "meta": { "changed": true } }
```

如果所有节点都已在运行，`meta.changed` 为 `false`。

**错误码**

| 错误码                   | 状态码 | 说明                                                                            |
| ------------------------ | ------ | ------------------------------------------------------------------------------- |
| `LAB_NOT_LOADED`         | 409    | Lab 尚未加载                                                                    |
| `INVALID_LAB_SPEC`       | 400    | 节点配置有误——（ioulive86）缺少 `runtime.interface` 或其无效，或端口数量不正确；（container）缺少镜像或 `runtime` 无效 |
| `INTERFACE_NOT_FOUND`    | 400    | （ioulive86）绑定的主机接口在服务器上不存在                                     |
| `IOULIVE86_NOT_FOUND`    | 500    | （ioulive86）服务器上缺少桥接程序                                               |
| `IOULIVE86_START_FAILED` | 500    | （ioulive86）桥接进程启动时退出（例如未配置免密 sudo）                          |
| `CONTAINER_RUN_FAILED`   | 500    | （container）`podman run` 执行失败（例如镜像或运行参数有误）                    |
| `CONTAINER_NOT_FOUND` / `CONTAINER_NOT_RUNNING` | 500 | （container）无法 inspect 该容器，或容器未在运行                   |
| `VETH_ATTACH_FAILED` / `VETH_PAIR_FAILED` | 500 | （container）netns 辅助程序未能建立 veth 链路（例如未配置免密 sudo）      |

ioulive86 和 container 相关的错误码仅在 Lab 包含对应类型的节点时出现；两者都需要一次性配置免密 sudo 规则——参见[安装指南](../guide/07-installation.md#5-ioulive86-物理网络桥接)（ioulive86）和[第 6 节](../guide/07-installation.md#6-容器节点podman)（container）。

---

## `POST /v1/labs/:labId/nodes/stop`

停止 Lab 中的所有节点。

**响应 `200`**

```json
{ "ok": true, "data": { "stopped": 2 }, "meta": { "changed": true } }
```

---

## `GET /v1/labs/:labId/nodes/:nodeId`

获取单个节点的运行状态。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "node": {
      "id": "...",
      "name": "r1",
      "instance_id": 3,
      "console_port": 20003,
      "status": "running"
    }
  }
}
```

**错误码**

| 错误码           | 状态码 | 说明                          |
| ---------------- | ------ | ----------------------------- |
| `NODE_NOT_FOUND` | 404    | Lab 规格中不存在该节点 ID     |
| `LAB_NOT_LOADED` | 409    | Lab 尚未加载                  |

---

## `POST /v1/labs/:labId/nodes/:nodeId/start`

启动单个节点。

**响应 `200`**

```json
{ "ok": true, "data": { "status": "running" }, "meta": { "changed": true } }
```

**错误码**

| 错误码                   | 状态码 | 说明                                                                            |
| ------------------------ | ------ | ------------------------------------------------------------------------------- |
| `NODE_NOT_FOUND`         | 404    | Lab 规格中不存在该节点 ID                                                       |
| `LAB_NOT_LOADED`         | 409    | Lab 尚未加载                                                                    |
| `INVALID_LAB_SPEC`       | 400    | 节点配置有误——（ioulive86）缺少 `runtime.interface` 或其无效，或端口数量不正确；（container）缺少镜像或 `runtime` 无效 |
| `INTERFACE_NOT_FOUND`    | 400    | （ioulive86）绑定的主机接口在服务器上不存在                                     |
| `IOULIVE86_NOT_FOUND`    | 500    | （ioulive86）服务器上缺少桥接程序                                               |
| `IOULIVE86_START_FAILED` | 500    | （ioulive86）桥接进程启动时退出（例如未配置免密 sudo）                          |
| `CONTAINER_RUN_FAILED`   | 500    | （container）`podman run` 执行失败（例如镜像或运行参数有误）                    |
| `CONTAINER_NOT_FOUND` / `CONTAINER_NOT_RUNNING` | 500 | （container）无法 inspect 该容器，或容器未在运行                   |
| `VETH_ATTACH_FAILED` / `VETH_PAIR_FAILED` | 500 | （container）netns 辅助程序未能建立 veth 链路（例如未配置免密 sudo）      |

---

## `POST /v1/labs/:labId/nodes/:nodeId/stop`

停止单个节点。

**响应 `200`**

```json
{ "ok": true, "data": { "status": "stopped" }, "meta": { "changed": true } }
```

---

## `POST /v1/labs/:labId/nodes/:nodeId/reset`

向节点的控制台包装进程发送 SIGHUP，强制建立新的控制台连接，而不重启节点进程。

**响应 `200`**

```json
{ "ok": true, "data": { "status": "reset" }, "meta": { "changed": true } }
```

如果节点未在运行，`data.status` 为 `"stopped"`，`meta.changed` 为 `false`。

---

## `POST /v1/labs/:labId/nodes/:nodeId/wipe`

删除容器节点的[每节点卷](../guide/02-topo-editor.md#每节点卷)（所有带有该 Lab 和该节点标签的卷），使其下次启动时从镜像默认状态开始。

**响应 `200`**

```json
{ "ok": true, "data": { "volumes": 1 }, "meta": { "changed": true } }
```

`data.volumes` 是被删除的卷数量；没有卷时 `meta.changed` 为 `false`。

**错误码**

| 错误码            | 状态码 | 说明                                     |
| ----------------- | ------ | ---------------------------------------- |
| `NODE_NOT_FOUND`  | 404    | Lab 中不存在该 ID 的节点                 |
| `NOT_A_CONTAINER` | 400    | 该节点不是容器节点                       |
| `LAB_NOT_LOADED`  | 409    | Lab 未加载                               |
| `NODE_RUNNING`    | 409    | 节点正在运行；请先停止                   |

---

## `WS /v1/labs/:labId/nodes/:nodeId/console`

WebSocket 控制台代理。将客户端直接连接到节点的 telnet 控制台端口。

- **客户端 → 服务器**：原始字节，转发到节点的 stdin
- **服务器 → 客户端**：来自节点 stdout 的原始字节

如果 Lab 未加载或节点进程退出，连接会自动关闭。
