# @ai0/extension-core · 扩展装配与生命周期

`ExtensionCoreHost` 挂载扩展包，管理配置修订、切面的生效与撤销，以及版本化服务的绑定。daemon 的插件加载器创建挂载作用域，把包声明和实现交给主机。各领域核心通过接点查找当前可用的实现。插件作者从 `@ai0/sdk` 获取包定义和切面接口。[公共导出](src/index.ts) · [daemon 插件加载器](../../apps/daemon/src/plugin-loader.ts) · [SDK 入口](../sdk/src/index.ts)

## 选择接入点

| 场景 | 提供方 | 消费方 |
| --- | --- | --- |
| 实现已有领域能力 | 包在清单的 `facets` 声明接点，在 `activate(scope)` 中通过 `scope.contributeFacet(point, implementation)` 注册。领域用 `defineFacetPoint` 定义接点版本和解析函数。 | 用 `host.listFacets(point)` 枚举有效注册，再用 `invokeFacet` 或 `invokeFacetAsync` 调用。跨异步步骤持有注册时，可通过 `leaseFacet` 的信号响应撤销，操作完成后释放租约。[接点](src/facet-point.ts) · [主机](src/extension-host.ts) |
| 多个扩展共用一项业务服务 | 契约所有者用 `defineServiceContract` 描述服务标识、版本和输入输出，相关包在清单中声明服务，并在激活时调用 `defineService`、`provideService` 或 `consumeService`。 | 使用服务的包可通过客户端检查绑定状态、绑定调用。宿主可选择提供方或撤销访问。当所需服务失效时，依赖它的切面也会退出可用列表。[服务绑定](src/services.ts) · [撤权与替换测试](src/services.test.ts) |
| 管理贡献与副作用的存续时间 | `ExtensionComposition.mount` 提供 Cordis 作用域，可通过 `scope.define` 接收贡献、`scope.contribute` 提交贡献、`scope.effect` 登记清理函数。 | 宿主等待挂载句柄的 `ready()`，卸载时调用 `dispose()`，连同作用域内的贡献和副作用一起释放。[组合实现](src/composition.ts) |

配置更新使用 `configurePackage(id, config, expectedRev)` 检查修订号。禁用、卸载和重新激活会使旧注册失效。排查某项能力为何消失时，可先用 `getPackage(id)` 查看状态、最近错误和服务绑定，再检查消费者查询的接点版本与受众权限。[主机生命周期](src/extension-host.ts)

## 验证

从仓库根目录执行以下命令，检查扩展生命周期和服务绑定。

```sh
pnpm exec vitest run packages/extension-core
```

[公共契约实验](../../labs/stage7-public-contracts/stage7.test.ts) 展示独立扩展如何通过 SDK 发布服务、包装为工具，并交给已选择模型的 Agent 使用。
