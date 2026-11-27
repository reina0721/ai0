# Daemon 薄宿主运行时装配

`@ai0/daemon` 是纯粹的薄宿主接线层（Thin Wiring Host），不包含任何特定人设策略单体目录。`createDefaultDaemonRuntime(options)` 负责将七个分层有状态包（`@ai0/extension-core`、`@ai0/agent-core`、`@ai0/perception-core`、`@ai0/cognition-core`、`@ai0/expression-core`、`@ai0/storage`、`@ai0/gateway`）与 `plugins/` 下的可插拔扩展装配为完整运行时。[装配入口](src/index.ts)

| 宿主模块 | 职责 |
| --- | --- |
| 话轮协调与呈现 | 连接 `@ai0/cognition-core` 协调器/黑板、`@ai0/perception-core` 覆盖桶与 `@ai0/expression-core` 协商器。[话轮协调](src/turn-coordinator.ts) · [具身呈现](src/embodied-presentation.ts) |
| 四层权威推理适配 | 将黑板与输入严格隔离到 `system_invariant`、`developer_frame`、`untrusted_observation` 与 `user` 四个通道，支持多步工具调用与结构化输出收敛。[推理适配](src/channel-inference.ts) · [通道路由](src/channel-runs.ts) |
| 插件与多态载体加载 | 扫描 `plugins/`、`SKILL.md`、MCP 与 `.flow.yaml`，委托 `@ai0/sdk` 的 `mountCarrierProjections` 挂载切面。[加载器](src/plugin-loader.ts) · [载体投影接线](src/carrier-projections.ts) |
| 管理面与回归回放 | 为 Owner 控制台提供管理路由、资产脱敏导出与黄金回归场景回放。[管理处理器](src/admin-handlers.ts) · [资产脱敏](src/asset-bundler.ts) · [回归回放](src/scenario-runner.ts) |

## 验证

```bash
pnpm exec vitest run apps/daemon
```
