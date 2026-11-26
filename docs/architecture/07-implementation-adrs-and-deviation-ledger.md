# 07. Clean-Slate V1 架构决断记录（ADRs）与先行项目实证

## 1. 架构约束与验据

| Clean-Slate V1 约束 | 可复现验据 |
| --- | --- |
| 空卷零预设，宿主持有真实 Provider 与 Vault。 | 没有预装角色、无凭据时就绪门关闭，显式唤醒产生新实例。 |
| 通道来源、受众、时效与主体贯穿观察及事件。 | 自定义模态跨鉴权、路由和持久化仍保留结构化字段。 |
| 心理状态轴由扩展描述符提供。 | 空状态不调度心理唤醒，新增轴写入键值检查点。 |
| 表达依据端点能力协商。 | 有限词表、文本降级和私密等待均可按回执审计。 |

## 2. AIRI 源码实证对照矩阵

以下路径相对于 `moeru-ai/airi` 仓库根目录，对照聚焦可独立复现的执行、作用域与生命周期机制。

### 正向吸收

| 上游证据 | 源码观察与 V1 采纳 |
| --- | --- |
| `packages/core-agent/README.md`、`packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`、`packages/core-agent/src/runtime/context-registry.ts`、`packages/core-agent/src/voice/interruption.ts` | 执行循环解耦情绪、Live2D 和存储。有序结算 `Turn / Round` 工具结果，隔离 `system`、`developer`、`context` 三层权威。`maxSteps` 到限仍须结算，目标缺证据时 `goalState: 'not-verified'`（`unverified`）。HTTP 408/429/5xx 瞬态重试限定在首事件前且有上限。语音 `silenced` 即停播，`done` 结清控制账。V1 继承这些边界，并以副作用前为额外重试约束。 |
| `packages/ccc/src/define/card.ts`、`packages/stage-ui/src/types/airiCard.ts`、`packages/stage-ui/src/services/airi-card-modules.ts`、`docs/ai/adr/2026-11-11-module-defaults-and-character-values.md` | 对齐 CCv3 `chara_card_v3`。编辑器往返保留未知 `extensions.<namespace>`。宿主模块默认值 `consciousness`、`vision`、`speech` 与角色 `Inherit / Override` 分离，由 `getModules(characterId)` 按回合解析，全局运行存储保持不变。V1 沿用无损与作用域契约。 |
| `packages/stage-ui/src/stores/onboarding.ts`、`packages/plugin-protocol/src/types/events.ts`、`docs/ai/adr/2026-11-09-native-observation-admission.md` | `provider-setup`、`device` 由真实能力缺口触发。模块状态依次为 `announced → configuration-needed → configured → capability:activated → ready`。观察授权绑定目标生命周期，接纳前检查撤销。V1 将缺口判定与授权有效性落实到无头运行时。 |

### 架构断层与规避

| 上游证据 | 断层与 V1 对策 |
| --- | --- |
| `integrations/minecraft/src/cognitive/` 下的 `perception/pipeline.ts`、`reflex/reflex-manager.ts`、`conscious/brain.ts` | `perception → reflex → conscious` 写在 Minecraft 集成中，依赖 Mineflayer 的 HP 和战斗语义，Web、桌面和 IM 无法复用。V1 将感知、认知、表达提取为与执行核并列的无头包，由插件提供领域观测和实现能力。 |
| `packages/stage-ui/src/stores/modules/airi-card.ts`、`packages/stage-ui/src/types/airiCard.ts` | ReLU → Iru 内置卡迁移依赖 `preIruBuiltInDescriptionHashes` 和旧 `localStorage` 适配判断用户是否编辑过默认卡。SHA-256 表覆盖 `en, es, fr, ja, ko, ru, th, vi, zh-Hans, zh-Hant` 十种语言。`AiriExtension` 还固化了 `vrm / live2d`。V1 默认卡为零，交互通道资产由插件命名空间持有。 |
| `packages/stage-ui/src/stores/onboarding.ts` 与角色卡 Pinia store | `onboarding/steps` 和激活卡状态依托浏览器 `localStorage` / Pinia，无法作为无头服务的生命周期权威。V1 由 `@ai0/daemon` 判定 L0～L5，借 `/healthz`、`/readyz` 对外报告。 |

