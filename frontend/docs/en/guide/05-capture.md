# Packet Capture

NLC supports live packet capture on lab links (except container links). Captured traffic can be viewed directly in the browser or streamed to an external Wireshark instance.

## How It Works

NLC intercepts traffic at the **netio** layer — the Unix datagram sockets IOU/IOL nodes use to exchange frames. When you start a capture on a link, NLC inserts a transparent proxy between the two endpoints. Every frame passing through is copied to the capture stream without affecting lab traffic.

Because this works below the interface layer, it covers all netio links, including serial (HDLC, PPP, Frame Relay) and Ethernet links. Links to containers are kernel veths that do not go through netio, so they cannot be captured.

## Starting a Capture

1. Open the lab's topology viewer.
2. Click a **link** (edge) on the canvas. The General panel on the left switches to capture mode.
3. If the link is part of a **multilink** bundle, use the link selector buttons to pick the link to capture.
4. Choose the **encapsulation** that matches the link:
   - **Ethernet** — for L2 Ethernet links (default)
   - **PPP** — for PPP serial links
   - **HDLC** — for HDLC serial links
   - **Frame Relay** — for Frame Relay links
5. Click **Start Capture**.

Each capture session is assigned an ID and a TCP port. Several captures can run at the same time, on the same or different links.

## Viewing Captures

### In-Browser Viewer (recommended)

Click the **View** button next to any active capture (in the General panel or the Captures tab). This opens a dedicated capture viewer page with a Wireshark-like layout:

- **Packet list** — frame number, timestamp, source, destination, protocol, length and info, with Wireshark coloring rules.
- **Protocol tree** — click any row to expand the full dissection tree, like Wireshark's middle pane.
- **Hex dump** — the raw bytes, shown next to the protocol tree.
- **Display filter** — enter a Wireshark display filter expression (e.g. `tcp`, `ip.addr == 10.0.0.1`, `ospf`) and press Enter or click **Apply** to filter the packet list.

The viewer connects over WebSocket and receives packets in real time. Packets are dissected on the server by **sharkd** (the Wireshark daemon), so every Wireshark dissector is available.

### External Wireshark via TCP Stream

Each capture also exposes a raw pcap TCP stream that can be piped straight into Wireshark. Replace `<BACKEND_IP>` with the IP address of the NLC backend host and `<PORT>` with the port shown in the capture panel.

**Windows (WSL — recommended)**

```bash
wsl nc <BACKEND_IP> <PORT> | "C:\Program Files\Wireshark\Wireshark.exe" -k -i -
```

**Windows (ncat)**

```bash
ncat -v <BACKEND_IP> <PORT> | "C:\Program Files\Wireshark\Wireshark.exe" -k -i -
```

**macOS / Linux**

```bash
nc <BACKEND_IP> <PORT> | wireshark -k -i -
```

> The TCP stream is in standard pcap format. Only one external client can be connected to a capture port at a time. To watch from several places at once, use the in-browser viewer.

## Managing Captures

The **Captures** tab in the topology viewer lists all active captures for the current lab. From there you can:

- **View** — open the capture in the in-browser viewer.
- **Stop** — end the capture and release its port.

When a link is selected, the General panel also lists captures, but only those on that link.

## Stopping a Capture

Click **Stop** next to a capture in the General panel or the Captures tab. The TCP port is released and the capture session is destroyed. Any open in-browser viewer disconnects automatically.

A capture also stops automatically when:

- The lab is **unloaded**.
- A **node** on either end of the link is stopped.

## Encapsulation Reference

| Encapsulation | DLT value | Typical use                       |
| ------------- | --------- | --------------------------------- |
| Ethernet      | 1         | L2 Ethernet; default for most links |
| PPP           | 9         | PPP serial links                  |
| HDLC          | 104       | Cisco HDLC serial links           |
| Frame Relay   | 107       | Frame Relay serial links          |

Choosing the wrong encapsulation makes Wireshark misdissect the frames. If unsure, check the interface encapsulation on the node (`show interface`).
