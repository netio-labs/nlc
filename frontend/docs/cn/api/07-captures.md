[← API 参考](./index.md)

# 抓包

所有抓包接口都位于 `/v1/labs/:labId/captures` 下。

## `GET /v1/labs/:labId/captures`

列出 Lab 中所有进行中的抓包。

**查询参数**

| 参数      | 类型                | 说明              |
| --------- | ------------------- | ----------------- |
| `linkId`  | `string`（可选）    | 按链路 ID 过滤    |

**响应 `200`**

```json
{
  "ok": true,
  "data": [
    {
      "captureId": 1,
      "linkId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
      "dlt": 1,
      "captureUrl": "tcp://0.0.0.0:30001"
    }
  ]
}
```

---

## `POST /v1/labs/:labId/captures`

在一条链路上启动抓包。

**请求体**

```json
{
  "linkId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  "encap": "ethernet"
}
```

`encap` 默认为 `"ethernet"`。可选值：`ethernet`、`ppp`、`hdlc`、`framrelay`。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "captureId": 1,
    "linkId": "...",
    "dlt": 1,
    "captureUrl": "tcp://0.0.0.0:30001"
  }
}
```

可以通过 `nc` 或 `ncat` 连接 `captureUrl` 中的端口，将原始 pcap 流导入 Wireshark。

**错误码**

| 错误码                 | 状态码 | 说明                              |
| ---------------------- | ------ | --------------------------------- |
| `INVALID_LINK_ID`      | 400    | 缺少 `linkId`                     |
| `CAPTURE_START_FAILED` | 409    | 抓包代理启动失败                  |

---

## `GET /v1/labs/:labId/captures/:captureId`

按 ID 获取单个抓包。

**响应 `200`**

```json
{
  "ok": true,
  "data": {
    "captureId": 1,
    "linkId": "...",
    "dlt": 1,
    "captureUrl": "tcp://0.0.0.0:30001"
  }
}
```

**错误码**

| 错误码              | 状态码 | 说明                    |
| ------------------- | ------ | ----------------------- |
| `CAPTURE_NOT_FOUND` | 404    | 不存在该 ID 的抓包      |

---

## `POST /v1/labs/:labId/captures/:captureId/stop`

停止抓包并释放其 TCP 端口。

**响应 `200`**

```json
{ "ok": true, "data": { "stopped": true } }
```

**错误码**

| 错误码              | 状态码 | 说明                    |
| ------------------- | ------ | ----------------------- |
| `CAPTURE_NOT_FOUND` | 404    | 不存在该 ID 的抓包      |

---

## `POST /v1/labs/:labId/captures/cleanup`

停止 Lab 中所有进行中的抓包。

**响应 `200`**

```json
{ "ok": true, "data": { "cleaned": true } }
```

---

## `WS /v1/labs/:labId/captures/:captureId/stream`

用于实时推送已解析数据包的 WebSocket 数据流（基于 sharkd）。

**服务器 → 客户端消息**

```json
{ "type": "frame", "data": { "num": 1, "timestamp": 1.234, "src": "10.0.0.1", "dst": "10.0.0.2", "protocol": "OSPF", "length": 60, "info": "Hello Packet" } }
{ "type": "frame_detail", "frameNum": 1, "tree": [ ... ], "hex": "..." }
{ "type": "clear" }
```

**客户端 → 服务器消息**

```json
{ "type": "frame_detail", "frameNum": 1 }
{ "type": "filter", "expr": "ospf" }
```

发送 `filter` 会清空当前数据包列表（服务器发送 `{ "type": "clear" }`），并将该 Wireshark 显示过滤表达式应用于后续帧。
