[← API Reference](./index.md)

# Nodes

All node endpoints are under `/v1/labs/:labId/nodes`.

## `POST /v1/labs/:labId/nodes/start`

Start all nodes in the lab.

**Response `200`**

```json
{ "ok": true, "data": { "started": 2 }, "meta": { "changed": true } }
```

`meta.changed` is `false` if all nodes were already running.

**Error codes**

| Code                     | Status | Description                                                                     |
| ------------------------ | ------ | ------------------------------------------------------------------------------- |
| `LAB_NOT_LOADED`         | 409    | Lab has not been loaded                                                         |
| `INVALID_LAB_SPEC`       | 400    | node misconfigured — (ioulive86) missing/invalid `runtime.interface` or wrong port count; (container) missing image or invalid `runtime` |
| `INTERFACE_NOT_FOUND`    | 400    | (ioulive86) the bound host interface does not exist on the server               |
| `IOULIVE86_NOT_FOUND`    | 500    | (ioulive86) bridge binary missing from the server                               |
| `IOULIVE86_START_FAILED` | 500    | (ioulive86) bridge process exited on startup (e.g. passwordless sudo not configured) |
| `CONTAINER_RUN_FAILED`   | 500    | (container) `podman run` failed (e.g. bad image or run options)                 |
| `CONTAINER_NOT_FOUND` / `CONTAINER_NOT_RUNNING` | 500 | (container) the container could not be inspected or is not running        |
| `VETH_ATTACH_FAILED` / `VETH_PAIR_FAILED` | 500 | (container) the netns helper failed to wire a veth link (e.g. passwordless sudo not configured) |

The ioulive86 and container codes apply only when the lab contains those node types; both need a one-time passwordless-sudo rule — see the [Installation Guide](../guide/07-installation.md#5-ioulive86-physical-network-bridging) (ioulive86) and [section 6](../guide/07-installation.md#6-container-nodes-podman) (container).

---

## `POST /v1/labs/:labId/nodes/stop`

Stop all nodes in the lab.

**Response `200`**

```json
{ "ok": true, "data": { "stopped": 2 }, "meta": { "changed": true } }
```

---

## `GET /v1/labs/:labId/nodes/:nodeId`

Get the runtime status of a single node.

**Response `200`**

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

**Error codes**

| Code             | Status | Description                   |
| ---------------- | ------ | ----------------------------- |
| `NODE_NOT_FOUND` | 404    | Node ID not found in lab spec |
| `LAB_NOT_LOADED` | 409    | Lab has not been loaded       |

---

## `POST /v1/labs/:labId/nodes/:nodeId/start`

Start a single node.

**Response `200`**

```json
{ "ok": true, "data": { "status": "running" }, "meta": { "changed": true } }
```

**Error codes**

| Code                     | Status | Description                                                                     |
| ------------------------ | ------ | ------------------------------------------------------------------------------- |
| `NODE_NOT_FOUND`         | 404    | Node ID not found in lab spec                                                    |
| `LAB_NOT_LOADED`         | 409    | Lab has not been loaded                                                          |
| `INVALID_LAB_SPEC`       | 400    | node misconfigured — (ioulive86) missing/invalid `runtime.interface` or wrong port count; (container) missing image or invalid `runtime` |
| `INTERFACE_NOT_FOUND`    | 400    | (ioulive86) the bound host interface does not exist on the server               |
| `IOULIVE86_NOT_FOUND`    | 500    | (ioulive86) bridge binary missing from the server                               |
| `IOULIVE86_START_FAILED` | 500    | (ioulive86) bridge process exited on startup (e.g. passwordless sudo not configured) |
| `CONTAINER_RUN_FAILED`   | 500    | (container) `podman run` failed (e.g. bad image or run options)                 |
| `CONTAINER_NOT_FOUND` / `CONTAINER_NOT_RUNNING` | 500 | (container) the container could not be inspected or is not running        |
| `VETH_ATTACH_FAILED` / `VETH_PAIR_FAILED` | 500 | (container) the netns helper failed to wire a veth link (e.g. passwordless sudo not configured) |

---

## `POST /v1/labs/:labId/nodes/:nodeId/stop`

Stop a single node.

**Response `200`**

```json
{ "ok": true, "data": { "status": "stopped" }, "meta": { "changed": true } }
```

---

## `POST /v1/labs/:labId/nodes/:nodeId/reset`

Send SIGHUP to the node's console wrapper, forcing a fresh console connection without restarting the node process.

**Response `200`**

```json
{ "ok": true, "data": { "status": "reset" }, "meta": { "changed": true } }
```

`data.status` is `"stopped"` and `meta.changed` is `false` if the node was not running.

---

## `POST /v1/labs/:labId/nodes/:nodeId/wipe`

Delete a container node's [per-node volumes](../guide/02-topo-editor.md#per-node-volumes) (all volumes labelled with this lab and node), so its next start begins from the image defaults.

**Response `200`**

```json
{ "ok": true, "data": { "volumes": 1 }, "meta": { "changed": true } }
```

`data.volumes` is the number of volumes removed; `meta.changed` is `false` if there were none.

**Error codes**

| Code              | Status | Description                              |
| ----------------- | ------ | ---------------------------------------- |
| `NODE_NOT_FOUND`  | 404    | No node with that id in the lab          |
| `NOT_A_CONTAINER` | 400    | The node is not a container node         |
| `LAB_NOT_LOADED`  | 409    | The lab is not loaded                    |
| `NODE_RUNNING`    | 409    | The node is running; stop it first       |

---

## `WS /v1/labs/:labId/nodes/:nodeId/console`

WebSocket console proxy. Connects the client directly to the node's telnet console port.

- **Client → server**: raw bytes forwarded to the node's stdin
- **Server → client**: raw bytes from the node's stdout

The connection closes automatically if the lab is not loaded or the node process exits.

