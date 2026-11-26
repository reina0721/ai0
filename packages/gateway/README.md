# @ai0/gateway · 通道与管理网关

宿主通过两个入口接入网关。Channel A 的 `ChannelProtocolGateway` 管理具身通道会话、感知输入和表达回执。Channel B 的 `PrivilegedAdminServer` 验证 Owner 凭据，并把管理操作派发给宿主提供的处理器。[包入口](src/index.ts) · [daemon 装配](../../apps/daemon/src/index.ts)

## Channel A 接入通道

1. 宿主使用 `issueScopedCapabilityToken` 签发通道令牌。通道在 `HandshakeManifest` 中携带令牌，调用 `handleInboundHandshake` 后取得 `session_id`。握手校验通道身份和有效期，以授权范围约束受众和传感器，并将端点挂到感知注册表和表达协商器。[会话与握手](src/channel-ws-server.ts)
2. 调用 `handlePerception(sessionId, envelope)` 发送上行事件。从返回值的 `committed` 读取可提交的批次。宿主可通过 `ChannelProtocolGatewayOptions` 注入时钟及 `extensionHost`，注册的感知过滤器可以改写、暂存或抑制事件。未挂过滤器时，会话使用宿主配置的去抖窗口。[感知层](../perception-core/README.md)
3. 调用 `dispatchExpression` 登记每个表达分块，可注入 `sendExpression` 对接传输。分块从 0 连续编号，重复或乱序会被拒绝。端点回报后调用 `handleDeliveryReceipt`，网关将结算出的打断记录转给注入的 `w1.recordInterruption`。[表达层](../expression-core/README.md)

部署时，daemon 在 `/protocol/v0/channel` 下暴露连接、感知与回执路由，并提供 HTTP/SSE 桥接。增加传输入口时可复用上述会话方法。[部署路由](../../apps/daemon/src/cli.ts)

## Channel B 接入管理操作

宿主用 `ownerToken` 和按 `AdminOperation` 索引的 `handlers` 构造 `PrivilegedAdminServer`。新增操作时，在网关路由表声明路径及方法，在 daemon 实现对应的 `AdminRouteHandler`。处理器从上下文取得已解析的参数和 `target_instance`。请求通过认证且命中路由后，若无对应处理器或回退处理器，网关返回 501。[路由表与处理器契约](src/admin-api-server.ts) · [daemon 管理处理器](../../apps/daemon/src/admin-handlers.ts)

`handleRequest` 先检查 Owner 令牌，再区分 live 与 sandbox。live 上的手动推进时钟和沙箱注入会返回 403。程序内消费者可用 `subscribeTelemetry` 订阅操作遥测，返回的函数用于取消订阅。部署探针 `/healthz`、`/readyz` 由 daemon 注册。[管理入口](src/admin-api-server.ts) · [探针与 SSE](../../apps/daemon/src/cli.ts)

在仓库根目录运行双平面测试，验证会话权限、过滤器挂载与卸载、回执结算和管理操作隔离。

```sh
pnpm exec vitest run packages/gateway/src/gateway-m5.test.ts
```
