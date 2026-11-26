# @ai0/sdk · 插件作者入口

插件通过 `@ai0/sdk` 定义扩展包，把实现挂到宿主提供的切面上。插件可直接依赖的工作区包是 `@ai0/sdk` 和 `@ai0/protocol`。不同插件通过具名服务契约协作。包根导出扩展定义、切面、服务与作用域 API，以及控制台页面和通道舞台的宿主接口。[公开导出](src/index.ts) · [仓库依赖边界](../../docs/architecture/01-system-overview-and-monorepo.md)

## 实现一个原生插件

1. 在 `ai0.extension.json` 中填写包标识、`entry`、需要贡献的 `facets` 和 `permissions`。入口模块可用 `Ai0ExtensionManifestSchema.parse` 读取同一份清单。[感知过滤插件清单](../../plugins/perception-filters/conversational-gate/ai0.extension.json)
2. 从入口模块默认导出 `defineExtensionPackage({ manifest, activate })`。宿主激活包时传入 `scope` 和当前配置。调用 `scope.contributeFacet(perceptionFilterFacet, filter)` 注册过滤器。在同一作用域中还可贡献控制台配置字段。通过 `scope.onDispose` 清理这次激活创建的缓冲区或监听器。[完整插件实现](../../plugins/perception-filters/conversational-gate/src/index.ts)
3. 按消费方选择接点。模型适配、资料源和工具分别接入 `agentModelAdapterFacet`、`agentContextContributorFacet` 和 `agentToolDefinitionFacet`。感知、认知、表达和控制台的接点集中定义在另一组导出中。[Agent 切面](src/agent-facets.ts) · [领域和控制台切面](src/facets.ts)

## 多个入口共享实现

同一项运算要同时供工作流和模型使用时，可以用 `defineServiceContract` 定义带版本的输入与结果。在清单的 `services` 中声明定义、提供或依赖关系，激活时分别通过 `scope.defineService`、`scope.provideService` 和 `scope.consumeService` 接入。工具切面负责把结果投影给模型。直接调用方可复用同一服务。Stage 7 的标签规范化用例还演示了停用提供方后旧绑定失效、独立上下文贡献继续可用。[可运行的服务与工具示例](../../labs/stage7-public-contracts/stage7.test.ts)

在仓库根目录运行以下测试，可以检查作用域清理、插件装卸和 SDK 与各核心之间的切面兼容性。

```sh
pnpm exec vitest run packages/sdk labs/stage7-public-contracts
```
