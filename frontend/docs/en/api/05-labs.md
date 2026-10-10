[← API Reference](./index.md)

# Labs

## `GET /v1/labs`

List labs with pagination.

**Query parameters**

| Parameter | Type     | Default  | Description                                                            |
| --------- | -------- | -------- | ---------------------------------------------------------------------- |
| `limit`   | `number` | `10`     | Max items to return                                                    |
| `offset`  | `number` | `0`      | Items to skip                                                          |
| `view`    | `string` | `update` | Sort order: `update` (recently updated) or `create` (recently created) |

**Response `200`**

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

List all labs that currently have at least one running node. The response is computed on demand by probing each allocated console port — no background state is maintained.

**Response `200`**

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

`runningNodes` is the count of nodes whose console port is currently listening. `totalNodes` is the count of allocated instances for the lab. Labs with `runningNodes === 0` are excluded.

---

## `POST /v1/labs`

Create a new lab from a lab spec document.

**Request body** — full lab spec JSON (see [Lab Spec](./08-lab-spec.md)).

**Response `201`**

```json
{
  "ok": true,
  "data": { "created": true, "labId": "...", "path": "..." }
}
```

**Error codes**

| Code                 | Status | Description                                 |
| -------------------- | ------ | ------------------------------------------- |
| `INVALID_LAB_SPEC`   | 400    | Spec validation failed                      |
| `LAB_ALREADY_EXISTS` | 409    | A lab with the same `lab.id` already exists |

---

## `GET /v1/labs/:labId`

Get lab info with current runtime status for all nodes.

**Response `200`**

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

`instance_id` and `console_port` are `null` when the lab is not loaded. `status` is `"running"` or `"stopped"`.

---

## `GET /v1/labs/:labId/spec`

Get the full topology spec for a lab.

**Response `200`**

```json
{
  "ok": true,
  "data": { "spec": { ... } }
}
```

The `spec` object is the complete lab spec document (see [Lab Spec](./08-lab-spec.md)).

---

## `PUT /v1/labs/:labId`

Replace the lab spec. `body.lab.id` must equal the path `labId`.

**Request body** — full lab spec JSON.

**Response `200`**

```json
{
  "ok": true,
  "data": { "updated": true, "labId": "...", "path": "...", "message": "..." }
}
```

**Error codes**

| Code               | Status | Description                               |
| ------------------ | ------ | ----------------------------------------- |
| `INVALID_LAB_SPEC` | 400    | Spec validation failed                    |
| `LAB_ID_MISMATCH`  | 400    | `body.lab.id` does not match path `labId` |
| `LAB_NOT_FOUND`    | 404    | Lab does not exist                        |

---

## `DELETE /v1/labs/:labId`

Delete a lab. The lab must be unloaded first. Its saved [configurations](./09-configs.md) are deleted too.

**Response `200`**

```json
{
  "ok": true,
  "data": { "deleted": true, "labId": "...", "path": "..." }
}
```

**Error codes**

| Code            | Status | Description                                     |
| --------------- | ------ | ----------------------------------------------- |
| `LAB_LOADED`    | 409    | Lab still has allocated instances; unload first |
| `LAB_NOT_FOUND` | 404    | Lab does not exist                              |

---

## `POST /v1/labs/:labId/duplicate`

Duplicate a lab. All identifiers (lab ID, node IDs, link IDs) are replaced with newly generated UUIDs. The duplicated lab name has ` duplicated` appended. Saved [configurations](./09-configs.md) and the `current` mark are copied too (device names are unchanged, so they can be used for a replace as-is).

**Response `201`**

```json
{
  "ok": true,
  "data": { "duplicated": true, "labId": "...", "path": "..." }
}
```

**Error codes**

| Code            | Status | Description        |
| --------------- | ------ | ------------------ |
| `LAB_NOT_FOUND` | 404    | Lab does not exist |

---

## `POST /v1/labs/import`

Import a lab from an exported lab spec document. Like `duplicate`, all identifiers (lab ID, node IDs, link IDs, and their references in `ui.nodes`/`ui.edges`) are replaced with newly generated UUIDs to avoid colliding with existing labs. Unlike `duplicate`, the original `lab.name`/`description` are kept as-is (no `" duplicated"` suffix), and no saved configurations come with it — import those separately with [`POST /v1/labs/:labId/configs/import`](./09-configs.md).

**Request body** — full lab spec JSON (see [Lab Spec](./08-lab-spec.md)), typically the file downloaded via the frontend's "Export" button.

**Response `201`**

```json
{
  "ok": true,
  "data": { "imported": true, "labId": "...", "path": "..." }
}
```

**Error codes**

| Code               | Status | Description             |
| ------------------ | ------ | ------------------------ |
| `INVALID_LAB_SPEC` | 400    | Spec validation failed  |

---

## `POST /v1/labs/:labId/load`

Allocate instance IDs for all nodes, create runtime directories, and write the netmap file. Idempotent — existing allocations and runtime files (including nvram) are preserved.

**Response `200`**

```json
{ "ok": true, "data": { "loaded": true } }
```

**Error codes**

| Code                  | Status | Description                   |
| --------------------- | ------ | ----------------------------- |
| `NO_FREE_INSTANCE_ID` | 409    | Instance ID pool is exhausted |

---

## `POST /v1/labs/:labId/unload`

Stop all running nodes, stop all captures, release instance IDs, and delete the runtime directory (including nvram) and the lab's per-node container volumes (`{{volume:<name>}}`). Saved [configurations](./09-configs.md) are kept.

**Response `200`**

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

