# Lab Operations

NLC manages labs through a load, run and unload lifecycle. All controls are in the **General** panel of the topology viewer.

## Lab Lifecycle

### Load

**Load** allocates an instance ID for each node, creates the runtime directory, and writes the `netmap` file that describes the topology connections. It does **not** start any node process.

- The Load button is always available. You can reload at any time, including when the lab is already loaded.
- Reloading is idempotent: existing instance ID allocations and runtime files (including IOU nvram and Virtual PC `startup.cfg`) are kept.
- Nodes read the netmap only when they start, so reloading does not affect nodes that are currently running.

### Unload

**Unload** stops all running nodes, releases all instance ID allocations, stops all active capture sessions, and deletes the lab's whole runtime directory (including IOU nvram files, saved Virtual PC configurations (`startup.cfg`), and all other runtime state). On the next load every node starts from a clean state.

> Use Unload only when you intend to discard the current runtime state completely.

### Start All / Stop All

**Start All** starts all node processes in the lab at once. **Stop All** stops them all.

Nodes can also be started and stopped individually from the node detail panel.

## Applying Topology Changes

Editing a lab topology in the topology editor does not affect running node processes; they keep using the netmap from the last load. To apply changes without losing device configurations (IOU nvram, Virtual PC `startup.cfg`):

1. **Stop All** — stops all running nodes gracefully.
2. **Load** — rewrites the netmap with the updated topology. nvram files are not touched.
3. **Start All** — starts all nodes. Each node reads the new netmap at startup.

This keeps all device configuration stored in nvram. To keep configurations beyond the next Unload, save them to the lab's [configurations](#saving-and-restoring-device-configurations).

## Node Controls

Click any node on the topology canvas to open its detail section in the General panel.

| Control           | Action                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| **Start**         | Starts the node.                                                             |
| **Stop**          | Stops the node.                                                              |
| **Reset Console** | Sends a telnet reset to the node's console port, forcing a new terminal handshake. |
| **Wipe Data**     | _(Container only, node stopped)_ Deletes the node's per-node volumes after confirmation. |

## Active Labs

The left sidebar of the **Labs** page has an **Active** view. It shows every lab that currently has at least one running node, each row with a `running / total` node count.

The list is fetched on demand — the current state is probed when you open the Active view. It does not refresh automatically; reload the page to update it.

## Duplicating a Lab

Each row on the **Labs** page has a **Duplicate** button. It creates a full copy of the lab, with new UUIDs for the lab, all nodes and all links. The copy's name gets ` duplicated` appended. The lab list refreshes automatically.

The copy inherits the full topology and layout, and the saved [configurations](#saving-and-restoring-device-configurations).

## Saving and Restoring Device Configurations

Unlike runtime state, saved configurations survive **Unload**, so you can reset a lab to a known configuration at any time.

IOU devices (routers and switches) and Virtual PCs take part in this feature; IOULive86 and Container nodes do not.

### Saving

1. First save the configuration on each device: `write memory` on IOU devices, `save` on Virtual PCs. NLC reads the device's saved configuration, not its running configuration.
2. Click **Save** (the lab must be loaded) and enter a name, e.g. `preconfig1`.

Reusing a name asks before overwriting. Devices can be running or stopped when you save.

### Replacing the device configurations

1. Stop the devices whose configuration you want to replace.
2. Select a configuration by name in the drop-down, click **Replace** and confirm. Like IOS `configure replace`, the startup configuration of each stopped device is replaced as a whole by that device's section of the configuration; running devices are skipped and listed in the report.
3. Start the devices: they boot with the new configuration.

### Viewing, editing and exporting

- **View** opens the selected configuration in the right-hand panel: first a summary of how it matches this lab's devices, then each device's configuration.
- **Edit** switches to raw text for changes;
- **Download** saves it as a `.md` file;
- **Delete** removes it.

A saved configuration is a plain Markdown file, with one `## <device name>` section per device.

## Console

Click the **Console** button to open the lab's browser terminals in a new tab. See [Console](./04-console.md) for the full reference.
