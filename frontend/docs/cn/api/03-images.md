[← API 参考](./index.md)

# 镜像

## `GET /v1/image/iou`

列出可用镜像。

**查询参数**

| 参数      | 类型                | 说明                                                               |
| --------- | ------------------- | ------------------------------------------------------------------ |
| `profile` | `string`（可选）    | 按 Profile 过滤，取值 `iouRouter` 或 `iouSwitch`。省略则返回全部。 |

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "profile": "iouRouter",
    "images": ["I86BI_LINUX_L2-FAKE-M-15.0.py"]
  }
}
```

**错误码**

| 错误码            | 状态码 | 说明                                        |
| ----------------- | ------ | ------------------------------------------- |
| `INVALID_PROFILE` | 400    | `profile` 不是 `iouRouter` 或 `iouSwitch`   |

---

## `GET /v1/image/container`

列出服务器上可用的容器镜像，以及每个镜像所匹配的[容器支持库](../guide/02-topo-editor.md#容器支持库)条目。用于填充容器节点的 **容器镜像（Container image）** 下拉框。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "images": [
      { "ref": "docker.io/frrouting/frr:latest", "catalog": { "id": "frr", "label": "FRRouting" } },
      { "ref": "docker.io/library/alpine:latest", "catalog": { "id": "default", "label": "Default" } }
    ]
  }
}
```

镜像读取自 `sudo podman image ls`（root 的镜像存储）（`<repository>:<tag>`），经过去重和排序，未打标签（`<none>`）的镜像会被忽略。如果未安装 Podman 或没有任何镜像，`images` 为空数组。只返回匹配条目的 `id` 和 `label`；其参数请通过下面的接口获取。

**错误码**

| 错误码                      | 状态码 | 说明                                                            |
| --------------------------- | ------ | --------------------------------------------------------------- |
| `CONTAINER_CATALOG_INVALID` | 500    | `catalog/container.json` 无法读取或格式错误；错误信息会指明出错的条目和字段 |

---

## `GET /v1/image/container/catalog/:id`

获取单个容器支持库条目的运行参数。在拓扑编辑器中选择镜像时，编辑器会将这些参数复制到节点的 `runtime` 中。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "id": "frr",
    "label": "FRRouting",
    "command": ["/usr/lib/frr/watchfrr", "zebra", "staticd", "bgpd", "ospfd", "ospf6d", "isisd", "ripd", "bfdd"],
    "runArgs": ["--privileged", "-v", "{{volume:config}}:/etc/frr"],
    "shell": "vtysh",
    "notes": "/etc/frr is kept in a per-node volume, so write memory survives a restart."
  }
}
```

条目未设置 `command`、`runArgs`、`shell` 和 `notes` 时，这些字段会被省略（分别对应镜像 entrypoint / 无额外参数 / `/bin/sh`）。

**错误码**

| 错误码                      | 状态码 | 说明                                          |
| --------------------------- | ------ | --------------------------------------------- |
| `CATALOG_ENTRY_NOT_FOUND`   | 404    | 不存在该 `id` 的条目                          |
| `CONTAINER_CATALOG_INVALID` | 500    | `catalog/container.json` 无法读取或格式错误   |

---

## `POST /v1/image/iou`

上传镜像文件。

**请求** `multipart/form-data`——包含一个名为 `file` 的字段。文件名必须以 `I86BI_LINUX`（路由器）或 `I86BI_LINUX_L2`（交换机）开头。

**响应 `201`**

```json
{
  "ok": true,
  "data": {
    "uploaded": true,
    "image": "I86BI_LINUX_L2-FAKE-M-15.0.py",
    "size": 104857600,
    "path": "/opt/nlc/backend/addons/iou/I86BI_LINUX_L2-FAKE-M-15.0.py"
  }
}
```

**错误码**

| 错误码                 | 状态码 | 说明                                    |
| ---------------------- | ------ | --------------------------------------- |
| `INVALID_UPLOAD`       | 400    | 请求不是 `multipart/form-data`          |
| `FILE_REQUIRED`        | 400    | 请求中没有文件部分                      |
| `INVALID_IMAGE_NAME`   | 400    | 文件名不符合要求的前缀                  |
| `IMAGE_ALREADY_EXISTS` | 409    | 同名文件已存在                          |

---

## `DELETE /v1/image/iou/:imageName`

按文件名删除镜像。

**响应 `200`**

```json
{
  "ok": true,
  "data": { "deleted": true, "image": "I86BI_LINUX_L2-FAKE-M-15.0.py", "path": "..." }
}
```

**错误码**

| 错误码               | 状态码 | 说明                                    |
| -------------------- | ------ | --------------------------------------- |
| `INVALID_IMAGE_NAME` | 400    | 文件名不符合要求的前缀                  |
| `IMAGE_NOT_FOUND`    | 404    | 文件不存在                              |

---

## `GET /v1/image/iou/key`

获取当前的 IOU/IOL 密钥（`iourc` 文件）。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "hostname": "myhost",
    "key": "12345678abcdef"
  }
}
```

如果 `iourc` 文件尚不存在，`key` 为 `null`。

---

## `PUT /v1/image/iou/key`

将新的 IOU/IOL 密钥写入 `iourc`。后端主机名会自动检测。

**请求体**

```json
{ "key": "12345678abcdef" }
```

**响应 `200`**

```json
{
  "ok": true,
  "data": { "hostname": "myhost", "key": "12345678abcdef" }
}
```

**错误码**

| 错误码        | 状态码 | 说明                                    |
| ------------- | ------ | --------------------------------------- |
| `INVALID_KEY` | 400    | 缺少 `key` 或其中包含空白字符           |
