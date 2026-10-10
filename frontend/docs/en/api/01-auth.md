[← API Reference](./index.md)

# Auth

## `POST /v1/auth/login`

Log in with username and password. Does not require an existing token.

**Request body**

```json
{ "username": "admin", "password": "changeme" }
```

**Response `200`**

```json
{ "ok": true, "data": { "token": "<jwt>" } }
```

The token expires after 30 days.

**Response `401`** (missing/invalid credentials — not wrapped in the standard envelope)

```json
{ "error": { "message": "Invalid credentials" } }
```

