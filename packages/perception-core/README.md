# @ai0/perception-core · 结构化感知（L0 Kernel + L1 Subsystems）

`@ai0/perception-core` 采用双层微内核分层：
- `./kernel`（L0 不可约内核）：`UniversalObservationFrame` 六元组元语法、感官覆盖桶（`SensoryCoverageBucketManager`）TTL 与 `"blind"` 锁、`ScopedContextRegistry` 受众隔离、`TurnLifecycleGate`（`activity|interim|commit|retract`）及冬眠扣除时间感知。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 治理子系统）：具身能力可供性注册表（`EmbodimentAffordanceRegistry`）、`perceptionIngressFacet`（`perception.ingress@1`）、`perceptionSourceFacet`（`perception.source@1`）、`perceptionExtractorFacet`、`perceptionFilterFacet` 与 `PerceptionFilterPipeline`。[L1 入口](src/subsystems/index.ts)

## 接入一条观察

1. 通道提交 `PerceptionEnvelope`，通过 `perceptionIngressFacet` 声明上行通道能力；`ObservationNormalizer` 注入 `PerceptionClockPort`，外部观察统一标记为 `untrusted_utterance`。[观察语法](src/kernel/observation-grammar.ts)
2. 插件通过 `perceptionExtractorFacet` 解析自定义模态载荷，或通过 `perceptionFilterFacet` 执行防抖与静默抑制。[切面定义](src/subsystems/facets.ts) · [会话过滤插件](../../plugins/perception-filters/conversational-gate/src/index.ts)
3. 声明式载体与持续资料源（如 MCP Resource）通过独立的 `perceptionSourceFacet`（`perception.source@1`）接入 `subscribePerceptionSource`，与 `perception.ingress@1` 职责正交、互不覆盖。[daemon 装配](../../apps/daemon/src/plugin-loader.ts)

## 验证

```sh
pnpm exec vitest run packages/perception-core
```