## 3. 权威架构决断

### ADR-001 · 三级渐进派生

- **背景**　愿景层无法直接确定存储字段、调度边界和交付证据。
- **决策**　Level 1 明确目标与不变量，Level 2 派生实体责任、行为契约及反例，Level 3 在 Stage 0–6 逐级证伪并冻结已验证接口，再进入主仓集成。
- **后果与验证**　变更须定位到最早受影响阶段并重放下游用例。交付证据按第 08 篇阶段矩阵追溯。

### ADR-002 · 四层物理实体

- **背景**　部署主体、人格定义、运行记忆与端末权限各有生命周期。
- **决策**　`souls/host/` 持有 Owner、Vault 与全局算力配置，静态 CCv3 卡持有人格素材，显式唤醒产生独立 `<soul_id>.soul/` 并记录 `origin_card_id`，挂载交互通道持有会话级能力与交付回执。
- **后果与验证**　同卡唤醒两次得到各自独立的历史。卸载交互通道后实例留存，导出卡片仅包含允许分享的角色数据。

### ADR-003 · 九包拓扑与五核正交

- **背景**　通用话轮执行需要独立于伴侣业务和端侧表现。
- **决策**　`extension-core`、`agent-core`、`perception-core`、`cognition-core`、`expression-core` 与 `protocol`、`storage`、`gateway`、`sdk` 共九包。执行核依赖 `protocol` 与 `extension-core`，端侧驱动和陪伴策略由扩展包提供。直接依赖依据[系统架构矩阵](01-system-overview-and-monorepo.md)。
- **后果与验证**　`pnpm verify:boundaries` 阻断越层、反向或绕过公开包入口的插件依赖，执行核可单独验证结算与重试。

### ADR-004 · 零预设主权与就绪门禁

- **背景**　空卷可启动，实际陪伴话轮还依赖 Owner、模型、实例、配置和交互通道。
- **决策**　`@ai0/daemon` 从持久事实和在线握手重算 L0～L5，最早缺项决定阶段。控制台消费同一就绪响应，Channel A 接纳话轮前使用同一门禁。
- **后果与验证**　空卷没有角色和实例。撤销有效 Provider 或卸载最后合规 InteractionChannel 后，探针、控制台和话轮接纳同步降级。

### ADR-005 · 六元组、感知失明与内生时感

- **背景**　跨交互通道输入必须携带来源、受众、时效和授权证据。
- **决策**　按第 04 篇保留 `UniversalObservationFrame` 六元组。未授权源按 `(channel_id, modality, source_key)` 锁定 `"blind"`，重获授权且收到新鲜帧才解锁。`ReflexGate` 零模型 token 抑制例行信号，内生时感扣除互动区间与冬眠区间并集的交长。
- **后果与验证**　断连、过期和撤销分别遮蔽旧观测。回放重复例行帧只增抑制计数，重叠冬眠只扣一次。

### ADR-006 · 连续状态元引擎与可交换冲量

- **背景**　新增状态轴与同一时点的并发冲量需要可扩展、可复演的表示。
- **决策**　由 `ContinuousStateMetaEngine` 默认使用 `descriptors = []`，挂载后读取 `ContinuousStateDescriptor`，在潜空间合并同轴同刻冲量，再用 `bipolar_tanh` 或 `unipolar_sigmoid` 映射，持久化于 `continuous_states_json`。李群合成来自潜空间加法的交换与结合，跨时间演化及耦合步骤按时序执行。
- **后果与验证**　置换同刻冲量顺序，在浮点容差内得到同一结果。验证值域、检查点往返和新增描述符零 DDL。

### ADR-007 · 溯源防火墙、共同默契与真遗忘

