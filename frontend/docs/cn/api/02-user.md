[← API 参考](./index.md)

# 用户

## `POST /v1/user/change-password`

修改当前用户的密码。本系统为单用户系统——请求体中没有用户名。

**请求体**

```json
{ "currentPassword": "changeme", "newPassword": "newSecret123" }
```

**响应 `200`**

```json
{ "ok": true, "data": { "updated": true } }
```

**错误码**

| 错误码               | 状态码 | 说明                                      |
| -------------------- | ------ | ----------------------------------------- |
| `INVALID_INPUT`      | 400    | 缺少 `currentPassword` 或 `newPassword`    |
| `PASSWORD_TOO_SHORT` | 400    | `newPassword` 少于 4 个字符                |
| `INVALID_PASSWORD`   | 401    | `currentPassword` 不正确                   |
