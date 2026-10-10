[← API Reference](./index.md)

# Configurations

Saved device configurations of a lab. A **configuration** is one Markdown document holding the startup config of each device, keyed by device name, and is identified by its **name** (unique within the lab); the same document is what you download and upload. Configurations live in `backend/configurations/<labId>/<name>.md` — outside the lab spec — so they survive Unload and are not touched by saving the topology.

Only IOU devices (their nvram) and Virtual PCs (their `startup.cfg`) take part; IOULive86 and container nodes are ignored.

## Configuration document

````markdown
# lesson 3

- Lab: OSPF lab
- Saved: 2026-09-29 10:15:00

## r1

- Type: iouRouter

```text
!
hostname r1
banner motd ^CAuthorized only^C
...
```

## pc1

- Type: vpc

```text
hostname pc1
ip address dhcp
```
````

- Each `## <device name>` section is one device; the **first** fenced code block under it is the config. Everything else (the `- Type:` line aside) is ignored by NLC and kept as-is, so the file can carry notes or lab instructions.
- `Type` is the node profile (`iouRouter`, `iouSwitch`, `vpc`); a mismatch with the lab's device is reported but not fatal.
- An **empty** code block means "this device should be blank": a replace erases its config.
- Banner delimiters, stored by IOS as the control character `0x03`, appear as `^C` and are converted back when the configuration is written to the device.

## Match report

Returned by import, preview and edit, comparing the document with the lab's devices:

```json
{
  "matched": [{ "name": "r1", "type": "iouSwitch", "nodeType": "iouRouter", "typeMismatch": true }],
  "notInLab": ["ghost"],
  "notInConfig": ["s1", "r3"],
  "duplicates": ["pc1"]
}
```

| Field | Meaning |
|---|---|
| `matched` | Devices found in both. |
| `notInLab` | Sections with no device of that name in the lab (ignored). |
| `notInConfig` | Lab devices without a section (left unchanged by replace). |
| `duplicates` | Names used by more than one device in the lab or more than one section in the document — skipped, since the target is ambiguous. |

---

## `GET /v1/labs/:labId/configs`

List the lab's configurations, newest first, and the name of the one last used to replace the devices' configs (`current`, `null` if none).

**Response `200`**

```json
{
  "ok": true,
  "data": {
    "current": "lesson 3",
    "configs": [{ "name": "lesson 3", "modifiedAt": "2026-09-29T02:15:00.000Z", "devices": 4 }]
  }
}
```

---

## `POST /v1/labs/:labId/configs`

Save the devices' current startup configs as a configuration named `name`. Reads each IOU device's nvram and each Virtual PC's `startup.cfg`, so run `write memory` / `save` on the devices first. The lab must be loaded (nodes may be running or stopped).

**Request body**

```json
{ "name": "lesson 3", "overwrite": false }
```

`name` becomes the file name: 1–80 characters, any language, without `/`, `\` or a leading dot; `replace` and `import` are reserved.

**Response `201`**

```json
{
  "ok": true,
  "data": {
    "name": "lesson 3",
    "devices": [
      { "name": "r1", "type": "iouRouter", "status": "saved" },
      { "name": "r2", "type": "iouRouter", "status": "empty" }
    ],
    "duplicates": []
  }
}
```

| `status` | Meaning |
|---|---|
| `saved` | Included in the configuration. |
| `empty` | Nothing saved on the device yet (`write memory` / `save` not run) — not included. |
| `unreadable` | nvram could not be read (`detail` says why; a checksum mismatch usually means it was read while the device was writing — retry). |

`duplicates` lists device names shared by several devices; they are saved, but importing or replacing with that name will be ambiguous.

---

## `POST /v1/labs/:labId/configs/import`

Store an uploaded Markdown document as a configuration named `name` (kept verbatim) and report how it matches the lab.

**Request body**

```json
{ "name": "lesson 3", "markdown": "# lesson 3\n...", "overwrite": false }
```

**Response `201`** — `data` is a [match report](#match-report).

---

## `GET /v1/labs/:labId/configs/:name`

**Response `200`**

```json
{ "ok": true, "data": { "name": "lesson 3", "markdown": "# lesson 3\n...", "report": { "matched": [], "notInLab": [], "notInConfig": [], "duplicates": [] } } }
```

## `PUT /v1/labs/:labId/configs/:name`

Replace the Markdown of an existing configuration (editing). Body: `{ "markdown": "..." }`. Returns `{ "name", "report" }`.

## `DELETE /v1/labs/:labId/configs/:name`

Delete a configuration. The devices keep their current configuration; if its name was `current`, `current` becomes `null`.

---

## `POST /v1/labs/:labId/configs/replace`

Replace the startup configuration of the lab's **stopped** devices with their sections in the configuration `name` — like IOS `configure replace`, each device's config is replaced as a whole, not merged: IOU nvram is regenerated from the config, a Virtual PC's `startup.cfg` is overwritten. The next start boots from it, and the device then behaves like real hardware — `write memory` replaces it, `erase startup-config` leaves the device blank. The lab must be loaded. If at least one device was written (or cleared), `current` is set to `name`.

**Request body**

```json
{ "name": "lesson 3" }
```

**Response `200`**

```json
{
  "ok": true,
  "data": {
    "name": "lesson 3",
    "devices": [
      { "name": "r1", "type": "iouRouter", "status": "written" },
      { "name": "r2", "type": "iouRouter", "status": "running" }
    ]
  }
}
```

| `status` | Meaning |
|---|---|
| `written` | Config written; `typeMismatch: true` if the section's `Type` differs from the device. |
| `cleared` | The section's code block is empty: the device's config was erased. |
| `not-in-config` | No section for this device: left unchanged. |
| `running` | Device is running: skipped (stop it and replace again). |
| `duplicate` | Ambiguous name: skipped. |
| `error` | Could not write (`detail`), e.g. the config is larger than the device's nvram. |

---

## Error codes

| Code | Status | Description |
|---|---|---|
| `LAB_NOT_FOUND` | 404 | No such lab |
| `INVALID_CONFIG_NAME` | 400 | Name empty, too long, containing `/` `\` or control characters, starting with a dot, or reserved |
| `INVALID_BODY` | 400 | `markdown` missing or not a string |
| `CONFIG_NOT_FOUND` | 404 | No configuration with that name |
| `CONFIG_EXISTS` | 409 | A configuration with that name exists and `overwrite` was not `true` |
| `LAB_NOT_LOADED` | 409 | Save / replace need the lab to be loaded |
| `NO_CONFIG_TO_SAVE` | 422 | No device has a saved config (nothing to put in a configuration) |
