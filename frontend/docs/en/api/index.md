# API Reference

Base URL: `http://localhost:8080/v1`

All HTTP responses share the same envelope:

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Human-readable description." } }
```

WebSocket endpoints use the same base host with the `ws://` scheme.

All endpoints require authentication except those under `/v1/auth/`. Pass the token from `POST /v1/auth/login` as `Authorization: Bearer <token>`, or as an `nlc-token` cookie. Requests without a valid token receive `401` with `{ "error": { "message": "Unauthorized" } }` (missing token) or `{ "error": { "message": "Invalid token" } }` (invalid/expired token) — these two error responses do not use the `ok`/`data` envelope.

---

## Endpoints

Endpoints are grouped by resource:

| Group | Path prefix | Contents |
|---|---|---|
| [Auth](./01-auth.md) | `/v1/auth` | Login and token issuance |
| [User](./02-user.md) | `/v1/user` | Change password |
| [Images](./03-images.md) | `/v1/image` | List, upload, delete IOU images; IOU/IOL key; container images and catalog |
| [Host](./04-host.md) | `/v1/host` | Server interfaces, browser shell (WS) |
| [Labs](./05-labs.md) | `/v1/labs` | Create, read, update, delete, import/duplicate, load/unload |
| [Nodes](./06-nodes.md) | `/v1/labs/:labId/nodes` | Start, stop, reset nodes; wipe container data; console (WS) |
| [Captures](./07-captures.md) | `/v1/labs/:labId/captures` | Start, stop, list packet captures; live stream (WS) |
| [Configurations](./09-configs.md) | `/v1/labs/:labId/configs` | Save device configs as named configurations, import/export (Markdown), replace the devices' startup configs with one |
| [Lab Spec](./08-lab-spec.md) | — | The lab topology JSON document: node types, profiles, and link kinds |
