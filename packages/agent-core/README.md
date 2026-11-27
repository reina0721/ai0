# @ai0/agent-core · 通用话轮执行（L0 Kernel + L1 Subsystems）

`@ai0/agent-core` 采用双层微内核分层：
- `./kernel`（L0 不可约内核）：四级指令权威通道（`system_invariant`、`developer_frame`、`untrusted_observation`、`user`）、机械式多轮工具调用与终端结构化 `output.schema` 收敛循环，零扩展遍历与零网络传输耦合。[L0 入口](src/kernel/index.ts) · [话轮状态机](src/kernel/turn-runtime.ts)
- `./subsystems`（L1 治理子系统）：`FacetPoint` 切面（`agentModelAdapterFacet`、`agentToolProviderFacet`、`agentContextContributorFacet`、`agentSkillManualFacet`）、`ContextAssemblyCompiler`、多厂商上游传输适配（`UpstreamModelClient`）与请求指纹追踪。[L1 入口](src/subsystems/index.ts)

## 如何接入

| 要提供的能力 | 接入点 | 消费方式 |
| --- | --- | --- |
| 模型 | 宿主直接传 `adapter`，或由扩展贡献 `agentModelAdapterFacet` 并由宿主指定 `bindings.modelPackageId` | 运行器把组装好的请求交给选中的适配器，消费文本增量、工具调用与结束事件。内置上游客户端可通过 `UpstreamModelClient.asModelAdapter` 接入。 |
| 上下文与手册 | `agentContextContributorFacet`、`agentSkillManualFacet` | `ContextAssemblyCompiler` 按步组装。宿主通过 `AgentBindings` 指定受众、指令权限及本次启用的手册，可通过 `preview` 查看组装结果。 |
| 模型可调用的工具 | `agentToolProviderFacet`（`agent.tool_provider@1`）统一声明 `inputSchema`、`resultSchema`、`execute` 与 `project` | 宿主通过 `allowsTool` 授权，执行器仅分发本步已公布且绑定仍有效的工具。完整结果保留在回执中，后续模型步骤只看到投影；若同时声明了结构化 `output.schema`，运行器会在工具轮次收敛后执行无工具结构化收敛步骤。 |

插件从 `@ai0/sdk` 获取对应切面，在 `activate(scope)` 中注册实现。[切面定义](src/subsystems/facets.ts) · [请求组装](src/subsystems/request-assembly.ts) · [daemon 交互接线](../../apps/daemon/src/channel-inference.ts)

## 验证

```sh
pnpm exec vitest run packages/agent-core
```
