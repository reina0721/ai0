# @ai0/sdk · 插件与声明式载体作者入口

插件通过 `@ai0/sdk` 定义扩展包、消费具名服务契约，或将声明式载体（`SKILL.md`、MCP Server、`.flow.yaml`）多态投影至五核切面。插件仅可依赖 `@ai0/protocol` 与 `@ai0/sdk`。[公开导出](src/index.ts)

## 核心能力

1. **原生代码插件**：通过 `defineExtensionPackage({ manifest, activate })` 挂载到五大核心切面：
   - Agent：`agentModelAdapterFacet`、`agentContextContributorFacet`、`agentToolProviderFacet`（统一 v1）、`agentSkillManualFacet`。[Agent 切面](src/agent-facets.ts)
   - 感知 / 认知 / 表达 / 控制台：`perceptionIngressFacet`、`perceptionSourceFacet`、`perceptionFilterFacet`、`cognitionStateDynamicsFacet`、`cognitionProposalPolicyFacet`、`cognitionContextContributorFacet`、`cognitionResponseContractFacet`、`cognitionSleepOrganFacet`、`cognitionAttentionArbitratorFacet`、`expressionRealizerFacet`、`expressionIntentDecoratorFacet`、`expressionMediaTranscoderFacet` 等。[领域切面](src/facets.ts)
2. **双边静态契约校验跨插件服务**：通过 `defineServiceContract` 声明带输入/输出校验的 `ServiceContract`。即使契约最初命名空间所有者未挂载或已停用，只要存在在线替代提供方即可为消费方提供经过双边校验的服务调用。[Stage 7 示例](../../labs/stage7-public-contracts/stage7.test.ts)
3. **多态载体投影（`mountCarrierProjections`）**：将 `SKILL.md` 章节、MCP 工具与资源、可视化认知流按 `projections` 声明投影到 `agent.tool_provider@1`、`perception.source@1`、`cognition.context_contributor@1`、`expression.realizer@1` 等目标切面。[载体投影引擎](src/carrier-projections.ts)

## 验证

```sh
pnpm exec vitest run packages/sdk labs/stage7-public-contracts
```
