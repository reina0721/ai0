# @ai0/expression-core · 可验证表达与回执（L0 Kernel + L1 Subsystems）

`@ai0/expression-core` 采用双层微内核分层：
- `./kernel`（L0 不可约内核）：四态物理着陆状态机（`generated_unpresented → physically_presented → actuation_verified → interlocutor_grounded`）、双边界打断（`silenced` + `done`）与 UTF-16/码点安全的 `unsaid_remainder` 切分，以及 `InteractionOpportunityPool` 生命周期。[L0 入口](src/kernel/index.ts)
- `./subsystems`（L1 治理子系统）：`expressionRealizerFacet`、`expressionIntentDecoratorFacet`、`expressionMediaTranscoderFacet`、`RealizerVocabularyNegotiator` 与 `GroundingReceiptTracker`。[L1 入口](src/subsystems/index.ts)

## 从意图到回执

1. **提供端点**：通道通过握手或 `expressionRealizerFacet` 注册能力。[WebChat 示例](../../plugins/channels/webchat/src/index.ts)
2. **协商交付**：`RealizerVocabularyNegotiator.negotiate` 按受众、时延、静默与执行器能力匹配端点；缺少合规通道时返回 `held_pending_compliant_channel`。[协商实现](src/subsystems/realizer.ts) · [宿主协调器](../../apps/daemon/src/turn-coordinator.ts)
3. **核实呈现与游标转码**：`GroundingReceiptTracker` 结合可选 `expressionMediaTranscoderFacet` 将媒体游标换算为真实已呈现字符数，恢复未说完余量。[回执跟踪](src/subsystems/grounding.ts) · [具身呈现器](../../apps/daemon/src/embodied-presentation.ts)

## 验证

```sh
pnpm exec vitest run packages/expression-core
```
