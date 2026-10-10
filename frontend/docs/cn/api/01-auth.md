[← API 参考](./index.md)

# 认证

## `POST /v1/auth/login`

使用用户名和密码登录。不需要已有 token。

**请求体**

```json
{ "username": "admin", "password": "changeme" }
```

**响应 `200`**

```json
{ "ok": true, "data": { "token": "<jwt>" } }
```

token 在 30 天后过期。

**响应 `401`**（凭据缺失或无效——不使用标准外层结构）

```json
{ "error": { "message": "Invalid credentials" } }
```
