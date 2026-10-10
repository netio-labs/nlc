[← API 参考](./index.md)

# Lab

## `GET /v1/labs`

分页列出 Lab。

**查询参数**

| 参数      | 类型     | 默认值   | 说明                                                                   |
| --------- | -------- | -------- | ---------------------------------------------------------------------- |
| `limit`   | `number` | `10`     | 最多返回的条目数                                                       |
| `offset`  | `number` | `0`      | 跳过的条目数                                                           |
| `view`    | `string` | `update` | 排序方式：`update`（最近更新）或 `create`（最近创建）                  |

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "labs": [
      {
        "id": "0aab910b-991a-434c-89fc-2c866facdd4f",
        "name": "My Lab",
        "description": "optional description",
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000
      }
    ],
    "total": 42
  }
}
```

---

## `GET /v1/labs/active`

列出当前至少有一个节点在运行的所有 Lab。响应在请求时通过探测每个已分配的控制台端口实时计算——不维护任何后台状态。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "labs": [
      {
        "id": "0aab910b-991a-434c-89fc-2c866facdd4f",
        "name": "My Lab",
        "description": "optional description",
        "updatedAt": 1700000000000,
        "runningNodes": 2,
        "totalNodes": 3
      }
    ]
  }
}
```

`runningNodes` 是控制台端口当前处于监听状态的节点数。`totalNodes` 是该 Lab 已分配的实例数。`runningNodes === 0` 的 Lab 不会出现在结果中。

---

## `POST /v1/labs`

根据 Lab 规格文档创建新 Lab。

**请求体**——完整的 Lab 规格 JSON（参见 [Lab 规格](./08-lab-spec.md)）。

**响应 `201`**

```json
{
  "ok": true,
  "data": { "created": true, "labId": "...", "path": "..." }
}
```

**错误码**

| 错误码               | 状态码 | 说明                                        |
| -------------------- | ------ | ------------------------------------------- |
| `INVALID_LAB_SPEC`   | 400    | 规格校验失败                                |
| `LAB_ALREADY_EXISTS` | 409    | 已存在相同 `lab.id` 的 Lab                  |

---

## `GET /v1/labs/:labId`

获取 Lab 信息及所有节点的当前运行状态。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "lab": { "id": "...", "name": "My Lab", "description": "" },
    "nodes": [
      {
        "id": "22222222-2222-4222-8222-222222222226",
        "name": "r1",
        "instance_id": 3,
        "console_port": 20003,
        "status": "running"
      }
    ]
  }
}
```

Lab 未加载时，`instance_id` 和 `console_port` 为 `null`。`status` 为 `"running"` 或 `"stopped"`。

---

## `GET /v1/labs/:labId/spec`

获取 Lab 的完整拓扑规格。

**响应 `200`**

```json
{
  "ok": true,
  "data": { "spec": { ... } }
}
```

`spec` 对象是完整的 Lab 规格文档（参见 [Lab 规格](./08-lab-spec.md)）。

---

## `PUT /v1/labs/:labId`

替换 Lab 规格。`body.lab.id` 必须与路径中的 `labId` 相同。

**请求体**——完整的 Lab 规格 JSON。

**响应 `200`**

```json
{
  "ok": true,
  "data": { "updated": true, "labId": "...", "path": "...", "message": "..." }
}
```

**错误码**

| 错误码             | 状态码 | 说明                                      |
| ------------------ | ------ | ----------------------------------------- |
| `INVALID_LAB_SPEC` | 400    | 规格校验失败                              |
| `LAB_ID_MISMATCH`  | 400    | `body.lab.id` 与路径中的 `labId` 不一致   |
| `LAB_NOT_FOUND`    | 404    | Lab 不存在                                |

---

## `DELETE /v1/labs/:labId`

删除 Lab。必须先卸载该 Lab。其已保存的[配置](./09-configs.md)也会一并删除。

**响应 `200`**

```json
{
  "ok": true,
  "data": { "deleted": true, "labId": "...", "path": "..." }
}
```

**错误码**

| 错误码          | 状态码 | 说明                                            |
| --------------- | ------ | ----------------------------------------------- |
| `LAB_LOADED`    | 409    | Lab 仍有已分配的实例；请先卸载                  |
| `LAB_NOT_FOUND` | 404    | Lab 不存在                                      |

---

## `POST /v1/labs/:labId/duplicate`

复制 Lab。所有标识符（Lab ID、节点 ID、链路 ID）都会替换为新生成的 UUID。复制出的 Lab 名称会追加 ` duplicated`。已保存的[配置](./09-configs.md)和 `current` 标记也会一并复制（设备名称不变，因此可以直接用于替换）。

**响应 `201`**

```json
{
  "ok": true,
  "data": { "duplicated": true, "labId": "...", "path": "..." }
}
```

**错误码**

| 错误码          | 状态码 | 说明               |
| --------------- | ------ | ------------------ |
| `LAB_NOT_FOUND` | 404    | Lab 不存在         |

---

## `POST /v1/labs/import`

从导出的 Lab 规格文档导入 Lab。与 `duplicate` 相同，所有标识符（Lab ID、节点 ID、链路 ID，以及它们在 `ui.nodes`/`ui.edges` 中的引用）都会替换为新生成的 UUID，以避免与现有 Lab 冲突。与 `duplicate` 不同的是，原有的 `lab.name`/`description` 保持不变（不追加 `" duplicated"` 后缀），并且不会带上已保存的配置——配置需通过 [`POST /v1/labs/:labId/configs/import`](./09-configs.md) 单独导入。

**请求体**——完整的 Lab 规格 JSON（参见 [Lab 规格](./08-lab-spec.md)），通常是通过前端“导出（Export）”按钮下载的文件。

**响应 `201`**

```json
{
  "ok": true,
  "data": { "imported": true, "labId": "...", "path": "..." }
}
```

**错误码**

| 错误码             | 状态码 | 说明                     |
| ------------------ | ------ | ------------------------ |
| `INVALID_LAB_SPEC` | 400    | 规格校验失败             |

---

## `POST /v1/labs/:labId/load`

为所有节点分配实例 ID，创建运行时目录，并写入 netmap 文件。该操作是幂等的——已有的分配和运行时文件（包括 nvram）会被保留。

**响应 `200`**

```json
{ "ok": true, "data": { "loaded": true } }
```

**错误码**

| 错误码                | 状态码 | 说明                          |
| --------------------- | ------ | ----------------------------- |
| `NO_FREE_INSTANCE_ID` | 409    | 实例 ID 池已耗尽              |

---

## `POST /v1/labs/:labId/unload`

停止所有运行中的节点，停止所有抓包，释放实例 ID，并删除运行时目录（包括 nvram）以及该 Lab 的每节点容器卷（`{{volume:<name>}}`）。已保存的[配置](./09-configs.md)会保留。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "unloaded": true,
    "capturesCleaned": true,
    "runtimeRemoved": true,
    "runtimePath": "...",
    "releasedInstanceIds": 2,
    "stoppedNodes": 2
  }
}
```