- **背景**　睡眠整理、表达回执与快照恢复可能误升语义或重新引入已删除载荷。
- **决策**　`EpistemicMemoryFirewall` 区分 `observed_firsthand`、`reported_hearsay`、`inferred_hypothesis`、`imagined_narrative`。推断带有效期，`playful_banter`、`roleplay_fiction` 禁止进入 `semantic_fact`。`CommonGround` 从 `proposed_presented` 经接纳证据进入 `mutually_grounded`，争议或弃用进入 `disputed_retired`。按第 02 篇执行五表 Hard Forget，以血缘拓扑序重算混合记忆，恢复快照先重放 `state/redaction_ledger.json`。
- **后果与验证**　仅呈现不晋升默契，迟到的睡眠提案引用墓碑时拒绝写入，旧快照恢复后公开与管理检索均无法取回受删载荷。

### ADR-008 · 零人形表达与双边界打断

- **背景**　生成、呈现、动作执行与对方确认依赖不同证据。
- **决策**　`CommunicativeIntentEnvelope` 表达沟通、静默、动作或观察请求。`RealizerVocabularyNegotiator` 按受众、隐私、静默与词表约束选交互通道，缺合规交互通道时进入 `held_pending_compliant_channel`。四态真值分别以生成记录、呈现回执、执行证据和对方接纳驱动。`silenced` 即停播，`done` 按交付水位结算并回收 `unsaid_remainder`。
- **后果与验证**　丢失、重复或迟到回执不能抬高真值或重复回收。私密意图保持待交付且无明文回退泄露。

### ADR-009 · 宿主算力池与逐回合角色解析

- **背景**　多个角色共享 Provider 凭据，按角色选择模块与模型。
- **决策**　算力池属宿主，Vault 持有凭据。支持 `opencode_go` 的 `deepseek-v4.1-flash`、OpenAI-compatible、Anthropic、DeepSeek 与 Ollama。每轮按角色 `Inherit / Override` 解析 `consciousness`、`vision`、`speech`，构造本轮配置快照，覆盖项必须指向可用资源。
- **后果与验证**　两个角色交错执行时分别走各自路由且全局配置无写入，重新配置后下个回合可见，撤销导致就绪重新求值。

### ADR-010 · 双平面隔离与控制台

- **背景**　端侧互动、Owner 操作和实验时钟的权限边界不同。
- **决策**　Channel A Protocol v0 与 Channel B Owner Admin REST/SSE 使用独立入口与鉴权链。官方和社区插件统一经清单发现、验签、授权和撤销。第一方紧凑 MD3 控制台显式标注 `LIVE` 与 `SANDBOX:<fork_id>`，LIVE 时钟 1x，实验变速和写入限于分支。
- **后果与验证**　端侧凭证无法访问管理面，未授权插件无旁路，沙箱快照、时间和写入不会改变 LIVE。浏览器验收覆盖切换、重连和操作作用域。

### ADR-011 · 包级治理与切面接入

- **决策**　`ExtensionCoreHost` 按包授权、配置、隔离与重载。核心按 `FacetPoint` 消费多切面，认知协调器负责权威状态提交。`ExtensionComposition` 持有 Cordis Fiber 贡献生命周期。
- **验据**　Stage 5 检查整包清理、重载代次与同级通道连续可用。详见[多切面扩展规范](05-eight-dimension-extension-system.md)。

### ADR-012 · 通道与具身表现正交

- **决策**　`InteractionChannel` 持有双向端点与受众，`capabilities.embodiment_surface` 声明可选具身词表。
- **验据**　WebChat 的静态头像使用文本交付，动画能力从词表协商获得。授权静默与私密交付分别过能力和受众门槛。

### ADR-013 · 机制与策略分离

- **决策**　五核提供生命周期、执行、感知、认知与表达机制，陪伴过滤、内稳态、焦点迟滞、世界书由四个独立包提供。
- **验据**　Stage 6 验证无策略的 CLI 话轮、空描述符、中性撤稿与 0 ms 策略等待，并在运行中验证策略卸载。
