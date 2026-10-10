# Console

NLC gives every node in a lab a browser-based terminal console, implemented with xterm.js over WebSocket. No SSH client or external terminal emulator is needed.

## Opening the Console

Click the **Console** button in the General panel of the topology viewer. This opens the console page in a new browser tab, scoped to the current lab.

> The Console button is only available when the lab is loaded.

## Interface

The console page has a tab bar at the top, with one tab per node in the lab. Tabs are separated by vertical bars. The active tab is highlighted in yellow.

Click a tab to open a terminal session for that node. A terminal connects only the first time you click its tab — inactive tabs hold no connection.

## Connecting to a Node

The first time you click a tab, NLC:

1. Sends a reset request to the node's console port (the same as the **Reset Console** button in the topology viewer).
2. Opens a WebSocket connection to the backend console proxy.
3. Attaches an xterm.js terminal to that connection.

The terminal shows these status messages:

- `Resetting console…` — resetting
- `Connected.` — the WebSocket is open and the terminal is ready
- `Disconnected.` — the WebSocket closed (node stopped, lab unloaded, or a network problem)
- `WebSocket error.` — the connection failed

## Resetting a Console Session

Each tab has a small reset button (circular-arrow icon) to the right of the node name. Clicking it:

1. Resets the node's console port on the backend.
2. Closes the existing WebSocket connection.
3. Opens a new terminal and reconnects.

This helps when a console session stops responding or hangs (for example after a node reload).

## Terminal Behavior

- The terminal resizes automatically to fit the browser window.
- Input is sent over the WebSocket character by character.
- Output streams in real time.
- Standard ANSI escape sequences and color codes are supported.
- Default font size 14px, adjustable (zoom in, zoom out, reset) from the right-click menu; dark background (`#18181b`).

## Connecting with an External Terminal

Every node's console port is exposed as a standard telnet port. To connect with any terminal emulator (for example PuTTY, SecureCRT, or the system `telnet` command):

1. Click the node in the topology viewer to see its details in the left panel.
2. Note the **Console port** value shown there.
3. Connect with telnet:

```bash
telnet <BACKEND_IP> <console_port>
```

If the connection is refused or the terminal does not respond, click **Reset Console** in the left panel to reset the port, then try again.
