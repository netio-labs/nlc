# Appendix: Installation Guide

This guide covers installing NLC and its dependencies on a 64-bit Ubuntu/Debian Linux system (including WSL2).

---

## 1. Install Directory and Service User

The bundled sudoers rules and systemd units assume NLC lives in `/opt/nlc` and the backend runs as the `nlc` user. To deploy with these defaults:

```bash
sudo mkdir -p /opt/nlc
# put the NLC code in /opt/nlc (with its backend/, frontend/ and deploy/ directories)
sudo useradd -r -s /usr/sbin/nologin -d /opt/nlc nlc
sudo chown -R nlc:nlc /opt/nlc
```

> For local development you can run the backend as your own account. In that case, before installing the sudoers rules in sections 5 and 6, change `nlc` in the files to your username; if the code is not in `/opt/nlc`, change the paths in the files as well.

---

## 2. Base Dependencies

### Node.js

NLC requires Node.js 24 or later.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

### Other packages

```bash
sudo apt-get install -y psmisc python3 openssh-server
```

| Package          | Used for                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- |
| `psmisc`         | Provides `fuser`; the backend uses it to check and stop node processes by console port |
| `python3`        | Virtual PC, the placeholder images and the container network helper are Python scripts |
| `openssh-server` | **Settings → Shell** logs in to the backend server itself over SSH                     |

In environments such as WSL, `sshd` may not start automatically; start it by hand and set a password for the account:

```bash
sudo service ssh start
sudo passwd <username>
```

---

## 3. IOU/IOL Runtime

### 3.1 32-bit runtime libraries

Classic IOU images (`.bin`) are 32-bit programs and need the 32-bit runtime libraries:

```bash
sudo dpkg --add-architecture i386
sudo apt-get update
sudo apt-get install -y libc6:i386 libstdc++6:i386 zlib1g:i386
```

| Package           | Provides                                              |
| ----------------- | ----------------------------------------------------- |
| `libc6:i386`      | 32-bit C library (the `ld-linux.so.2` dynamic loader) |
| `libstdc++6:i386` | 32-bit C++ library (also pulls in `libgcc_s`)         |
| `zlib1g:i386`     | Compression library (needed by `libssl0.9.8`)         |

64-bit IOL images (`.iol`) do not need these libraries.

### 3.2 Old OpenSSL 0.9.8 (some older images only)

Some older IOU images look for `libcrypto.so.4`. Check with `ldd <image file>`; only if the output shows `libcrypto.so.4 => not found`, run:

```bash
wget -q http://old-releases.ubuntu.com/ubuntu/pool/main/o/openssl/libssl0.9.8_0.9.8g-4ubuntu3.20_i386.deb \
     -O /tmp/libssl0.9.8_i386.deb
sudo dpkg -i /tmp/libssl0.9.8_i386.deb
sudo ln -s /lib/libcrypto.so.0.9.8 /lib/libcrypto.so.4
```

### 3.3 IOU/IOL images

NLC does not distribute IOU/IOL images. The recommended way is to upload them in **Settings → Images** (see [Getting Started](./01-getting-started.md)); uploading sets the executable bit automatically.

You can also place images in `backend/addons/iou/` by hand and make them executable:

| File               | Description          |
| ------------------ | -------------------- |
| `I86BI_LINUX-*`    | Router IOU/IOL image |
| `I86BI_LINUX_L2-*` | Switch IOU/IOL image |

```bash
chmod +x backend/addons/iou/I86BI_LINUX*
```

---

## 4. sharkd (for Packet Capture)

The capture viewer dissects packets with `sharkd`:

```bash
sudo apt-get install -y wireshark-common
which sharkd
```

The installer asks whether non-superusers may capture packets; either **Yes** or **No** is fine. NLC collects the packets itself and `sharkd` only dissects them, so no capture privilege is needed.

---

## 5. IOULive86 (Physical Network Bridging)

**IOULive86 Bridge** nodes connect a virtual interface in a lab to a real NIC on the server (see the [Topology Editor](./02-topo-editor.md) guide). The bridge needs `CAP_NET_RAW`, so it is started through passwordless `sudo`.

> Skip this section if you do not use IOULive86 Bridge nodes.

### 5.1 Install the sudoers rule

The bundled `deploy/nlc-ioulive86.sudoers` grants passwordless `sudo` for the `ioulive86` program only:

```
Cmnd_Alias NLC_IOULIVE86 = /opt/nlc/backend/addons/iou/ioulive86
nlc  ALL=(root) NOPASSWD: NLC_IOULIVE86
```

