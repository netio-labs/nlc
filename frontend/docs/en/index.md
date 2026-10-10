# Welcome to NLC

NLC (Network Lab Conductor) is a network lab platform with a separate frontend and backend. It aims to be an orchestration platform for Cisco IOU/IOL and multi-vendor network containers (such as Arista cEOS, FRRouting, Juniper cRPD and Cisco XRd), so that researchers can quickly build and manage lab topologies, capture packets, and manage configuration files.

## Guide

- [Getting Started](./guide/01-getting-started.md) — first-time setup
- [Topology Editor](./guide/02-topo-editor.md) — add nodes, connect links, edit properties, save
- [Lab Operations](./guide/03-lab.md) — load, unload, start/stop nodes, apply topology changes, save and restore device configurations
- [Console](./guide/04-console.md) — browser terminal console and external telnet access
- [Packet Capture](./guide/05-capture.md) — live capture on netio links, with an in-browser viewer and Wireshark streaming
- [Settings](./guide/06-settings.md) — manage images and the runtime, the backend connection, and a browser shell to the server
- [Installation Guide](./guide/07-installation.md) — setting up the environment to install NLC on Linux by hand
- [Backend Internals](./guide/08-backend-internals.md) — the low-level mechanics at the command-line level (developer reference)

## API Reference

- [API Reference](./api/index.md) — all REST and WebSocket endpoints, request/response schemas, error codes

## License

NLC is released under the [GNU General Public License, version 3 (GPL-3.0-only)](https://www.gnu.org/licenses/gpl-3.0.html). The bundled third-party components `wrapper-linux` (`backend/addons/src/wrapper/`) and `ioulive86` (`backend/addons/src/ioulive86/`) keep their own GPL-2.0 licenses.

## Legal Notices

**No images are distributed.** NLC itself does not include, distribute, or provide any device image files. All technical information used by NLC comes from publicly available materials on the Internet.

**Images and licenses.** The images and licenses needed to run devices must be obtained lawfully by the user. NLC does not circumvent any licensing mechanism, nor does it help obtain images or licenses.

**Compliance.** NLC is intended mainly for learning and research. Users are solely responsible for ensuring that their use of any image complies with all applicable laws, regulations, and the relevant vendors' license terms.
