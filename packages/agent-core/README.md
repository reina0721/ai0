# @ai0/agent-core · 通用话轮执行

宿主用 `runAgentTurn` 运行一次有步数上限、可取消的 Agent 话轮。每一步组装模型可见的消息和工具，读取模型事件，再由驱动决定结束、继续或执行工具。调用方从 `rounds` 读取正文和工具回执，从 `steps` 追溯各步的组装结果，从 `stopReason` 和 `goalVerification` 分别判断运行如何结束、目标是否得到验证。[公共导出](src/index.ts) · [执行循环](src/agent-runtime.ts)

## 如何接入

| 要提供的能力 | 接入点 | 消费方式 |
| --- | --- | --- |
| 模型 | 宿主直接传 `adapter`，或由扩展贡献 `agentModelAdapterFacet` 并由宿主指定 `bindings.modelPackageId` | 运行器把组装好的请求交给选中的适配器，消费文本增量、工具调用与结束事件。内置上游客户端可通过 `UpstreamModelClient.asModelAdapter` 接入。 |
| 上下文与手册 | `agentContextContributorFacet`、`agentSkillManualFacet` | `ContextAssemblyCompiler` 按步组装。宿主通过 `AgentBindings` 指定受众、指令权限及本次启用的手册，可通过 `preview` 查看组装结果。 |
| 模型可调用的工具 | `agentToolDefinitionFacet` 提供输入与结果校验、执行函数和模型结果投影 | 宿主通过 `allowsTool` 授权，执行器仅分发本步已公布且绑定仍有效的工具。完整结果保留在回执中，后续模型步骤只看到投影。 |

插件从 `@ai0/sdk` 获取对应切面，在 `activate(scope)` 中注册实现。daemon 的 `channelInference` 把 Studio 的只读工具清单、步数上限、选定模型和回复契约传入此层。已获授权的后台动作也可经 `ApprovedActionTurn` 直接调用工具，由调用方提供绑定和目标验证函数。[切面定义](src/facets.ts) · [请求组装](src/request-assembly.ts) · [daemon 交互接线](../../apps/daemon/src/channel-inference.ts)

## 验证

从仓库根目录执行以下命令即可验证话轮执行和绑定。

```sh
pnpm exec vitest run packages/agent-core
```

[模型与工具绑定测试](src/agent-bindings.test.ts) 给出了只注入模型的单步话轮，以及多步工具调用中规范结果与模型投影的具体样例。
