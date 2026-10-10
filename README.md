# Network Lab Conductor (NLC)

English | [简体中文](./README.zh-CN.md)

NLC (Network Lab Conductor) is a network lab platform with a separate frontend and backend. It aims to be an orchestration platform for Cisco IOU/IOL and multi-vendor network containers (such as Arista cEOS, FRRouting, Juniper cRPD and Cisco XRd), so that researchers can quickly build and manage lab topologies, capture packets, and manage configuration files.

## Screenshots

**Lab list** — manage all your lab topologies in one place

![Lab list](./frontend/docs/assets/home.png)

**Topology editor** — add nodes, connect links, set node properties

![Topology editor](./frontend/docs/assets/editor.png)

**Topology viewer** — run labs, check node status, manage device configurations

![Topology viewer](./frontend/docs/assets/viewer.png)

**Console** — work on devices right in the browser

![Console](./frontend/docs/assets/console.png)

**Packet capture** — watch packets on a link in real time

![Packet capture](./frontend/docs/assets/capture.png)

## Guide

- [Getting Started](./frontend/docs/en/guide/01-getting-started.md) — first-time setup
- [Topology Editor](./frontend/docs/en/guide/02-topo-editor.md) — add nodes, connect links, edit properties, save
- [Lab Operations](./frontend/docs/en/guide/03-lab.md) — load, unload, start/stop nodes, apply topology changes, save and restore device configurations
- [Console](./frontend/docs/en/guide/04-console.md) — browser terminal console and external telnet access
- [Packet Capture](./frontend/docs/en/guide/05-capture.md) — live capture on netio links, with an in-browser viewer and Wireshark streaming
- [Settings](./frontend/docs/en/guide/06-settings.md) — manage images and the runtime, the backend connection, and a browser shell to the server
- [Installation Guide](./frontend/docs/en/guide/07-installation.md) — setting up the environment to install NLC on Linux by hand
- [Backend Internals](./frontend/docs/en/guide/08-backend-internals.md) — the low-level mechanics at the command-line level (developer reference)

## API Reference

- [API Reference](./frontend/docs/en/api/index.md) — all REST and WebSocket endpoints, request/response schemas, error codes

## License

NLC is released under the [GNU General Public License, version 3 (GPL-3.0-only)](./LICENSE). The bundled third-party components `wrapper-linux` (`backend/addons/src/wrapper/`) and `ioulive86` (`backend/addons/src/ioulive86/`) keep their own GPL-2.0 licenses.

## Legal Notices

**No images are distributed.** NLC itself does not include, distribute, or provide any device image files. All technical information used by NLC comes from publicly available materials on the Internet.

**Images and licenses.** The images and licenses needed to run devices must be obtained lawfully by the user. NLC does not circumvent any licensing mechanism, nor does it help obtain images or licenses.

**Compliance.** NLC is intended mainly for learning and research. Users are solely responsible for ensuring that their use of any image complies with all applicable laws, regulations, and the relevant vendors' license terms.
