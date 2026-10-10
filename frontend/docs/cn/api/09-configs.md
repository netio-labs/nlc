[← API 参考](./index.md)

# 配置

Lab 中已保存的设备配置。一个**配置**是一份 Markdown 文档，按设备名称保存每台设备的启动配置，并以**名称**标识（在 Lab 内唯一）；下载和上传的也是同一份文档。配置存放在 `backend/configurations/<labId>/<name>.md`——位于 Lab 规格之外——因此在卸载（Unload）后依然保留，保存拓扑时也不会被改动。

只有 IOU 设备（其 nvram）和 Virtual PC（其 `startup.cfg`）参与其中；IOULive86 和容器节点会被忽略。

## 配置文档

````markdown
# lesson 3

- Lab: OSPF lab
- Saved: 2026-09-29 10:15:00

## r1

- Type: iouRouter

```text
!
hostname r1
banner motd ^CAuthorized only^C
...
```

## pc1

- Type: vpc

```text
hostname pc1
ip address dhcp
```
````

- 每个 `## <device name>` 小节对应一台设备；其下的**第一个**围栏代码块就是该设备的配置。其余内容（`- Type:` 行除外）NLC 都会忽略并原样保留，因此文件中可以附带注释或实验说明。
- `Type` 是节点的 Profile（`iouRouter`、`iouSwitch`、`vpc`）；与 Lab 中的设备不一致时会给出报告，但不会导致失败。
- **空**代码块表示“该设备应为空白配置”：替换时会清除其配置。
- Banner 分隔符在 IOS 中以控制字符 `0x03` 存储，在文档中显示为 `^C`，写入设备时会转换回去。

## 匹配报告

由导入、预览和编辑操作返回，用于比较文档与 Lab 中的设备：

```json
{
  "matched": [{ "name": "r1", "type": "iouSwitch", "nodeType": "iouRouter", "typeMismatch": true }],
  "notInLab": ["ghost"],
  "notInConfig": ["s1", "r3"],
  "duplicates": ["pc1"]
}
```

| 字段 | 含义 |
|---|---|
| `matched` | 两边都存在的设备。 |
| `notInLab` | Lab 中没有同名设备的小节（会被忽略）。 |
| `notInConfig` | 没有对应小节的 Lab 设备（替换时保持不变）。 |
| `duplicates` | 在 Lab 中被多台设备使用、或在文档中出现在多个小节中的名称——由于目标不明确，会被跳过。 |

---

## `GET /v1/labs/:labId/configs`

列出 Lab 的配置（最新的在前），以及最近一次用于替换设备配置的配置名称（`current`，没有则为 `null`）。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "current": "lesson 3",
    "configs": [{ "name": "lesson 3", "modifiedAt": "2026-09-29T02:15:00.000Z", "devices": 4 }]
  }
}
```

---

## `POST /v1/labs/:labId/configs`

将设备当前的启动配置保存为名为 `name` 的配置。会读取每台 IOU 设备的 nvram 和每台 Virtual PC 的 `startup.cfg`，因此请先在设备上执行 `write memory` / `save`。Lab 必须已加载（节点可以处于运行或停止状态）。

**请求体**

```json
{ "name": "lesson 3", "overwrite": false }
```

`name` 会作为文件名：1–80 个字符，可使用任何语言，不能包含 `/`、`\` 或以点开头；`replace` 和 `import` 为保留名称。

**响应 `201`**

```json
{
  "ok": true,
  "data": {
    "name": "lesson 3",
    "devices": [
      { "name": "r1", "type": "iouRouter", "status": "saved" },
      { "name": "r2", "type": "iouRouter", "status": "empty" }
    ],
    "duplicates": []
  }
}
```

| `status` | 含义 |
|---|---|
| `saved` | 已包含在配置中。 |
| `empty` | 设备上尚未保存任何内容（未执行 `write memory` / `save`）——不包含在内。 |
| `unreadable` | 无法读取 nvram（`detail` 说明原因；校验和不匹配通常意味着读取时设备正在写入——请重试）。 |

`duplicates` 列出被多台设备共用的设备名称；这些设备会被保存，但使用该名称导入或替换时会存在歧义。

---

## `POST /v1/labs/:labId/configs/import`

将上传的 Markdown 文档保存为名为 `name` 的配置（原样保存），并报告其与 Lab 的匹配情况。

**请求体**

```json
{ "name": "lesson 3", "markdown": "# lesson 3\n...", "overwrite": false }
```

**响应 `201`**——`data` 为[匹配报告](#匹配报告)。

---

## `GET /v1/labs/:labId/configs/:name`

**响应 `200`**

```json
{ "ok": true, "data": { "name": "lesson 3", "markdown": "# lesson 3\n...", "report": { "matched": [], "notInLab": [], "notInConfig": [], "duplicates": [] } } }
```

## `PUT /v1/labs/:labId/configs/:name`

替换已有配置的 Markdown 内容（编辑）。请求体：`{ "markdown": "..." }`。返回 `{ "name", "report" }`。

## `DELETE /v1/labs/:labId/configs/:name`

删除配置。设备保留其当前配置；如果该配置是 `current`，`current` 会变为 `null`。

---

## `POST /v1/labs/:labId/configs/replace`

用配置 `name` 中对应的小节替换 Lab 中**已停止**设备的启动配置——与 IOS 的 `configure replace` 类似，每台设备的配置被整体替换而非合并：IOU 的 nvram 会根据配置重新生成，Virtual PC 的 `startup.cfg` 会被覆盖。设备下次启动时从该配置引导，之后其行为与真实硬件一致——`write memory` 会替换它，`erase startup-config` 会让设备变为空白配置。Lab 必须已加载。如果至少有一台设备被写入（或清空），`current` 会被设为 `name`。

**请求体**

```json
{ "name": "lesson 3" }
```

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "name": "lesson 3",
    "devices": [
      { "name": "r1", "type": "iouRouter", "status": "written" },
      { "name": "r2", "type": "iouRouter", "status": "running" }
    ]
  }
}
```


| `status` | 含义 |
|---|---|
| `written` | 配置已写入；如果小节的 `Type` 与设备不一致，则带有 `typeMismatch: true`。 |
| `cleared` | 小节的代码块为空：设备配置已被清除。 |
| `not-in-config` | 该设备没有对应小节：保持不变。 |
| `running` | 设备正在运行：已跳过（停止后再次替换）。 |
| `duplicate` | 名称有歧义：已跳过。 |
| `error` | 无法写入（见 `detail`），例如配置大于设备的 nvram。 |

---

## 错误码

| 错误码 | 状态码 | 说明 |
|---|---|---|
| `LAB_NOT_FOUND` | 404 | Lab 不存在 |
| `INVALID_CONFIG_NAME` | 400 | 名称为空、过长、包含 `/` `\` 或控制字符、以点开头，或为保留名称 |
| `INVALID_BODY` | 400 | 缺少 `markdown` 或其不是字符串 |
| `CONFIG_NOT_FOUND` | 404 | 不存在该名称的配置 |
| `CONFIG_EXISTS` | 409 | 同名配置已存在且 `overwrite` 不为 `true` |
| `LAB_NOT_LOADED` | 409 | 保存 / 替换需要 Lab 已加载 |
| `NO_CONFIG_TO_SAVE` | 422 | 没有任何设备保存了配置（没有内容可放入配置） |
