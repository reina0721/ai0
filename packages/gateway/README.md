# @ai0/gateway · 双平面协议网关（L0 Kernel + L1 Subsystems）

`@ai0/gateway` 采用双层微内核分层，所有令牌与会话过期校验均统一由注入的 `VirtualClock` 驱动（零裸调 `Date.now()`）：
- `./kernel`（L0 不可约内核）：HMAC-SHA256 `ScopedCapabilityToken` 签发/验签与受众隐私天花板求交（`intersectAudienceScope`）。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 治理子系统）：Channel A `ChannelProtocolGateway`（可配置 `entityNature`，默认 `"artificial_intelligence_agent"`）与 Channel B `PrivilegedAdminServer`。[L1 入口](src/subsystems/index.ts)

## 验证

```sh
pnpm exec vitest run packages/gateway
```
