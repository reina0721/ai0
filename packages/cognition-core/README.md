# @ai0/cognition-core · 通用状态化认知（L0 Kernel + L1 Subsystems）

`@ai0/cognition-core` 采用双层微内核分层，不包含任何伴侣人设或特定产品预设：
- `./kernel`（L0 不可约认知原语）：`VirtualClock`、`StateDomainArbiter`（MVCC 乐观并发与权限裁决）、`ContinuousStateMetaEngine`（阿贝尔群交换律与解析半衰期衰减，默认 `descriptors = []`）、`BrainRegionRouter` 与 `ProfiledInferenceClient`。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 通用认知治理子核）：五域状态协调器（`AuthoritativeStateCoordinator`）、四级认识论记忆防火墙（`EpistemicMemoryFirewall`）与 `CommonGround`（`proposed_presented → mutually_grounded`）状态机、三维污点与受众门控（`CapabilityPolicyGate`）、受众隔离黑板编译器（`BlackboardCompiler`）、`MetabolicRegionRouter`、Tier-0 安全守卫、UMO 会话路由器及异步任务/睡眠巩固循环（`W2AgencyTaskWorker`、`W3SleepReflectionWorker`）。[L1 入口](src/subsystems/index.ts)

## 接入点与消费者

| 接入点 | 谁提供、谁使用 |
| --- | --- |
| `StateDomainArbiter` / `AuthoritativeStateCoordinator` | L0 提供通用 MVCC 域裁决；L1 装配标准五域（`D1_WORKING_TURN`、`D2_CONTINUOUS_STATES`、`D3_MEMORY_PROJECTION`、`D4_COMMITMENTS_TASKS`、`D5_IDENTITY_NARRATIVE`）与认识论防火墙。[状态域裁决](src/kernel/state-domain-arbiter.ts) · [认知协调器](src/subsystems/cognitive-coordinator.ts) |
| `cognitionProposalPolicyFacet` | 扩展按域注入提案审查策略（如反操控护栏或容量限制）。[策略组装](src/subsystems/proposal-policies.ts) |
| `cognitionStateDynamicsFacet` | 扩展按需声明连续状态轴（未挂载时 `D2_CONTINUOUS_STATES.values` 为 `{}`）。[连续状态域](src/subsystems/continuous-domain.ts) · [稳态插件示例](../../plugins/cognitive-organs/companion-homeostasis/src/index.ts) |
| `cognitionContextContributorFacet` / `cognitionResponseContractFacet` / `cognitionSleepOrganFacet` / `cognitionAttentionArbitratorFacet` | 扩展向黑板提供受众安全槽位、声明结构化响应契约、参与睡眠巩固或跨通道焦点仲裁。[切面定义](src/subsystems/facets.ts) |

## 验证

```sh
pnpm exec vitest run packages/cognition-core
```
