[← API Reference](./index.md)

# Lab Spec

The lab spec is the JSON document that defines a lab's topology. It is used in `POST /v1/labs` and `PUT /v1/labs/:labId`.

```json
{
  "lab": {
    "id": "0aab910b-991a-434c-89fc-2c866facdd4f",
    "name": "My Lab",
    "description": "optional"
  },
  "nodes": [
    {
      "type": "iou",
      "id": "22222222-2222-4222-8222-222222222226",
      "name": "r1",
      "vendor": "cisco",
      "profile": "iouRouter",
      "image": "I86BI_LINUX_L2-FAKE-M-15.0.py",
      "runtime": { "ram": 256, "nvram": 64 },
      "interfaces": [
        { "family": "ethernet", "uiPrefix": "e", "slotCount": 2, "portsPerSlot": 4 },
        { "family": "serial", "uiPrefix": "s", "slotCount": 2, "portsPerSlot": 4 }
      ]
    }
  ],
  "links": [
    {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
      "source": "22222222-2222-4222-8222-222222222226",
      "target": "33333333-3333-4333-8333-333333333336",
      "endpoints": [
        { "family": "ethernet", "slot": 0, "port": 0 },
        { "family": "ethernet", "slot": 0, "port": 0 }
      ],
      "description": "r1 e0/0 <-> r2 e0/0"
    }
  ]
}
```

**`type`** is the simulator backend: `iou` (Cisco IOU router/switch, and the Virtual PC), `ioulive86` (physical-interface bridge), or `container` (Podman container, run as root).

An **IOULive86 Bridge** node uses `type: "ioulive86"` and a `runtime.interface` naming the host NIC to bridge (from `GET /v1/host/interfaces`). Set `interface` to `"auto"` to bridge a connected container instead of a physical NIC. Its port count follows the mode: one Ethernet port (`portsPerSlot` 1) for a host NIC, two (`portsPerSlot` 2) for `auto`. Port 0 is always the `netio` side (to an IOU / Virtual PC node); port 1 exists only in `auto` mode and is the container's `veth` link:

```json
{
  "type": "ioulive86",
  "id": "6d1e0b2a-3333-4b1b-8a1a-000000000002",
  "name": "lan1",
  "vendor": "nlc",
  "profile": "ioulive86",
  "image": "ioulive86",
  "runtime": { "interface": "eth0" },
  "interfaces": [
    { "family": "ethernet", "uiPrefix": "e", "slotCount": 1, "portsPerSlot": 1 }
  ]
}
```

A **Container** node uses `type: "container"`, at least one Ethernet port, `image` set to a container image reference (from `GET /v1/image/container`), and an optional `runtime` object:

```json
{
  "type": "container",
  "id": "6d1e0b2a-5555-4b1b-8a1a-000000000005",
  "name": "c1",
  "vendor": "nlc",
  "profile": "container",
  "image": "docker.io/library/alpine:latest",
  "runtime": {
    "command": ["sleep", "infinity"],
    "runArgs": ["--privileged", "-v", "myvol:/config"],
    "addresses": [
      { "port": 0, "address": "10.1.1.2", "prefix": 24, "gateway": "10.1.1.1" }
    ]
  },
  "interfaces": [
    { "family": "ethernet", "uiPrefix": "eth", "slotCount": 1, "portsPerSlot": 1 }
  ]
}
```

Container `runtime` fields (all optional): **`command`** — argv run inside the container, placed after the image (empty/absent uses the image entrypoint); **`runArgs`** — `podman run` flags placed before the image (do not include `--network`, which NLC manages); `{{volume:<name>}}` expands to the per-node volume `nlc-<node id>-<name>` (the only placeholder; anything else in `{{ }}` is rejected with `INVALID_LAB_SPEC`), kept across stop/start and removed on unload or by [Wipe Data](./06-nodes.md#post-v1labslabidnodesnodeidwipe); **`shell`** — the command the console runs inside the container, with arguments (default `/bin/sh`); **`addresses`** — per-port IPv4 config, each `{ port, address, prefix, gateway? }`, applied inside the container when the link comes up; **`catalog`** — the [container catalog](../guide/02-topo-editor.md#container-catalog) entry `command` / `runArgs` / `shell` were copied from (editor bookkeeping, ignored by the backend).

**`profile`** determines the image and which `runtime` fields apply:

| Profile     | `type`      | Image                          | Runtime fields                     |
| ----------- | ----------- | ------------------------------ | ---------------------------------- |
| `iouRouter` | `iou`       | filename prefix `I86BI_LINUX`    | `ram`, `nvram`                     |
| `iouSwitch` | `iou`       | filename prefix `I86BI_LINUX_L2` | `ram`, `nvram`                     |
| `vpc`       | `iou`       | fixed `NETIO_VIRTUAL_PC`         | none                               |
| `ioulive86` | `ioulive86` | fixed `ioulive86`                | `interface` (required; `auto` bridges a container) |
| `container` | `container` | container image reference        | `command`, `runArgs`, `shell`, `addresses`, `catalog` (all optional) |

IOU `runtime.ram` is in MB and `runtime.nvram` in KB. The backend uses the values as given (falling back to 256 / 64 only when a field is absent); the per-image defaults — 256 MB for `.bin` (classic IOU), 512 MB for `.iol` (IOL 17.x) — are applied by the topology editor, see [IOU images and default RAM](../guide/02-topo-editor.md#iou-images-and-default-ram).

Virtual PC nodes always have exactly one Ethernet port (`slotCount` 1, `portsPerSlot` 1) and no serial ports; IOULive86 nodes have one, or two in `auto` mode. Container nodes have one or more Ethernet ports and no serial ports.

## Link kinds

A link has an optional **`kind`**, defaulting to `"netio"`. Both kinds use the same `endpoints` shape — `linkEndpoint` objects (`{ family, slot, port }`):

- **`netio`** (default) — the standard link between IOU / Virtual PC / IOULive86 ports.
- **`veth`** — used automatically for any link that touches a **container** node. It is realized as a direct kernel `veth` pair (container ↔ container, or container ↔ an IOULive86 `auto` node). A veth link's endpoints always use `family: "ethernet"` and `slot: 0`; only the `port` varies. Which links must be `veth` (those touching a container) is enforced in code, not the schema. On an IOULive86 node a `netio` link must use port 0 and a `veth` link port 1; other specs are rejected with `INVALID_LAB_SPEC`.

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9",
  "kind": "veth",
  "source": "6d1e0b2a-5555-4b1b-8a1a-000000000005",
  "target": "6d1e0b2a-5555-4b1b-8a1a-000000000006",
  "endpoints": [
    { "family": "ethernet", "slot": 0, "port": 0 },
    { "family": "ethernet", "slot": 0, "port": 0 }
  ],
  "description": "c1 eth0 <-> c2 eth0"
}
```
