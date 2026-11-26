# @ai0/expression-core · 表达

表达层把 `CommunicativeIntentEnvelope` 映射到符合交付约束的通道，并用端点回执跟踪各分块实际呈现了多少。daemon 将网关持有的协商器注入对话 Worker，让两者共享已挂载的端点。[包入口](src/index.ts) · [daemon 装配](../../apps/daemon/src/index.ts)

## 从意图到回执

1. **提供端点。** 网关握手后调用 `RealizerVocabularyNegotiator.mount(channel)`。插件也可以通过 SDK 的 `expressionRealizerFacet` 提供通道，协商器从注入的 `ExtensionCoreHost` 获取受众权限匹配的实现。[WebChat 注册示例](../../plugins/channels/webchat/src/index.ts)
2. **协商交付。** 调用 `negotiate(intent, preferredChannelId?)`，协商器按受众、延时、静默要求和执行器能力筛选端点。结果为 `dispatched` 时，调用方取得通道 ID 和待发送的 `ExpressionEnvelope`。没有合规端点时返回 `held_pending_compliant_channel` 与空信封，由调用方保留意图。[协商实现](src/realizer.ts) · [Worker 调用方](../../apps/daemon/src/profiles/digital-life/workers.ts)
3. **核实呈现。** 网关分块发送时用 `GroundingReceiptTracker.recordGenerated` 登记，初始状态为 `generated_unpresented`。端点回执交给 `receive` 更新呈现进度，执行器成功回执可以将已呈现的动作推进到 `actuation_verified`。双边界打断时，`silenced` 固定已呈现位置，匹配的 `done` 结算跨分块的 `unsaid_remainder`。[回执跟踪](src/grounding.ts) · [网关收发](../gateway/src/channel-ws-server.ts)

## 扩展呈现

- `expressionIntentDecoratorFacet` 允许插件调整措辞或表达姿态，原意图类型、标识及交付约束保持有效。有合规文本通道时，基础表达即可产出 `fallback_text`。[装饰器契约](src/facets.ts)
- 宿主可注入 `PresentationRenderer`，为支持具身呈现的端点生成协议扩展。媒体插件可通过 `expressionMediaTranscoderFacet` 提供播放游标换算，让回执跟踪器把播放进度换算为文本偏移。[daemon 渲染器](../../apps/daemon/src/profiles/digital-life/presentation.ts) · [媒体插件](../../plugins/media-pipelines/emotion-tts-sideband/src/index.ts)
- 要直接调用执行器端点，宿主用 `bindActuatorDelivery` 绑定已有的包、通道和授权判定函数。绑定检查端点代次与受众，返回的回执必须与原意图和分块匹配。[执行器绑定](src/realizer.ts)

在仓库根目录运行回执测试，验证呈现状态、对方响应后的确认及打断后的剩余文本。

```sh
pnpm exec vitest run packages/expression-core/src/expression-core.test.ts
```
