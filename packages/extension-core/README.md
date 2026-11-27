# @ai0/extension-core · 扩展微内核与服务目录（L0 Kernel + L1 Subsystems）

`@ai0/extension-core` 采用双层微内核分层：
- `./kernel`（L0 不可约内核）：`defineFacetPoint`、`defineServiceContract` 与基于 Cordis Fiber 的 `ExtensionComposition` 组合生命周期原语。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 治理子系统）：`ExtensionCoreHost`（包级权限、配置版本 `rev` 与异常隔离）、`ServiceDirectory`（支持双边静态输入/输出契约校验，即使原契约定义者未挂载也可由活跃替代提供方满足依赖）与 `extensionAssetCodecFacet`。[L1 入口](src/subsystems/index.ts)

## 验证

```sh
pnpm exec vitest run packages/extension-core
```