If needed, first change the user name and path as described in [section 1](#1-install-directory-and-service-user), then install it:

```bash
sudo install -m 0440 /opt/nlc/deploy/nlc-ioulive86.sudoers /etc/sudoers.d/nlc-ioulive86
sudo visudo -c
```

`visudo -c` must report the file as parsed OK.

### 5.2 Verify

As the backend user, the following must print the usage line without asking for a password:

```bash
sudo -n /opt/nlc/backend/addons/iou/ioulive86 2>&1 | head -1
```

---

## 6. Container Nodes (Podman)

**Container** nodes run rootful Podman containers (see the [Topology Editor](./02-topo-editor.md#container) guide). The backend calls `podman` through passwordless `sudo`, and wires the containers' virtual links through the `nlc-netns-helper` helper.

> Skip this section if you do not use Container nodes.

> **Security note:** passwordless `sudo podman` amounts to giving the backend user root (for example `podman run --privileged -v /:/host`). Run NLC on a dedicated host.

### 6.1 Install Podman

```bash
sudo apt-get install -y podman
sudo podman info
```

### 6.2 Make the helper root-owned

The helper must be owned by `root` and **not writable** by the backend user; otherwise passwordless `sudo` on it becomes a way to escalate to root:

```bash
sudo chown root:root /opt/nlc/backend/addons/helper/nlc-netns-helper
sudo chmod 0755      /opt/nlc/backend/addons/helper/nlc-netns-helper
```

### 6.3 Install the sudoers rules

Two files are bundled: `deploy/nlc-podman.sudoers` (allows `podman`) and `deploy/nlc-netns-helper.sudoers` (allows the helper only). If needed, first change the user name and paths as described in [section 1](#1-install-directory-and-service-user), then install them:

```bash
sudo install -m 0440 /opt/nlc/deploy/nlc-podman.sudoers /etc/sudoers.d/nlc-podman
sudo install -m 0440 /opt/nlc/deploy/nlc-netns-helper.sudoers /etc/sudoers.d/nlc-netns-helper
sudo visudo -c
```

`visudo -c` must report both files as parsed OK.

### 6.4 Verify

As the backend user, neither of the following may ask for a password:

```bash
sudo -n podman --version
sudo -n /opt/nlc/backend/addons/helper/nlc-netns-helper 2>&1 | head -1   # prints the helper's usage
```

For importing container images, see [Getting Started](./01-getting-started.md).

---

## 7. Build and Start

Backend:

```bash
cd /opt/nlc/backend
npm install
npm run build
npm start       # listens on port 8080 by default
```

Frontend:

```bash
cd /opt/nlc/frontend
npm install
rm -rf .next/cache
npm run build
npm start       # listens on port 3000 by default
```

The backend keeps lab definitions in `backend/labs/`, saved device configurations in `backend/configurations/<labId>/` (one Markdown file per configuration, named after it), and node runtime files in `backend/running/` (deleted on unload). Include `labs/` and `configurations/` in your backups.

---

## 8. Production Deployment with systemd and Nginx

For a long-running server, run the frontend and backend as two systemd services behind Nginx.

### 8.1 Install the systemd units

The bundled units run as the `nlc` user and use `/usr/bin/node` as installed in [section 2](#2-base-dependencies). If Node.js lives elsewhere (for example installed with nvm), first change `ExecStart` in both unit files to match `which node`.

```bash
sudo cp /opt/nlc/deploy/nlc-backend.service /etc/systemd/system/
sudo cp /opt/nlc/deploy/nlc-frontend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nlc-backend nlc-frontend
```

Check status and logs:

```bash
sudo systemctl status nlc-backend nlc-frontend
journalctl -u nlc-backend -u nlc-frontend -f
```

### 8.2 Configure Nginx (HTTPS)

```bash
sudo apt-get install -y nginx
```

Generate a self-signed certificate (valid for one year). Replace `nlc.lab.com` and `192.168.56.129` with the server's hostname and IP:

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /etc/nginx/ssl/nlc.key -out /etc/nginx/ssl/nlc.crt \
  -subj "/CN=nlc" -addext "subjectAltName=DNS:nlc.lab.com,IP:192.168.56.129"
sudo chmod 600 /etc/nginx/ssl/nlc.key
```

Install the site configuration:

```bash
sudo cp /opt/nlc/deploy/nginx.conf /etc/nginx/sites-available/nlc
sudo ln -s /etc/nginx/sites-available/nlc /etc/nginx/sites-enabled/nlc
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

The site configuration redirects HTTP to HTTPS, proxies `/v1/` to the backend (8080) and everything else to the frontend (3000). If `nginx -t` reports `$connection_upgrade` as a duplicate, delete the `map` block at the top of the site configuration.

Then open `https://<server IP>`. Browsers do not trust a self-signed certificate, so on first visit choose to proceed past the warning. When the certificate expires, rerun the `openssl` command above and `sudo systemctl reload nginx`.

### 8.3 Backend URLs

Leave **Settings → Backend** at its defaults: Internal URL `http://localhost:8080`, Public URL empty. The browser derives the backend address from the page address and connects through Nginx's `/v1/` (see [Settings](./06-settings.md#public-url)).
