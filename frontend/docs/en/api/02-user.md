[← API Reference](./index.md)

# User

## `POST /v1/user/change-password`

Change the current user's password. This is a single-user system — there is no username in the request body.

**Request body**

```json
{ "currentPassword": "changeme", "newPassword": "newSecret123" }
```

**Response `200`**

```json
{ "ok": true, "data": { "updated": true } }
```

**Error codes**

| Code                 | Status | Description                              |
| -------------------- | ------ | ----------------------------------------- |
| `INVALID_INPUT`      | 400    | `currentPassword` or `newPassword` missing |
| `PASSWORD_TOO_SHORT` | 400    | `newPassword` is shorter than 4 characters |
| `INVALID_PASSWORD`   | 401    | `currentPassword` does not match           |

