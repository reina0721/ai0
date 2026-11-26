# @ai0/protocol · 跨包契约

当通道、核心、宿主或插件需要对同一份数据作出一致解释时，从 `@ai0/protocol` 导入契约。包内使用 Zod 校验外部载荷，导出相应的 TypeScript 类型，也定义模型适配器等进程内接口。它没有对其他 `@ai0/*` 包的依赖。全部公开导出见[包入口](src/index.ts)。

## 按数据边界选择契约

| 调用场景 | 契约与使用方 |
| --- | --- |
| 通道连接、感知上报、表达下发、交付回执和控制信号 | 通道和网关共用五个原语及 JSON-RPC 消息结构。扩展负载按命名空间解析。[通道原语](src/core-v0/primitives.ts) · [标准扩展](src/extensions/standard-v1.ts) |
| 接入模型、工具或上下文来源 | Agent 核与插件 SDK 共用适配器、工具定义、贡献者和请求结构。话轮报告和执行回执还有独立的 Schema。[Agent 接口](src/agent/contracts.ts) · [话轮与任务](src/agent/index.ts) |
| 传递观察、状态或表达意图 | 观察帧记录来源、受众和时效。连续状态描述符和回复契约供认知层装配。意图交给表达层选择端点。[感知](src/perception/index.ts) · [认知](src/cognition/index.ts) · [表达](src/expression/intent.ts) |
| 加载插件或角色卡 | SDK 和宿主按同一清单校验载体、切面、服务及权限声明。存储包导入角色卡时使用 CCv3 契约。[插件清单](src/plugin-manifests/index.ts) · [角色卡](src/character-card-v3/index.ts) |
| 管理配置及观测话轮 | daemon、网关和控制台共享配置、话轮轨迹、通道进度及就绪状态。[控制面](src/control-plane/index.ts) · [通道进度](src/channel-run.ts) · [就绪报告](src/deployment/index.ts) |

## 接收外部输入

例如，网关接收握手时调用 `HandshakeManifestSchema.parse(manifestInput)`，得到已校验的字段，再检查令牌及其适用范围。只在编译期引用形状时可用 `import type { HandshakeManifest } from "@ai0/protocol"`。通道握手体现了载荷校验与宿主授权各自发生的位置。[网关实现](../gateway/src/channel-ws-server.ts) · [握手及回执测试](src/core-v0/primitives.test.ts)

在仓库根目录运行协议回归。

```sh
pnpm exec vitest run packages/protocol
```
