# Daemon 运行时装配

一次部署从 `createDefaultDaemonRuntime(options)` 开始。它打开宿主和 Soul 存储，创建时钟、扩展宿主和工作器，再把同一组实例交给通道网关与管理接口。需要查明某个组件实际收到哪份存储、哪组权限或哪一种模型时，从这个工厂向下追踪。[装配入口](src/index.ts)

| 要接入的能力 | 依赖由谁提供，在哪里消费 |
| --- | --- |
| 通道话轮 | HTTP 路由将请求交给 `Ai0DaemonRuntime`。运行时选择实例、会话配置和回复契约，W1 使用注入的推理函数运行话轮。[通道路由](src/channel-runs.ts) · [推理适配](src/channel-inference.ts) |
| Owner 管理操作 | 工厂将 `DaemonHandlerContext` 交给 `createRealAdminHandlers`。处理器可按目标选用 LIVE 或沙盒的存储、协调器和时钟。LIVE 存储可随切换 Soul 而更换，按请求从上下文取用。[管理处理器](src/admin-handlers.ts) |
| 知识检索 | 话轮、Studio 和后台执行器复用 `searchKnowledge`。调用方通过 `allowedCollections` 按挂载范围、受众和身份筛选可查集合，再交给检索服务。[知识服务](src/knowledge-service.ts) · [后台执行器](src/task-executors.ts) |
| 扩展与第三方能力 | `runtime.refreshCapabilities()` 汇合插件清单、Skill、MCP 配置和已保存的授权，分别挂载到 LIVE 和沙盒的扩展宿主。载体声明到具体接点的映射在投影层维护。[运行时加载器](src/plugin-loader.ts) · [载体投影](src/carrier-projections.ts) |
| 数字生命策略 | 工厂向 W1–W4 装配黑板、状态协调器、模型路由和按需使用的能力。修改产品行为时，从对应的配置层进入。[数字生命配置](src/profiles/digital-life/README.md) |

## 在集成测试中使用

向 `createDefaultDaemonRuntime` 传临时 `soulsRoot` 可以从未认领宿主开始，传 `soulDir` 可以直接装配指定存档。用 `createUnifiedDaemonHttpApp(runtime)` 取得 Hono 应用，通过 `app.request(...)` 调用同一套路由。测试结束时调用 `runtime.close()` 释放存储和沙盒资源。已有的 `lifecycleFixture` 封装了临时目录、清理和就绪阶段断言。[生命周期夹具](src/test-support/lifecycle.ts) · [HTTP 入口](src/cli.ts)

扩展组合测试可以从仓库根目录单独运行。

```bash
pnpm exec vitest run apps/daemon/src/capability-composition.test.ts
```
