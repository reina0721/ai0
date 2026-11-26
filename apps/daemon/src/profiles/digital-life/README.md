# 数字生命配置层

这里把公共核心装配成具有会话、记忆和角色状态的 Soul。daemon 的 LIVE 和沙盒运行时都从本目录引入组件，并传入各自的时钟、存储视图和扩展宿主。通用的版本裁决、连续状态和模型请求执行分别由认知核和 Agent 核提供。[配置层导出](index.ts) · [宿主装配](../../index.ts) · [认知核](../../../../../packages/cognition-core/README.md)

| 修改目标 | 接入位置 |
| --- | --- |
| 共享状态与持久化 | `AuthoritativeStateCoordinator` 为工作话轮、连续状态、记忆投影、任务和身份叙事分别注册域处理函数。工作器读取快照并提交带版本的提案。协调器应用裁决，使用宿主传入的存储接口保存检查点。[五域协调器](state.ts) |
| 话轮上下文与回复 | W1 从只读视图和检索器取得材料，使用 `BlackboardCompiler` 编译上下文。`agent.standard_v1` 使用纯文本回复。具名回复契约由宿主按 ID 和受众选定，缺失或多义时返回错误。[黑板](blackboard.ts) · [回复配置](dialogue.ts) · [契约选择](../../channel-inference.ts) |
| 后台工作 | W2 管理行动任务，W3 整理记忆，W4 接收多模态证据。各工作器的构造函数列出所需端口，新增能力可以沿相应工作器的调用路径追到宿主绑定点。[工作器](workers.ts) · [产品切面](facets.ts) |
| 会话模型与呈现 | 根据通道、场所和会话选择配置，再将模型绑定转换为路由器配置。表达网关接收此处提供的具身呈现函数。[会话配置解析](umo-profile-resolver.ts) · [具身呈现](presentation.ts) |

从仓库根目录运行下列用例，可以看到第三方如何同时提供模型和回复契约，以及超出受众范围或提供方被卸载时，宿主如何拒绝该契约。[通道回复契约测试](../../channel-response-contract.test.ts)

```bash
pnpm exec vitest run apps/daemon/src/channel-response-contract.test.ts
```
