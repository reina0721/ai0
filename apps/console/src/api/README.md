# 控制台 HTTP 与 SSE 客户端

本目录负责浏览器与 daemon 之间的传输。页面一般从 `useConsole()` 取已绑定当前实例和 Owner 令牌的操作。要修改端点、请求头、错误转换或断连行为，从客户端和消费它的 Provider 一起看。[客户端](client.ts) · [共享上下文](../context/README.md)

| 入口 | 调用约定 |
| --- | --- |
| `fetchBootstrap(mode, signal?)` | 启动时读取 `/api/studio/bootstrap`，需要同时返回快照和 Owner 令牌。502、503、504 会转成 `BootstrapUnavailableError`，由 Provider 安排重试。 |
| `fetchSnapshot(mode)` | 按模式读取最新的 `ConsoleLiveSnapshot`。缓存和响应先后顺序由 Provider 管理。[快照结构](../live-snapshot.ts) |
| `getJson`、`postJson`、`patchJson`、`putJson`、`deleteJson` | 传入令牌时添加 `x-ai0-owner-token`。这些函数期望成功响应包含 JSON，HTTP 错误会抛出服务端的错误信息或状态码。 |
| `subscribeTelemetryStream(onFrame)` | 订阅 `/api/admin/v1/telemetry/stream`，把可解析帧交给回调。调用返回的函数关闭连接。静态渲染环境缺少 `EventSource` 时也可调用清理函数。 |

修改启动响应或快照形状时，同步检查 daemon 路由与前端类型。通过仓库根目录的 `pnpm exec vitest run apps/console/src/console-m6.test.ts` 可以验证快照在外壳中的渲染。[daemon HTTP 路由](../../../daemon/src/cli.ts) · [渲染测试](../console-m6.test.ts)
