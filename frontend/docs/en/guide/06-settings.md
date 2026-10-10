# Settings

The Settings page manages images, the runtime, the backend connection, and a browser shell on the server. Open it from the top navigation bar.

## Images

The Images section lists all image files currently available on the backend.

### Image naming

NLC identifies a node's profile from the filename prefix:

| Profile | Filename prefix  |
| ------- | ---------------- |
| Router  | `I86BI_LINUX`    |
| Switch  | `I86BI_LINUX_L2` |

Files that match neither prefix are rejected on upload.

### Uploading an image

Click **Upload Image** and choose a file. The file is uploaded directly from the browser to the backend. Do not leave the page while the upload is in progress.

### Deleting an image

Click **Delete** next to any image in the list. The file is removed from the backend immediately.

## Runtime

The Runtime section sets the IOU/IOL key stored on the backend.

### Updating the IOU/IOL key

1. Go to **Settings → Runtime**.
2. Enter the key in the **Update IOU/IOL key** field.
3. Click **Save**.

The change applies immediately to every node started after saving. Nodes already running do not use the new key until they are restarted.

## Backend

The Backend section configures how the frontend reaches the backend server.

### Internal URL

The URL the Next.js server uses to call the backend directly, server to server. Defaults to `http://localhost:8080`. When the frontend and backend run on the same machine, it usually needs no change.

### Public URL

The URL the browser uses for backend WebSockets (console, capture, shell).

When it is empty, the browser derives the backend address from the page it has open:

| Page address                 | Backend address used             |
| ---------------------------- | -------------------------------- |
| `http://192.168.56.129`      | `ws://192.168.56.129/v1` (through Nginx) |
| `https://lab.example.com`    | `wss://lab.example.com/v1` (through Nginx) |
| `http://192.168.56.129:3000` | `ws://192.168.56.129:8080/v1` (port taken from the Internal URL) |
| `http://localhost:3000`      | the Internal URL                 |

In other words, a page address without a port is taken to be behind a reverse proxy, so the same address is used; a page address with a port is taken to be the frontend reached directly, so the backend port on the same host is used. With the bundled Nginx configuration (see the [Installation Guide](./07-installation.md#8-production-deployment-with-systemd-and-nginx)), or when opening port 3000 directly, there is nothing to fill in.

Set it by hand when:

- the reverse proxy runs on a non-standard port (for example `http://192.168.56.129:8000`)
- the backend is on another host, or is published at an address different from the frontend's

**Example: backend on another host:**

| Field        | Value                       |
| ------------ | --------------------------- |
| Internal URL | `http://192.168.1.100:8080` |
| Public URL   | `http://192.168.1.100:8080` |

Changes apply immediately to new connections. WebSocket sessions already open are unaffected until they reconnect.

## Shell

The Shell section is a browser-based SSH terminal to **the backend server itself**, for host-level tasks (managing Podman images and volumes, checking processes).

### Connecting

1. Go to **Settings → Shell**.
2. Enter the **Username** of a Linux account on the backend host and click **Connect**.
3. The SSH server prompts for the password in the terminal; type it there.
