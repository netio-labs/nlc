# Topology Editor

The topology editor creates and modifies lab topologies. Open it by clicking **Create** on the Labs page, or **Edit** next to an existing lab.

## Layout

| Area               | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| **Top bar**        | Lab name, description, View button (saved labs), Save Lab button |
| **Left sidebar**   | Build panel (node/link properties) and Lab Settings        |
| **Canvas**         | ReactFlow canvas — drag, zoom, and connect nodes           |
| **Device toolbar** | Floating toolbar centered at the bottom of the canvas      |

## Adding Nodes

Click an icon in the device toolbar at the bottom of the canvas:

- **Router icon** — adds an IOU Router node
- **Switch icon** — adds an IOU Switch node
- **Virtual PC icon** — adds a lightweight test host (see [Node Types](#node-types))
- **IOULive86 icon** — adds a bridge to a physical interface on the server (see [Node Types](#node-types))
- **Container icon** — adds a Podman container node (see [Node Types](#node-types))

Each new node gets a name automatically when placed on the canvas (`r1`, `r2`, `s1`, `vpc1`, `lan1`, `c1`, …). IOU and Container nodes use the first available image for their profile; for IOU, if no image has been uploaded, the image field is empty and must be set before the lab can run. Virtual PC and IOULive86 nodes use fixed built-in images and need no upload.

## Node Types

| Toolbar icon | Profile     | Interfaces          | Description                                                                 |
| ------------ | ----------- | ------------------- | --------------------------------------------------------------------------- |
| Router       | `iouRouter` | Ethernet + Serial   | Cisco IOU router image (`I86BI_LINUX-*`).                                   |
| Switch       | `iouSwitch` | Ethernet            | Cisco IOU L2 image (`I86BI_LINUX_L2-*`).                                    |
| Virtual PC   | `vpc`       | One port (`eth0`)   | Lightweight user-space test host.                                           |
| IOULive86    | `ioulive86` | Ethernet            | Bridges `e0/0` to a physical NIC on the server, or (`auto` mode) to a container on `e0/1`. |
| Container    | `container` | 1–16 Ethernet ports | A Podman container (run as root).                                           |

### Virtual PC

A Virtual PC is a small endpoint for testing connectivity inside a lab, at a fraction of the cost of a full IOU/IOL node. Console into it like any other node and use its simple command set: set the address with `ip address 10.1.1.10/24` (or `ip address dhcp`) and the default gateway with `ip gateway 10.1.1.1`, then use `ping`, `telnet`, `ssh` (shows the server's version and algorithms), `get` (HTTP), and `web start` (a small HTTP server). Save its configuration with `save`.

Its image is fixed to `NETIO_VIRTUAL_PC` and it always has exactly one Ethernet port.

### IOULive86 Bridge

An IOULive86 Bridge connects an IOU/IOL interface to a **physical NIC on the server**.

When an IOULive86 node is selected, the **Build** tab shows an extra **Bind interface** field: the physical server interface the node bridges to. Alternatively, choose `auto` to bridge a container: in `auto` mode the node gets a second port, `e0/1`, for the container link.

The bridge needs a one-time server-side setup (passwordless `sudo` for the bridge program) — see the [Installation Guide](./07-installation.md#5-ioulive86-physical-network-bridging).

The IOULive86 console has no device CLI; it shows live status (bridged interface, peer instance and frame counters), refreshed each time you press Enter.

### Container

A Container node runs a **Podman container** (rootful) as a lab device — for example a router image such as cEOS or cRPD, or any Linux image with networking tools.

When a container node is selected, the **Build** tab shows container-specific fields:

| Field                    | Description                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **Container image**      | Drop-down of images available on the server (read from `sudo podman images` when the editor opens). |
| **Support status**       | Shows `<label> · supported` when the image is in the [container catalog](#container-catalog).     |
| **Run parameters**       | Collapsed by default; shows, read-only, the **Command**, **Run options** and **Console shell** the node starts with. |
| **Ethernet ports**       | Number of Ethernet interfaces (`eth0`, `eth1`, …).                                                |
| **Interface addressing** | Optional per-port IPv4 address, prefix and gateway. When set, NLC configures the address inside the container as the link comes up. |

The image and run parameters take effect only when the container is **created**, i.e. when it starts. Stopping a container deletes it, so every start begins from a fresh container with the current image and command.

#### Container catalog

The command, run options and console shell an image needs are not typed into the editor; they come from the container catalog, `backend/catalog/container.json`. Entries are tried in order and the first match wins; an image that matches no entry gets the `default` entry (`sleep infinity`, shell `/bin/sh`).

```json
{
  "id": "frr",
  "label": "FRRouting",
  "match": ["frrouting/frr", "frr"],
  "command": ["/usr/lib/frr/watchfrr", "zebra", "staticd", "bgpd", "ospfd"],
  "runArgs": ["--privileged", "-v", "{{volume:config}}:/etc/frr"],
  "shell": "vtysh",
  "notes": "Shown under Run parameters."
}
```

| Field     | Description                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `id`      | Lowercase identifier; must be unique.                                                                |
| `label`   | Name shown in the editor.                                                                            |
| `match`   | Glob patterns (`*` supported, case-insensitive) matched against the repository name without registry and tag, e.g. `ios-xr/xrd-control-plane`. |
| `command` | Argv run inside the container, after the image. Omit to use the image's own entrypoint.              |
| `runArgs` | `podman run` options placed **before** the image. See [Per-node volumes](#per-node-volumes) for `{{volume:<name>}}`. |
| `shell`   | What the console runs inside the container. Omit for `/bin/sh`.                                      |
| `notes`   | Optional remark shown with the run parameters.                                                       |

#### Per-node volumes

A stopped container is deleted, and anything written inside it is lost. To keep a directory across stop/start, mount a per-node volume with `{{volume:<name>}}` in the run options (`runArgs`), e.g. `-v {{volume:config}}:/etc/frr`. NLC replaces it with `nlc-<node id>-<name>`.

A volume lives as long as the node's runtime state: like IOU nvram, it is kept across stop/start and **deleted on Unload**; **Wipe Data** in the viewer deletes the volumes of one stopped node.

**Setup.** Container nodes need Podman and one-time passwordless sudo rules for `podman` and for the helper that wires their virtual links — see the [Installation Guide](./07-installation.md#6-container-nodes-podman). Without these rules, starting a container node fails with a sudo error.

## Connecting Nodes

Hovering over a node shows its handles (small dots on its edges). Drag from a handle to another node to create a link. NLC assigns the first free pair of interfaces automatically.

- If both nodes have both **Ethernet** and **Serial** interfaces, the link uses Ethernet by default.
- **Multilink**: drag between the same two nodes again to add a second (or third) link. Multiple links between the same pair are drawn as one bundled edge until one of them is selected.

**Container links.** Any link to a container node is implemented as a direct kernel `veth` pair (drawn as a teal edge) instead of the usual internal forwarding:

- **Container ↔ Container** — a veth pair is created directly between the two containers; nothing else is needed.
- **Container ↔ IOU device** — connect the container to an **IOULive86** node; its **Bind interface** switches to `auto` automatically. The container link uses the bridge's `e0/1` and the IOU-side link uses its `e0/0`, so one bridge carries exactly one container link and one IOU link. A container cannot connect directly to an IOU node; go through an IOULive86 node instead.

## Editing a Node

Click a node to select it. The **Build** tab in the left sidebar shows its properties:

| Field                                       | Description                                                       |
| ------------------------------------------- | ----------------------------------------------------------------- |
| **Name**                                    | Node hostname label, shown on the canvas                          |
| **Image**                                   | Image filename (IOU) or container image                           |
| **Bind interface**                          | _(IOULive86 only)_ the physical server NIC the node bridges to    |
| **Interfaces**                              | Slot/port counts for Ethernet and Serial                          |
| **RAM / NVRAM**                             | Memory allocated at node start, in MB / KB (IOU nodes only)       |
| **Support status / Run parameters / Addressing** | _(Container only)_ see [Container](#container) above         |

### IOU images and default RAM

The editor tells the two generations of IOU images apart by **file extension**:

| Extension | Image                                                                          | Default RAM |
| --------- | ------------------------------------------------------------------------------ | ----------- |
| `.bin`    | Classic IOU (IOS 15.x and earlier), e.g. `I86BI_LINUX-AdvEnterpriseK9-M2_157.bin` | 256 MB   |
| `.iol`    | IOL (IOS XE 17.x), e.g. `I86BI_LINUX-adventerprisek9-ms-17-16-01a.iol`         | 512 MB      |

New nodes use their image's default. The NVRAM default is 64 KB for both.

## Editing a Link

Click a link (edge) on the canvas to select it. The **Build** tab shows:

- **Family** — Ethernet or Serial (switchable when both nodes support it)
- **Source / Target** — which interface each end uses; change it from the drop-down if other ports are free
- **Description** — optional free-text label shown on the edge

## Deleting Elements

Select a node or edge and press **Delete**. Deleting a node also deletes all of its edges.

## Lab Settings Tab

The **Lab Settings** tab in the left sidebar provides:

- **Show interface labels** — toggles the interface-name labels on the canvas edges
- **Lab ID** — the lab's UUID (read-only)

## Saving

Click **Save Lab** in the top bar. For a new lab this also changes the URL to include `?id=<labId>` and enables the **View** button.

## Navigating to the Viewer

Once the lab is saved, click **View** to open its topology viewer, where you can load the lab, start nodes and connect to them.
