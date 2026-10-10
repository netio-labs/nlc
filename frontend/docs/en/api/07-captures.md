[← API Reference](./index.md)

# Captures

All capture endpoints are under `/v1/labs/:labId/captures`.

## `GET /v1/labs/:labId/captures`

List all active captures for a lab.

**Query parameters**

| Parameter | Type                | Description       |
| --------- | ------------------- | ----------------- |
| `linkId`  | `string` (optional) | Filter by link ID |

**Response `200`**

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

Start a capture on a link.

**Request body**

```json
{
  "linkId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  "encap": "ethernet"
}
```

`encap` defaults to `"ethernet"`. Valid values: `ethernet`, `ppp`, `hdlc`, `framrelay`.

**Response `200`**

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

The `captureUrl` port can be used to stream raw pcap via `nc` or `ncat` into Wireshark.

**Error codes**

| Code                   | Status | Description                       |
| ---------------------- | ------ | --------------------------------- |
| `INVALID_LINK_ID`      | 400    | `linkId` is missing               |
| `CAPTURE_START_FAILED` | 409    | Failed to start the capture proxy |

---

## `GET /v1/labs/:labId/captures/:captureId`

Get a single capture by ID.

**Response `200`**

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

**Error codes**

| Code                | Status | Description             |
| ------------------- | ------ | ----------------------- |
| `CAPTURE_NOT_FOUND` | 404    | No capture with that ID |

---

## `POST /v1/labs/:labId/captures/:captureId/stop`

Stop a capture and release its TCP port.

**Response `200`**

```json
{ "ok": true, "data": { "stopped": true } }
```

**Error codes**

| Code                | Status | Description             |
| ------------------- | ------ | ----------------------- |
| `CAPTURE_NOT_FOUND` | 404    | No capture with that ID |

---

## `POST /v1/labs/:labId/captures/cleanup`

Stop all active captures for the lab.

**Response `200`**

```json
{ "ok": true, "data": { "cleaned": true } }
```

---

## `WS /v1/labs/:labId/captures/:captureId/stream`

WebSocket stream for real-time dissected packet data (powered by sharkd).

**Server → client messages**

```json
{ "type": "frame", "data": { "num": 1, "timestamp": 1.234, "src": "10.0.0.1", "dst": "10.0.0.2", "protocol": "OSPF", "length": 60, "info": "Hello Packet" } }
{ "type": "frame_detail", "frameNum": 1, "tree": [ ... ], "hex": "..." }
{ "type": "clear" }
```

**Client → server messages**

```json
{ "type": "frame_detail", "frameNum": 1 }
{ "type": "filter", "expr": "ospf" }
```

Sending `filter` clears the current packet list (server sends `{ "type": "clear" }`) and applies the Wireshark display filter expression to subsequent frames.

