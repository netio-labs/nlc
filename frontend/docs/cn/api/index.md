# API 参考

基础 URL：`http://localhost:8080/v1`

所有 HTTP 响应使用相同的外层结构：

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Human-readable description." } }
```

WebSocket 接口使用相同的主机，scheme 为 `ws://`。

除 `/v1/auth/` 下的接口外，所有接口都需要认证。将 `POST /v1/auth/login` 返回的 token 以 `Authorization: Bearer <token>` 形式传入，或放在 `nlc-token` cookie 中。没有有效 token 的请求会收到 `401`，响应为 `{ "error": { "message": "Unauthorized" } }`（缺少 token）或 `{ "error": { "message": "Invalid token" } }`（token 无效或已过期）——这两种错误响应不使用 `ok`/`data` 外层结构。

---

## 接口列表

接口按资源分组：

| 分组 | 路径前缀 | 内容 |
|---|---|---|
| [认证](./01-auth.md) | `/v1/auth` | 登录与签发 token |
| [用户](./02-user.md) | `/v1/user` | 修改密码 |
| [镜像](./03-images.md) | `/v1/image` | 列出、上传、删除 IOU 镜像；IOU/IOL 密钥；容器镜像与容器支持库 |
| [主机](./04-host.md) | `/v1/host` | 服务器网络接口、浏览器 Shell（WS） |
| [Lab](./05-labs.md) | `/v1/labs` | 创建、读取、更新、删除、导入/复制、加载/卸载 |
| [节点](./06-nodes.md) | `/v1/labs/:labId/nodes` | 启动、停止、重置节点；清空容器数据；控制台（WS） |
| [抓包](./07-captures.md) | `/v1/labs/:labId/captures` | 启动、停止、列出抓包；实时数据流（WS） |
| [配置](./09-configs.md) | `/v1/labs/:labId/configs` | 将设备配置保存为具名配置，导入/导出（Markdown），用某个配置替换设备的启动配置 |
| [Lab 规格](./08-lab-spec.md) | — | Lab 拓扑 JSON 文档：节点类型、Profile 与链路类型 |
