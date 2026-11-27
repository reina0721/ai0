# `@ai0/agent-runtime`

无头通用智能体双环运行时（Headless Universal Agent Runtime），在不引入任何 UI、HTTP 网关、SQLite 存储或领域人设预设的前提下，将五核（`@ai0/extension-core`、`@ai0/perception-core`、`@ai0/cognition-core`、`@ai0/agent-core`、`@ai0/expression-core`）组装为完整的 `感知 -> 状态/目标 -> 上下文 -> 策略门控 -> 内环/异步行动 -> 双轨反馈 -> 表达` 闭环：

- `./kernel`（L0 纯闭环控制原语）：`UniversalAgentLoop`，管理运行生命周期、通道级并发串行与主动打断取消（`AbortSignal`），支持感知与表达阶段零延迟直通旁路。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 多核组合运行时）：`ComposedAgentRuntime`（`createUniversalAgent`），直接复用现有五核契约，支持 `"direct_inline"`（纯编码/任务 Agent 直通模式）与 `"dual_speed_w1_w2"`（具身/伴侣快慢分流模式）。[L1 入口](src/subsystems/index.ts)
