[← API Reference](./index.md)

# Images

## `GET /v1/image/iou`

List available images.

**Query parameters**

| Parameter | Type                | Description                                                        |
| --------- | ------------------- | ------------------------------------------------------------------ |
| `profile` | `string` (optional) | Filter by profile. `iouRouter` or `iouSwitch`. Omit to return all. |

**Response `200`**

```json
{
  "ok": true,
  "data": {
    "profile": "iouRouter",
    "images": ["I86BI_LINUX_L2-FAKE-M-15.0.py"]
  }
}
```

**Error codes**

| Code              | Status | Description                                 |
| ----------------- | ------ | ------------------------------------------- |
| `INVALID_PROFILE` | 400    | `profile` is not `iouRouter` or `iouSwitch` |

---

## `GET /v1/image/container`

List the container images available on the server, each with the [container catalog](../guide/02-topo-editor.md#container-catalog) entry it matches. Used to populate the **Container image** dropdown for Container nodes.

**Response `200`**

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

Images are read from `sudo podman image ls` (root's image store) (`<repository>:<tag>`), de-duplicated, sorted, and untagged (`<none>`) images are omitted. If Podman is not installed or reports no images, `images` is an empty array. Only the matched entry's `id` and `label` are returned; fetch its parameters with the endpoint below.

**Error codes**

| Code                        | Status | Description                                                     |
| --------------------------- | ------ | --------------------------------------------------------------- |
| `CONTAINER_CATALOG_INVALID` | 500    | `catalog/container.json` is unreadable or malformed; the message names the entry and field |

---

## `GET /v1/image/container/catalog/:id`

One container catalog entry's run parameters. The editor copies them into a node's `runtime` when its image is picked.

**Response `200`**

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

`command`, `runArgs`, `shell` and `notes` are omitted when the entry does not set them (image entrypoint / no flags / `/bin/sh`).

**Error codes**

| Code                        | Status | Description                                   |
| --------------------------- | ------ | --------------------------------------------- |
| `CATALOG_ENTRY_NOT_FOUND`   | 404    | No entry with that `id`                       |
| `CONTAINER_CATALOG_INVALID` | 500    | `catalog/container.json` is unreadable or malformed |

---

## `POST /v1/image/iou`

Upload an image file.

**Request** `multipart/form-data` — one field named `file`. The filename must start with `I86BI_LINUX` (router) or `I86BI_LINUX_L2` (switch).

**Response `201`**

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

**Error codes**

| Code                   | Status | Description                             |
| ---------------------- | ------ | --------------------------------------- |
| `INVALID_UPLOAD`       | 400    | Request is not `multipart/form-data`    |
| `FILE_REQUIRED`        | 400    | No file part in the request             |
| `INVALID_IMAGE_NAME`   | 400    | Filename does not match required prefix |
| `IMAGE_ALREADY_EXISTS` | 409    | A file with that name already exists    |

---

## `DELETE /v1/image/iou/:imageName`

Delete an image by filename.

**Response `200`**

```json
{
  "ok": true,
  "data": { "deleted": true, "image": "I86BI_LINUX_L2-FAKE-M-15.0.py", "path": "..." }
}
```

**Error codes**

| Code                 | Status | Description                             |
| -------------------- | ------ | --------------------------------------- |
| `INVALID_IMAGE_NAME` | 400    | Filename does not match required prefix |
| `IMAGE_NOT_FOUND`    | 404    | File does not exist                     |

---

## `GET /v1/image/iou/key`

Get the current IOU/IOL key (the `iourc` file).

**Response `200`**

```json
{
  "ok": true,
  "data": {
    "hostname": "myhost",
    "key": "12345678abcdef"
  }
}
```

`key` is `null` if no `iourc` file exists yet.

---

## `PUT /v1/image/iou/key`

Write a new IOU/IOL key to `iourc`. The backend hostname is detected automatically.

**Request body**

```json
{ "key": "12345678abcdef" }
```

**Response `200`**

```json
{
  "ok": true,
  "data": { "hostname": "myhost", "key": "12345678abcdef" }
}
```

**Error codes**

| Code          | Status | Description                             |
| ------------- | ------ | --------------------------------------- |
| `INVALID_KEY` | 400    | `key` is missing or contains whitespace |

