# From 0 to All · 渐进式架构推演

## 导读与全局方法论

先明确顶层架构边界 → 再通过跨场景示例拆分通用能力 → 最后逐层细化架构层级，绝不一上来写死架构。

按 Stage 0 → 1 → 2 → 3 → 4 阅读。先用纸面轨迹固定可检验的不变量，再造最小 Agent 执行环，随后对照 AIRI 源码，用语音、桌宠、机器人和游戏检验抽象，最后组合四大内核。零预设角色卡与 L0–L5 生命周期在 Stage 0 先定义，因此后续示例可以从空部署出发，且每个示例都能说明角色、能力与证据来自哪里。每一阶段可先读测试中的反例，再从实现追踪拒绝点和状态变化。

三条顶层解耦公理来自三组独立问题。

1. **执行与数字生命策略分离。** 模型流、工具回合和核验可以用于普通助手，也可以用于角色。角色如何感知、形成判断、表达意图，由各自的边界承担。
2. **身份与具身分离。** 宿主基础设施、角色卡、灵魂实例、挂载壳体可独立变化。设备能力由当前挂载和授权决定，经历归属于灵魂实例。
3. **输出与接地分离。** 生成、呈现、执行和用户确认各自有证据。媒介切换或断连时，按回执恢复进度并保留不确定性。

| 内核 | 责任与边界 |
| --- | --- |
| agent-core | 以授权分栏、模型流、工具回执与取消信号驱动回合，输出停止原因和验证状态。 |
| perception-core | 将设备覆盖、主体归属、时序和授权归一化为观察帧，控制下注入回合的时点。 |
| cognition-core | 用观察和状态形成可修订的判断、分层记忆及表达意图，通过器官注入场景策略。 |
| expression-core | 根据意图、受众与当前壳能力选择实现，追踪实际呈现与控制事件的确认。 |

## Stage 0 · 纸面形式化推演

[状态迁移与不变量](stage0-paper-traces/index.ts)以独立 TypeScript 函数编码。纸面模型零产品代码依赖，测试逐事件检查前缀连续性、交付集合互斥和实体引用完整性。

### 四态接地

**Generated ≠ Presented ≠ Actuated ≠ UserGrounded。** Generated 记录文本与动作指令，Presented 记录哪个壳呈现了哪个子句，Actuated 记录执行器动作，UserGrounded 由用户确认和交付不确定性推导。已呈现子句必须形成连续前缀，确认索引必须来自该前缀，动作 ID 必须出自已生成指令。

语音呈现子句 0 后，打断撤销子句 1 的待发记录，保留 presentedPrefix 为第一句、unsaidRemainder 为第二句。切到 text 时 pending 和 uncertain 均为空，子句 0 重发会因集合冲突被拒绝。子句 1 在文字壳依次 dispatch、present、ground。此时两句均已呈现，只有索引 1 被确认，因此整体仍为 partial。断连时将待回执索引转入 uncertain，接地为 unknown，余句为 null，等待证据决定是否可以补发。

**如果不这样设计会踩什么坑**：把已生成全文写成对话事实，会让下一回合引用用户尚未听到的内容。把断连等同于撤销可能重复播报，把设备振动等同于用户确认会误报完成。

### 四层实体

| 层 | 本阶段的所有权 |
| --- | --- |
| Host Infrastructure | 宿主认领关系与已验证 Provider。 |
| Zero-Preset Character Card | 用户导入的角色描述和可选资产锚点。 |
| Soul Instance | 身份、来源卡与情节经历。 |
| Mounted Shell | 绑定的卡和灵魂、固定锚点、传感器、执行器及资产支持。 |

同一灵魂绑定文字壳、猫耳桌宠壳和盲视冠压机器人壳。文字壳没有具身锚点，桌宠按当前卡绑定猫耳，机器人保有固定 crown_pressure 锚点，视觉为 blind，压力传感可用。桌宠换成手部角色卡时，从新卡重算锚点，旧猫耳随绑定失效，灵魂及经历沿用。

**如果不这样设计会踩什么坑**：切设备可能清空经历，切卡可能留下仍能触发的旧猫耳，复制角色卡可能让没有摄像头的壳宣称能看见。

