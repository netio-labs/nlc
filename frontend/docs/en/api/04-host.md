[← API Reference](./index.md)

# Host

## `GET /v1/host/interfaces`

List the physical (Ethernet) network interfaces on the server. Used to populate the **Interface** dropdown for IOULive86 Bridge nodes.

**Response `200`**

```json
{
  "ok": true,
  "data": {
    "interfaces": [
      { "name": "eth0", "operstate": "UP", "address": "00:15:5d:54:8d:27", "mtu": 1500 }
    ]
  }
}
```

Only interfaces whose link type is Ethernet are returned; `lo` and non-Ethernet links are omitted. `address` is the MAC address (`null` if unavailable) and `mtu` may be `null`. The list reflects the server's interfaces at request time; the frontend keeps a previously saved interface selectable even if it is no longer present.

The endpoint returns `500` in the rare case the server cannot enumerate interfaces (the underlying `ip link show` failed).

## `WS /v1/host/shell`

Browser SSH terminal into the **backend host itself** (see the [Settings](../guide/06-settings.md#shell) guide). A WebSocket that proxies raw terminal bytes between the browser and a system `ssh` client running on a pty; authentication is performed by the host's `sshd` via the ssh client's own password prompt — NLC never sees the credentials.

**Query parameters**

| Param | Description |
|---|---|
| `session` | Client-generated session id (`[A-Za-z0-9-]{8,64}`). Reconnecting with the same id re-attaches to the live session and replays its recent output. |
| `user` | Login username on the backend host (`[A-Za-z0-9][A-Za-z0-9._-]{0,31}`). |

The target host is fixed to `localhost` server-side and cannot be set by the client, so the backend can never act as an SSH jump box. The session persists across disconnects and is reaped after 30 minutes with no client. A second client for a live session is rejected (close code `1008`, "session busy"); an invalid `user`/`session` also closes with `1008`.
