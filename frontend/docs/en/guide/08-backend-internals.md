# Appendix: Backend Command-Line Internals

This is a developer reference for how the NLC backend drives node processes at the command-line level, and how to wire a container to an `ioulive86` bridge by hand during development.

Paths below assume the default layout under `/opt/nlc/backend`.

---

## 1. `wrapper-linux` — the console/process wrapper

Every IOU node, every container console, and the browser shell runs its child process through `wrapper-linux` (`addons/iou/wrapper-linux`). It forks the child, owns one TCP port, and exposes the child's console there as a **telnet-style stream**, which the frontend terminal connects to (through the backend's WebSocket bridge). It keeps the child running even with no client connected, and replays the last ~32 KB of output to the next client that connects, so boot logs are always visible.

```
wrapper-linux -m /path/to/image -p <port> [-t "Title"] [-d delay] [-P] -- [child options]
```

| Option               | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `-m <image>`         | The executable to run (an IOU image, `podman`, `/usr/bin/ssh`, …). Must be executable.      |
| `-p <port>`          | TCP port the console listens on (1025–65535). NLC uses `consoleBasePort (20000) + instanceId`. |
| `-t "Title"`         | Console window title (the node name).                                                       |
| `-d <delay>`         | Seconds to wait before starting the child.                                                  |
| `-P`                 | Give the child a **pty** (needed by interactive shells such as `podman exec -it` and `ssh`). |
| `-- <child options>` | Everything after `--` is passed to the child unchanged.                                     |

Only one console session is allowed at a time; a second connection gets a one-line "busy" notice and is closed. `SIGTERM`/`SIGINT` to the wrapper stops the child; `SIGHUP` drops the current client but keeps the child running.

**How NLC invokes it**