### 零预设部署点亮

| 级别 | 名称 | 进入条件或事件 |
| --- | --- | --- |
| L0 | UNCLAIMED | 冷启动，零预设卡、零预设灵魂、零壳。 |
| L1 | CLAIMED_NO_PROVIDER | 宿主已认领，尚无已验证 Provider。 |
| L2 | PROVIDER_READY_NO_SOUL | Provider 已验证，尚未唤醒灵魂。 |
| L3 | SOUL_AWAKENED_NO_SHELL | 导入卡后从该卡唤醒灵魂，尚无挂载壳。 |
| L4 | LIVE_READY | 成功挂载至少一个壳。 |
| L5 | HIBERNATING | 从 L3 或 L4 记录休眠起点。 |

测试轨迹为 UNCLAIMED → CLAIMED_NO_PROVIDER → PROVIDER_READY_NO_SOUL → SOUL_AWAKENED_NO_SHELL → LIVE_READY → HIBERNATING → LIVE_READY。从 L3 休眠则恢复到 L3。恢复或撤销 Provider 时结算休眠窗口，卸下最后一壳回 L3，撤销 Provider 清空壳并回 L1，保留卡与灵魂。

**如果不这样设计会踩什么坑**：未授权部署可能提前执行，撤销凭证后壳仍看似在线，休眠时段可能被误计为清醒等待。用单个布尔值表达“就绪”也无法为失败恢复指出缺失的前置条件。

## Stage 1 · 最小通用 Agent

[145 行执行内核](stage1-agent-core/index.ts)通过模型与工具端口驱动回合。AuthorityRole 定义 system_invariant、developer_frame、untrusted_observation。projectPromptInputs 将三类输入分栏，观察文本即使包含指令措辞，仍作为数据交给适配器。适配器须维持这种投影边界。

单轮先读取模型流并缓存工具请求，流结束后依次执行工具，将请求与结果配对写入 Round，再将回合快照交给模型。无工具回合结束调度。goalVerification 在正常结束时按回执求值：未调用工具为 not_applicable，曾调用且全部验证为 verified，任何未核验或失败为 unverified。耗尽 maxSteps 时保留回执与 step_limit，验证仍为 unverified。工具适配器负责为相关业务目标提供可靠的验证依据。

对于 408、429 或 5xx，重试只发生在首次文本增量交付和首次工具执行之前。缓冲中的工具请求尚未执行，可以丢弃并重读模型流。第一次文本增量或工具调用一旦跨过边界，整个执行过程关闭自动重试。AbortSignal 贯穿入口、流迭代、退避与工具执行，取消会中止等待，实际终止外部操作还依赖适配器协作。

**如果不这样设计会踩什么坑**：观察可借提示拼接取得指令权，重试可重复发出工具副作用，模型一句“完成”可掩盖失败回执。把情绪、人设或虚拟形象放进执行器，会让非角色调用也承担设备和身份依赖，并把策略变化引入取消、重放和验证路径。

## Stage 2 · AIRI 源码解剖

以下按 AIRI 的文件职责对照 [实验实现](stage2-airi-dissection/index.ts)。源码链接指向 main，ADR 中的历史行为、决策及实施状态按文内时间线解读。

### 执行、上下文与输出

