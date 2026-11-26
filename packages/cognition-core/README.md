# @ai0/cognition-core · 状态与认知

本包提供状态域裁决、连续状态演进、虚拟时间和模型路由。宿主决定有哪些状态域、谁可以提出变更，以及各域如何应用提案。daemon 的数字生命配置使用这些入口装配五个黑板域，并在宿主侧连接持久化。[公共导出](src/index.ts) · [daemon 状态协调器](../../apps/daemon/src/profiles/digital-life/state.ts)

## 接入点与消费者

| 接入点 | 谁提供、谁使用 |
| --- | --- |
| `StateDomainArbiter` | 域所有者用 `register` 注册读写处理器，或用 `registerValue` 注册初值与归约函数。宿主用 `bind` 注入调用方的读取、提案和证据权限。调用方携带 `base_rev` 提交提案，成功后取得新的域版本和全局版本。[状态域裁决](src/coordinator/state-domain-arbiter.ts) |
| `cognitionProposalPolicyFacet` | 扩展按域提供审查策略。宿主把 `mountedProposalPolicies` 注入裁决器，已获准的策略可拒绝提案或调整载荷。域处理器最终应用变更。[策略组装](src/coordinator/proposal-policies.ts) |
| `MountedContinuousStates` | 扩展用 `cognitionStateDynamicsFacet` 声明状态轴。宿主传入扩展主机和时钟，读取快照或应用状态变化。只有一个活跃提供方的轴才进入快照，未挂载状态切面时快照中的 `values` 为空。[连续状态域](src/state-engine/continuous-domain.ts) · [陪伴扩展示例](../../plugins/cognitive-organs/companion-homeostasis/src/index.ts) |
| `IVirtualClock`、`VirtualClock` | 运行组件通过时钟读取当前时间或扣除冬眠区间后的经过时间。LIVE 使用墙钟，沙箱可显式推进虚拟时间。[时钟实现](src/clock/virtual-clock.ts) |
| `BrainRegionRouter`、`ProfiledInferenceClient` | 宿主提供角色名、候选模型及可选选择策略。需要结构化推理时，调用方注入请求与响应契约和传输实现。[路由](src/router/brain-region-router.ts) · [结构化推理](src/router/structured-profile.ts) |

需要扩展黑板上下文时，通过 SDK 贡献 `cognitionContextContributorFacet`，由 daemon 的 worker 调用。需要定制话轮回复时，贡献 `cognitionResponseContractFacet`，由渠道推理按契约 ID 和受众选择实现。[切面定义](src/facets/index.ts) · [worker 接线](../../apps/daemon/src/profiles/digital-life/workers.ts) · [回复契约选择](../../apps/daemon/src/channel-inference.ts)

## 验证

从仓库根目录执行以下命令，检查状态域裁决、连续状态和模型路由。

```sh
pnpm exec vitest run packages/cognition-core
```

[状态域测试](src/coordinator/state-domain-arbiter.test.ts) 演示如何从空裁决器注册独立域、绑定权限，并检查陈旧提案的结果。
