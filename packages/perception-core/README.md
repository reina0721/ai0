# @ai0/perception-core · 感知

感知层把通道输入归一为 `UniversalObservationFrame`。读一帧观察时，可以从中确定谁提供了信号、哪个受众可见、何时采集，以及信息在多长时间内有效。网关负责验证会话，再把查验过的身份和受众交给感知层。[包入口](src/index.ts) · [网关调用方](../gateway/src/channel-ws-server.ts)

## 接入一条观察

1. 通道提交 `PerceptionEnvelope`。宿主向 `ObservationNormalizer` 注入 `PerceptionClockPort`，并在调用 `normalize` 时给出 `channelId`、`principalId` 和 `audienceScope`。归一后的外部观察标为 `untrusted_utterance`。来源未声明覆盖范围或鲜度且宿主未给默认值时，分别取 `unknown` 和 0 ms。[观察归一化](src/observation.ts)
2. 要解析自定义载荷，插件通过 SDK 注册 `perceptionExtractorFacet`，声明模态及扩展字段名。归一器使用注入的 `ExtensionCoreHost` 查找匹配且获准访问该受众的提取器，把提取结果、包 ID 和注册代次写入帧。[切面实现](src/observation.ts) · [网关集成样例](../gateway/src/gateway-m5.test.ts)
3. 要暂存或抑制事件，注册 `perceptionFilterFacet`。网关把事件送入 `PerceptionFilterPipeline`，过滤器按优先级处理。单独使用管线时，无过滤器的普通事件直接通过，`retract` 返回 `neutral_retract`。生产实现可参考[会话过滤插件](../../plugins/perception-filters/conversational-gate/src/index.ts)。

持续更新的资料源可以注册 `perceptionSourceFacet`。宿主调用 `subscribePerceptionSource`，传入包 ID、受众、取消信号与接纳回调。每次接纳时由宿主附上来源和本次订阅内递增的修订号。返回的清理函数可停止订阅，扩展撤销时租约也会终止。[订阅实现](src/facets.ts) · [daemon 装配](../../apps/daemon/src/plugin-loader.ts)

## 读取上下文与覆盖状态

`ScopedContextRegistry.snapshotForAudience` 按受众过滤条目，并在覆盖状态为 `blind`、`disconnected` 或 `stale` 时隐藏载荷。要按通道、模态与来源跟踪覆盖范围，使用 `SensoryCoverageBucketManager`。宿主可以为它注入假设修订策略，并与消费者共享同一虚拟时钟。[上下文注册表](src/context.ts) · [覆盖状态](src/sensory.ts)

在仓库根目录运行感知测试，覆盖无过滤器时的提交与撤稿、观察来源、受众隔离及鲜度过期。

```sh
pnpm exec vitest run packages/perception-core/src/perception-core.test.ts
```