- **core-agent README** 描述调度、上下文拼装、工具轮、协议投影和端口。特别值得保留的是模型决策次数与工具调用次数各自计量，以及步数耗尽时仍结算最后一轮工具。实验提取最小回合与验证守卫，AIRI 的协议续接和持久化能力适合继续留在各自接入层。[packages/core-agent/README.md](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/README.md)
- **chat-orchestrator-runtime.ts** 将会话相关内容、模型与上下文端口、流和回合钩子组织在一次运行中。回复引用可仅投影到模型提示，原始历史仍能保留。这个集中编排有利于流式产品接入，跨壳迁移还需单独保存呈现游标与回执，才能定位恢复点。[packages/core-agent/src/runtime/chat-orchestrator-runtime.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts)
- **context-registry.ts** 从元数据或来源求写入键，按 replace-self / append-self 更新各自桶，removeWriter 移除活动桶，并保留有界写入历史。分桶解决写者互相覆盖。实验在活动读视图上增加 freshnessTtlMs 与未来时间检查，使用 blind / disconnected 锁遮盖旧载荷，readmit 清理旧桶并要求新样本，同时以 AudienceScope 过滤快照和历史。活动覆盖失效与历史记录可见性是两种约束。[packages/core-agent/src/runtime/context-registry.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/runtime/context-registry.ts)
- **llm-marker-parser.ts** 缓冲跨增量的标签边界，分发 literal 与 special，并用 flush 排定消费顺序。它适合把流中的控制片段单独交给消费者。解析出的标记仍需结合当前壳词表、语义动作和隐私约束才能绑定设备。[packages/core-agent/src/runtime/llm-marker-parser.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/runtime/llm-marker-parser.ts)
- **interruption.ts** 以 silenced 表达播放停止，以 done 表达控制通知记录结果，并把控制事件与用户消息分开。这个接口提供双完成边界，用户接地还需查呈现范围与用户确认。[packages/core-agent/src/voice/interruption.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/voice/interruption.ts)
- **spark-notify/types.ts** 将宿主提示覆盖放在运行时类型中，并允许通知按需要求文本或命令。传输事件可以保持稳定，宿主保有输出决策入口。若接入外部写者，追加系统指令的入口须受宿主控制，观察正文沿数据通道投影。[packages/core-agent/src/agents/spark-notify/types.ts](https://github.com/moeru-ai/airi/blob/main/packages/core-agent/src/agents/spark-notify/types.ts)

### 角色卡与默认值

- **card.ts** 以 CCv3 数据字段描述角色资产、设定、问候、来源和扩展，提供可迁移的角色表达面。持久化卡字段与活跃会话、设备挂载分别建模，才能在复制卡时避免连带复制运行身份。[packages/ccc/src/define/card.ts](https://github.com/moeru-ai/airi/blob/main/packages/ccc/src/define/card.ts)
- **airiCard.ts** 定义 AIRI 自有扩展，包括显示模型、唤醒词、上下文窗口和模块字段，明确编辑器应保存其他模块拥有的字段。实验把这条所有权规则落实到 CCv3 文档往返，连未知 extensions.<namespace> 及其嵌套值也保留。[packages/stage-ui/src/types/airiCard.ts](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui/src/types/airiCard.ts)
- **stores/modules/airi-card.ts** 负责卡片状态、同步和显示相关激活，调用模块选择服务。Store 适合管理同步与显示副作用。回合绑定到特定会话卡时，应取该卡解析值，以免其他窗口的活动角色影响当前回合。[packages/stage-ui/src/stores/modules/airi-card.ts](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui/src/stores/modules/airi-card.ts)
- **services/airi-card-modules.ts** 的 resolveModuleSelection 先求有效 Provider，再决定是否继承默认 Model。clearModuleSelections 按有效 Provider 清理，卡清空时恢复继承，全局语音清空时转为 speech-noop。normalizeCardSpeech 将旧卡留下的 speech-noop 迁移为继承。实验提取了无副作用解析与旧卡兼容，使用缺失值表达待配置的 Model，AIRI 服务使用空字符串。[packages/stage-ui/src/services/airi-card-modules.ts](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui/src/services/airi-card-modules.ts)
- **onboarding.ts** 记录设置完成、跳过及认证后关闭窗口等命令，并读取 Provider 配置条件。这个入口适合引导设置，L0–L5 进一步以认领、已验证 Provider、灵魂和挂载记录分别推导可用性。[packages/stage-ui/src/stores/onboarding.ts](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui/src/stores/onboarding.ts)
- **ADR 2026-11-11** 记录旧版 moduleDefaults 快照与运行 Store 的双写，以及多窗口争用。决策将 Store 作为全局默认的单一来源，角色值由会话解析，激活停止写全局模块选择。ADR 逐步记录会话读路径与默认源迁移，显示模型等激活责任仍保留。[docs/ai/adr/2026-11-11-module-defaults-and-character-values.md](https://github.com/moeru-ai/airi/blob/main/docs/ai/adr/2026-11-11-module-defaults-and-character-values.md)

CharacterCardResolver 从空注册表开始，导入与导出 CCv3 时深拷贝。已知模块字段以 Inherit / Override 解析，空值继承，显式值覆盖。显式 Provider 与默认 Provider 不同时，缺失的 Model 保持缺失。Voice 仅在解析后的 Provider 和 Model 均与默认值一致时继承。speech-noop 在实验中的兼容分支按继承解析。resolve 返回本次选择，无全局 Store 写入，故同一份默认值可并行解析多张卡。

### 外部观察与本地反射

- **plugin-protocol/src/types/events.ts** 描述插件、模块、扩展身份和路由元数据，为跨边界传递的来源与协议结构提供类型。路由标签只帮助定位，来源授权、鲜度、受众和提示权限需要由宿主在接入处判断。[packages/plugin-protocol/src/types/events.ts](https://github.com/moeru-ai/airi/blob/main/packages/plugin-protocol/src/types/events.ts)
- **ADR 2026-11-09** 记录原生观察的封闭准入。Electron 路由归属、标题和模型参数不足以建立授权，单靠 windowId 也无法证明目标在执行时仍是同一个窗口。Main 在入队前阻断原生请求，并拒绝读取缺可信来源的历史图像。重新开放要求宿主绑定请求者和目标生命周期、在派发时复查撤销和过期，并给产物连上来源证明。实验沿用准入与提示权限分离，只模拟 trustedGrant、覆盖、时间窗与受众，真实设备的身份校验与撤销由边界适配器负责。[docs/ai/adr/2026-11-09-native-observation-admission.md](https://github.com/moeru-ai/airi/blob/main/docs/ai/adr/2026-11-09-native-observation-admission.md)
- **perception/pipeline.ts** 注册游戏事件定义并以模态、类型和来源发布原始事件，在销毁时解绑。靠近传感器的接入层适合持有 Mineflayer 依赖、订阅范围和清理责任。要横跨游戏与物理壳，适配器须补充主体、授权和时间窗。[integrations/minecraft/src/cognitive/perception/pipeline.ts](https://github.com/moeru-ai/airi/blob/main/integrations/minecraft/src/cognitive/perception/pipeline.ts)
- **reflex/reflex-manager.ts** 抑制 entity_attention 以及主动攻击期间的常规 damage，独立的 low_health 仍可上送。这降低连续受击触发反复重规划的概率。实验将具体规则移入调用方，ReflexGate 按流累计局部抑制次数，critical 或 regimeChanged 触发上报并携带计数。匹配到局部规则时模型开销为零。[integrations/minecraft/src/cognitive/reflex/reflex-manager.ts](https://github.com/moeru-ai/airi/blob/main/integrations/minecraft/src/cognitive/reflex/reflex-manager.ts)
- **conscious/brain.ts** 将游戏环境、任务执行与模型推理接入有意识决策。该层拥有足够的游戏信息来组织规划。抽取通用认知时，游戏世界知识、动作和战术可由器官与壳适配，通用层继续处理证据、状态、调度和意图。[integrations/minecraft/src/cognitive/conscious/brain.ts](https://github.com/moeru-ai/airi/blob/main/integrations/minecraft/src/cognitive/conscious/brain.ts)

## Stage 3 · 冻结 Agent，推导感知与表达

[实验接口](stage3-perception-expression/index.ts)以 runObservationTurn 接回 Stage 1，所有帧进入观察栏。语音打断要求分离输出停止与记账，打字删稿要求区分活动与发言，宿主休眠要求区分经过与可交互时间，无眼机器人和静音手环要求壳声明真实能力。

### EmbodimentAffordanceRegistry

壳声明连接、锚点、各模态覆盖、执行能力与受众。已连接但未声明相应模态时为 blind，壳离线为 disconnected。无眼机器人的压力输入与视觉覆盖分别查询。

**如果不这样设计会踩什么坑**：模型会沿用旧壳能力，把缺失模态当成阴性证据，或者向已断连设备发指令。

### TurnLifecycleGate

activity 更新防抖截止时刻。interim 以草稿键启动可取消的投机预热，同键去重，修订时取消旧工作。commit 只复用同键且已完成的预热，克隆六元组 UniversalObservationFrame。六元组是 channel（壳、模态、覆盖）、attribution（主体与委托人）、contextFrame（社会语境与受众）、provenance（证据等级与授权）、interpretation（原始载荷、线索与竞争解释）、chronology（观察时刻、TTL、回合、修订）。retract 清理草稿，留下 unspoken_hesitation 与持续时长，正文不进入已提交观察。

**如果不这样设计会踩什么坑**：输入法的中间文本会触发正式回复，撤回的隐私草稿会进入历史，迟到的旧预热结果会盖过最终修订。

### ChronoceptiveSignalSynthesizer

从最近交互到现在的区间扣除与之相交的休眠窗口并集，归零截断后生成 system_chronoception 数据。宿主休眠两小时只增加墙钟经过时间，清醒未交互时长排除这两小时。

**如果不这样设计会踩什么坑**：每次唤醒都可能将停机误判为用户长时间不理会，重叠休眠窗口还会造成重复扣减。

### CommunicativeIntentEnvelope

用 communicate、explicit_silence、actuate、request_observation 表达交互意图。可选字段提供语义目标、表达姿态、动作暗示和受众、静默或时延约束。静音手环可表达确认或轮次提示，这些语义无需眼睛、面部或语音。

**如果不这样设计会踩什么坑**：设备命令进入认知输出后，每种新壳都要解释人形控制词。静默可能被误解成遗漏输出而被朗读补齐。

### RealizerVocabularyNegotiator

词表由已连接壳的执行能力生成，绑定时核验 token、语义动作、受众、静默及延迟预算。未经壳声明的 user_eyes、blush_level 无法通过词表绑定，应留在设备实现侧。私密非语言通道断开时，保持 held_pending_compliant_shell，公开壳即使支持同类动作也无法获得该私密意图。

**如果不这样设计会踩什么坑**：驱动收到不存在的控制量，手环离线时私人提示可能自动改用扬声器或公共灯。

### GroundingReceiptTracker

按时间段结尾与播放游标重建已播文本。silenced 给出播放停止侧的回执，缺回执为 null。done 等待事件 ID 的显式 acknowledge。相同事件 ID 复用已有记录，播放回执缺失时保留已知前缀并将余句记为未知。用户确认且全部呈现时才记 grounded。

**如果不这样设计会踩什么坑**：等待记账才停播会延长打断，听见停播就宣布处理完毕会丢失中断通知，按生成长度估算播报进度会丢句或重复。

## Stage 4 · 冻结前三阶段，组合最小认知核

[组合实现](stage4-universal-derivation/index.ts)与[场景测试](stage4-universal-derivation/stage4.test.ts)使用既有执行、准入和表达接口。测试以可重复的观察帧、模拟模型和声明式执行能力验证组合行为。

### ContinuousStateMetaEngine

双极状态在 $(-1,1)$ 上使用 $f(x)=\operatorname{atanh}(x)$，解码为 $\tanh$。它把双曲正切加法群映到实数加法群。单极状态在 $(0,1)$ 上使用 $f(x)=\log(x/(1-x))$，把几率的乘法映射为对数几率的加法，解码用 sigmoid。两者的外显响应都在边界附近软饱和。实现还在浮点解码时保留开区间，避免舍入产生端点。

设 $b=f(x_{\mathrm{baseline}})$，$d_0$ 为最近一次脉冲后相对基线的潜空间偏移，$t_0$ 为该脉冲时刻，时间单位为毫秒。两次脉冲间的闭式演化为

$$
x(t)=f^{-1}\bigl(b+d_0e^{-\lambda(t-t_0)}\bigr),\qquad
\lambda=\frac{\ln 2}{\mathrm{halfLifeMs}}\quad\text{或}\quad
\frac{\mathrm{decayRatePerSec}}{1000}.
$$

在脉冲到达时先衰减旧偏移，再加上潜空间增量。对阈值 $h$，令 $q=f(h)-b$。在 $q\neq 0$ 且与 $d_0$ 同号时，求解 $d_0e^{-\lambda(t-t_0)}=q$ 得

$$
t_h=t_0+\frac{\log|d_0|-\log|q|}{\lambda},\qquad
t_{\text{next}}=\min\{t_h\mid t_h>t_{\mathrm{now}}\}.
$$

基线是渐近目标，阈值候选为空则返回 null。定时器可直接等待下一次穿越，新增脉冲后重算。测试验证分段查询与直接演化一致，猫耳场景从 $t_0=1$ 加入单位脉冲，半衰期 1000 ms 后到达 $\tanh(0.5)$，得到 1001 ms。

### EpistemicMemoryFirewall

| 层 | 准入条件与用途 |
| --- | --- |
| episodic_trace | 默认记录可溯源经历，例如普通观察，事实等级保持未确立。 |
| perceptual_hypothesis | 有竞争解释的线索，保留多个假设。 |
| non_literal_frame | 玩笑、角色扮演等非字面语境先行归档。 |
| semantic_fact | 无竞争假设且具授权的已验证遥测，或由对应主体的委托人确认。 |

记录身份来自壳 ID、回合 ID 和修订号。澄清需匹配原假设的委托人、主体和受众，并用 supersededBy 保留更正链。记忆按受众和主体查询，历史事实与当前传感覆盖分别判断。游戏器官还检查遥测来源以决定是否改变战术状态，记忆防火墙与器官策略分别约束持久事实和即时行为。

### CognitiveOrgan 与 EmbodimentRuntime

器官从帧和连续状态提议脉冲、竞争假设及表达意图，按 ID 安装，同 ID 可替换。运行时核验传感授权、覆盖与新鲜度，再经过反射门。需要升级时调用器官，随后入记忆与上下文桶、合并脉冲、协商表达。respond 以受众读取有效帧，并以可用性帧表示失效传感器，最终走 Stage 1 的观察端口。场景词、设备 token 与阈值选择出现在测试夹具或器官中，内核使用通用标识和证据状态。

### 四个跨具身场景

1. **WebChat 摄像头与竞争假设。** 皱眉帧由器官给出“小字难读”与“轻度紧张”两个解释，模拟模型据此询问。用户授权澄清生成事实并标记旧假设已更正。过 TTL 或手动断开后，模型看到 sensor_unavailable，离线重注旧帧会被拒绝。重新开启可经 setSensorCoverage 恢复覆盖并清理旧桶，等新帧准入。现有场景测试覆盖过期与断开。
2. **猫耳三连击与窗口拖拽。** 同一触摸通道携带不同主体锚点。耳朵触点和计数触发状态脉冲及暖意动作，壳词表绑定到耳朵动作。拖拽落在 shell_container，由反射规则处理。连续状态引擎按通用阈值计时，无需知道猫耳或窗口。
3. **自身掉血、队友小林掉血与玩闹调侃。** 常规伤害由反射处理，关键伤害升级并携带抑制计数。可信遥测按主体锚点区分自保和支援。玩笑进入 non_literal_frame，战术器官因来源不同跳过，血量事实和紧迫状态因此保持完整。
4. **排练蓝卡与静音手环。** 同 ID 器官热替换，把蓝卡的语义从“轮到我”改为“待命”，分别协商轻振和双击。手环断开后，公开灯因受众不匹配而落选，意图保持 held_pending_compliant_shell。全程可用显式静默与非语言动作表达。

四组测试分别观察提示回合、状态轨迹、记忆边界和设备绑定。增加场景时，复用观察六元组、器官端口、授权与能力约束即可构造新的组合。现有证明范围是这些可运行的组合轨迹。

## 验证与运行

在仓库根目录，使用已安装的工作区依赖运行以下命令。


```powershell
pnpm exec tsc -p labs/tsconfig.json --noEmit
pnpm exec vitest run labs
pnpm exec vitest run --config labs/vitest.config.ts
```

若系统上的 pnpm 启动器无法访问其锁文件，可用 `corepack pnpm exec` 调用仓库指定的 pnpm 版本。根 `vitest.config.ts` 已将 `labs/**/*.test.ts` 纳入统一回归范围。
