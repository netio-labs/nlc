# Getting Started

This guide covers first-time setup and walks through running your first lab.

## Step 1 — Log In

Open NLC in your browser; you are redirected to the login page. Log in with the default credentials:

| Username | Password   |
| -------- | ---------- |
| `admin`  | `changeme` |

> The console, capture and shell connect the browser straight to the backend. When NLC is opened by IP or hostname, the backend address is derived from the page address and usually needs no setup; if the console cannot connect, see [Public URL](./06-settings.md#public-url).

## Step 2 — Upload IOU/IOL Images

Go to **Settings → Images**, click **Upload Image**, and choose your image file.

Image filename rules:

| Profile | Filename prefix  |
| ------- | ---------------- |
| Router  | `I86BI_LINUX`    |
| Switch  | `I86BI_LINUX_L2` |

The backend rejects filenames that do not match these prefixes.

> NLC ships with placeholder images (`I86BI_LINUX-FAKE-M-15.0.py` / `I86BI_LINUX_L2-FAKE-M-15.0.py`). They open a console and print a notice, but have no routing or switching function. Use them to check that your setup works before you have real images.

## Step 3 — Set the IOU/IOL Key

Go to **Settings → Runtime**. The page shows the backend hostname automatically. Enter the key in the **Update IOU/IOL key** field and click **Save**.

Whether a node checks `iourc` depends on the image:

- **Some IOU/IOL images** verify the `iourc` key at startup and do not run without a valid key for the backend hostname.
- **Some newer IOL images** do not strictly require `iourc` and run without a key.

## Step 4 — Prepare Container Images (optional)

Skip this step if you only use IOU/IOL.

Container images live in the server's rootful Podman and are managed on the server with `sudo podman`:

1. Go to **Settings → Shell** and log in with a Linux account on the backend server (see [Shell](./06-settings.md#shell)).
2. Manage images in the terminal with the following commands.

| Task                                       | Command                                                    |
| ------------------------------------------ | ---------------------------------------------------------- |
| Pull from a registry                       | `sudo podman pull docker.io/frrouting/frr:latest`          |
| Load a vendor image archive (cRPD, XRd, …) | `sudo podman load -i <archive file>`                       |
| Import cEOS (a rootfs tarball)             | `sudo podman import cEOS64-lab-<version>.tar.xz ceos:<version>` |
| List images                                | `sudo podman images`                                       |
| Remove an image                            | `sudo podman rmi <image>:<tag>`                            |

Notes:

- **`sudo` is required.** NLC only reads root's image store. An image already in your user's store can be copied over with `podman save <image> | sudo podman load`.
- Copy vendor image archives to the server with scp first.

## Step 5 — Create a Lab

To create a new lab, go to the **Labs** page and click **Create**. This opens the topology editor with an empty canvas.

1. Enter a **Lab name** in the top bar.
2. Add nodes with the toolbar at the bottom of the canvas:
   - Router icon — adds a Router node
   - Switch icon — adds a Switch node
   - Container icon — adds a Container node
3. Drag from a handle on any node to another node to connect them.
4. Click **Save Lab**.

See [Topology Editor](./02-topo-editor.md) for the full reference.

## Step 6 — Run the Lab

After saving, click **View** in the top bar, or open the lab from the Labs page. In the topology viewer:

1. Click **Load** — allocates resources and writes the netmap.
2. Click **Start All** — starts all node processes.
3. Click **Console** — opens browser terminals for all nodes.

See [Lab Operations](./03-lab.md) for the full reference.