IOU router/switch (pipe mode; after `--` come IOU's own options — `-e` Ethernet, `-s` Serial, `-n` nvram, `-m` ram, `-l` L2 keepalive, `-W` no watchdog, `-N` ignore NETMAP — and finally the instance ID):

```bash
wrapper-linux -m <IOU image> -p 20055 -d 0 -t r1 -- -e 2 -s 0 -n 64 -m 256 55
```

Container console (pty mode, `podman exec` into the running container). The shell runs in a loop behind a "Press RETURN" prompt, so exiting the shell does not end the wrapper (which would close the console port and make the node look stopped):

```bash
wrapper-linux -P -m /usr/bin/sudo -p 20005 -t c1 -- -n /usr/bin/podman exec -it nlc-<nodeId> \
  /bin/sh -c 'trap : INT; while :; do echo; echo "[nlc] Press RETURN to start <shell>"; read _ || sleep 1; <shell>; done'
```

Browser shell (pty mode, `ssh` to the backend host — see the [Settings guide](./06-settings.md#shell)):

```bash
wrapper-linux -P -m /usr/bin/ssh -p <port> -t "ssh user@localhost" -- -tt -o StrictHostKeyChecking=accept-new -l <user> localhost
```

---

## 2. `ioulive86` — the IOU ↔ Linux-interface bridge

`ioulive86` (`addons/iou/ioulive86`) bridges an IOU node's NETIO socket to a real Linux L2 interface: a **physical NIC** (IOULive86 Bridge node), or a **veth** whose other end is in a container's network namespace (`interface=auto`). Capturing raw Ethernet frames needs `CAP_NET_RAW`, so it is started through `sudo` (see the [Installation Guide](./07-installation.md#5-ioulive86-physical-network-bridging)).

```
ioulive86 -i <interface> [-n NETMAP] [-p <console port>] [-t <title>] <instance ID>
```

| Argument            | Meaning                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| `-i <interface>`    | The Linux interface to bridge (e.g. `eth0`, or a `podveth<N>` veth).        |
| `-n <NETMAP>`       | Path to the lab's `NETMAP` file, which pairs IOU and ioulive86 instances.   |
| `-p <console port>` | Status-screen console port (`20000 + instanceId`).                          |
| `-t <title>`        | Console title (the node name).                                              |
| `<instance ID>`     | The ioulive86 instance ID; it pairs with an IOU instance ID over NETIO.     |

**How NLC invokes it** (note the leading `-n` is `sudo`'s non-interactive flag, followed by the program path):

```bash
sudo -n /opt/nlc/backend/addons/iou/ioulive86 -i eth0 -n <lab dir>/NETMAP -p 20056 -t lan1 56
```

The IOU side talks over the NETIO Unix datagram socket at `/tmp/netio<uid>/<instanceId>`; `NETMAP` (in the lab runtime directory) maps IOU instances to ioulive86 instances.

The `ioulive86` console is a live status screen, not a CLI:

```
ioulive86 is working with physical interface veth0
  IOU instance 55 0/0 <-> ioulive86 instance 56 (IOU socket present)
  frames LAN->IOU: 46   IOU->LAN: 6870   dropped: 0   raw errors: 0
  offload fixes: checksum 0   vlan tag 0
```

`IOU socket present` with growing frame counters means the data path is up.

---

## 3. Containers and veth wiring

Container nodes run under **rootful Podman** (`sudo -n podman`) and start with `--network none`; NLC injects the interfaces itself. Moving one end of a veth into a container's network namespace goes through the helper below.

### 3.1 The `nlc-netns-helper`

`addons/helper/nlc-netns-helper` is a small, root-owned Python helper invoked through `sudo -n`. It only ever touches `podveth<N>` interfaces (see the [Installation Guide](./07-installation.md#6-container-nodes-podman)). It has three subcommands:

```bash
# Container ↔ ioulive86: one veth pair, root end stays in the host, cont end goes into the container
nlc-netns-helper create --pid <container pid> --root-veth podveth<N> --cont-veth eth<k> \
                        [--addr 10.1.1.2] [--prefix 24] [--gateway 10.1.1.1]

# Tear a root veth down (idempotent)
nlc-netns-helper delete --root-veth podveth<N>

# Container ↔ container: a veth pair with each end injected into a different netns
nlc-netns-helper pair --a-pid <pidA> --a-cont-veth eth<k> [--a-addr … --a-prefix … --a-gateway …] \
                      --b-pid <pidB> --b-cont-veth eth<m> [--b-addr … --b-prefix … --b-gateway …]
```

- **Container ↔ IOU / physical NIC**: `create` makes a `podveth<N>` pair, injects the container end into the container as `eth<k>`, and leaves `podveth<N>` in the host for `ioulive86 -i podveth<N>` to bridge.
- **Container ↔ container**: `pair` makes a veth pair and injects each end directly into its container's netns — no `ioulive86` and no NETIO.

### 3.2 Manual walkthrough (development)

These are the manual steps the helper automates, kept for reference. They connect a single Alpine container to an `ioulive86` bridge and verify reachability to an IOU router configured as `10.1.1.1`. (The veths `veth0`/`veth1` here are a pre-existing test pair; in production the helper creates them as `podveth<N>`.)

```bash
# 1. Start a container with no networking
sudo podman run -d --name nlc-alpine --network none alpine sleep infinity

# 2. Find its main PID — this is the handle to its network namespace
sudo podman inspect -f '{{.State.Pid}}' nlc-alpine   # e.g. 117303

# 3. Move one veth end into the container netns, rename it, bring it up, address it
sudo ip link set veth1 netns 117303
sudo nsenter -t 117303 -n ip link set veth1 name eth1
sudo nsenter -t 117303 -n ip link set eth1 up
sudo nsenter -t 117303 -n ip addr add 10.1.1.2/24 dev eth1

# 4. The other end (veth0) stays in the host for ioulive86 to bridge:
#    ioulive86 -i veth0 ... <instanceId>   (IOU router on the far side, 10.1.1.1)

# 5. Verify from inside the container
sudo podman exec -it nlc-alpine /bin/sh   # note: alpine has /bin/sh, not /bin/bash
/ # ping 10.1.1.1

# 6. Clean up (removing the container frees the netns and destroys its veth end)
sudo podman rm -f nlc-alpine
```

### 3.3 Inspecting a namespace with `nsenter`

`nsenter -t <pid> -n <cmd>` runs `<cmd>` inside the network namespace of process `<pid>` — the way to look inside a container's netns from the host:

```bash
# What interfaces / addresses does the container see?
sudo nsenter -t <pid> -n ip -o link show
sudo nsenter -t <pid> -n ip addr show

# Routing and reachability from inside the container's netns
sudo nsenter -t <pid> -n ip route
sudo nsenter -t <pid> -n ping -c3 10.1.1.1
```

From the **host** side, a veth whose peer is in a container shows the peer index and a `link-netnsid`, e.g. `veth0@if3 … link-netnsid 0`; inside the container the matching interface shows `eth1@if4 … link-netnsid 0`. Matching the `@ifN` indices across the two views confirms which host veth pairs with which container interface.

> Enable `enableDebug.container` / `enableDebug.ioulive86` / `enableDebug.shell` in `backend/src/config.ts` to log the exact `podman`, helper, `ioulive86` and `wrapper-linux` command lines the backend runs — the fastest way to see what to reproduce by hand.

---

## 4. Python-simulated images (`netio_sim`)

The Virtual PC and the placeholder router/switch are Python programs that speak NETIO directly (Unix datagram sockets at `/tmp/netio<uid>/<instance>`, peers from `NETMAP`), launched by `wrapper-linux` like any IOU image.

The image list is the set of **files** in `addons/iou`, so each image there is a thin entry point; the code lives in the `addons/iou/netio_sim/` package:

| Image file                      | Entry                               |
| ------------------------------- | ----------------------------------- |
| `NETIO_VIRTUAL_PC`              | `netio_sim.vpc_cli.main()`          |
| `I86BI_LINUX-FAKE-M-15.0.py`    | `netio_sim.fake_iou.main("router")` |
| `I86BI_LINUX_L2-FAKE-M-15.0.py` | `netio_sim.fake_iou.main("switch")` |

| Module        | Contents                                                                    |
| ------------- | --------------------------------------------------------------------------- |
| `netio.py`    | NETIO socket paths, `NETMAP` parsing, the 8-byte NETIO header (shared)      |
| `packets.py`  | Ethernet / ARP / IPv4 / ICMP / TCP / UDP builders and checksums             |
| `tcp.py`      | Client-side TCP connection                                                  |
| `dhcp.py`     | DHCP client (lease timers, renew/rebind, release, debug output)             |
| `apps.py`     | `telnet`, `ssh`, `get`, `web` — a mixin on `VirtualPC`                      |
| `vpc.py`      | `VirtualPC`: receive/dispatch, ARP, ping, config file, `show`               |
| `console.py`  | Virtual PC line editing (history, `?`, redraw after background messages)    |
| `vpc_cli.py`  | Virtual PC command dispatch, help text, `main()`                            |
| `fake_iou.py` | Placeholder console + periodic gratuitous ARP per peer (for captures)       |

Nodes execute a symlink to the image from their runtime directory; the entry points resolve it with `realpath` to find the package. A change under `netio_sim/` takes effect the next time a node is started — running nodes keep the code they were started with.
