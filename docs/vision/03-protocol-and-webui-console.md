# 03. 下行表达意图、协议 v0 最小冻结核心、八大扩展生态与 WebUI 控制台定位

> **项目阶段**：架构研究与工程规格设计阶段（问题域规范）
>
> 本文档定义 Clean-Slate V1 的表达元语言、交付与回执闭环、**协议 v0 最小稳定核心的裁剪准则**、**微内核“八大功能扩展总线 × 五阶多态异构扩展载体”生态架构**，以及 **`WebUI 控制台`** 的系统定位、`Shell` 一等架构层正本清源（剥离 `plugins/shells/webchat` 越位层级）、顶栏 `LIVE / SANDBOX` 二元实例环境隔离、常驻多态外壳 + `<main>` 一体式圆角卡片路由视口盒子（`<RouterOutlet />`）与 8 大域 30 条专职路由全景。

---

## 一、表达元语言与交付接地

### 1.1 零人形预设的 `CommunicativeIntentEnvelope`

`@ai0/expression-core` 接收 `communicate`、`explicit_silence`、`actuate`、`request_observation` 四类意图。抽象字段 `attentionTarget` 标记注意目标，`expressiveStance` 描述表达姿态，`actuationHint` 给出动作语义。 `deliveryConstraints` 以 `audienceScope`、`requireNonVerbalQuiet`、`maxLatencyMs` 限制合法呈现。核心语法适用于纯文本终端、桌宠、机器人与手环，人体器官和动画参数由壳扩展解释。显式沉默可携带原因，在倾听、群聊无指向或尊重专注时直接结算为合法动作。

### 1.2 `RealizerVocabularyNegotiator` 动态协商

`HandshakeManifest` 声明 `Sensors / Realizers / Actuators`、受众、延迟与权限要求，`capabilities_updated` 随场景热增删。协商器只在已连接且授权有效的壳声明中匹配动作语义与 token，派发前复核受众、静默和时延。私密非语言意图在静音手环断连时保持 `held_pending_compliant_shell`，公开灯或扬声器无法接收；过期收回，有合规壳恢复时重新协商。可选动画时序 `pre_speech`、`on_substring`、`on_utterance_end` 由 Realizer 的命名空间扩展声明。降级同样遵守交付约束，并回传实际省略的层。

### 1.3 四态真相链与双边界打断

**`generated_unpresented → physically_presented → actuation_verified → interlocutor_grounded`** 区分生成、真实呈现、动作核验和交互者接地。四态标记证据而非无条件晋级。纯文本无动作时动作核验不适用，有动作时须用对应执行结果核验，用户接地须有对应确认。借鉴 SAIBA 的实现层分工和传出副本反馈，分段 ID、连续呈现前缀和动作 ID 都须能回指原始意图。

`GroundingReceiptTracker` 以事件 ID 幂等追踪两个完成边界。 `silenced` 立即停止播放并给出播放回执，`done` 等待控制事件确认和记账。按一致的字符计量，以 `spoken_char_offset` 重建实际播出前缀，将确认未播的部分存为 `unsaid_remainder`。缺失回执或断连时保留已知前缀，未知部分等待证据，避免重复播报。事件日志追加回执，工作记忆只将确认已呈现的前缀投影为用户会话事实。

---

## 二、协议 v0 的最小稳定核心（Minimal Frozen Core v0）到底该小到什么程度？

### 2.1 最小核心的裁剪准则 **`[架构推断]`**

判断一个字段该不该进 **Protocol Core v0**，只有一个唯一标准：
> **“如果把一个躯壳剥离到极致——只剩下一个能收发纯文本字符串的黑底白字命令行（CLI）或最简 Webhook，这个字段是否依然是维持数字生命因果闭环（感知-思考-表达/执行-回执-流控）所不可或缺的？”**
> * 如果答案是 **Yes** $\rightarrow$ 进入 **Frozen Core v0**（永久冻结向后兼容）；
> * 如果答案是 **No**（比如情绪 VAD、语速 pitch、眼神 gaze、Live2D 动作名） $\rightarrow$ 一律剥离到 **`extensions: Record<string, unknown>` 命名空间扩展字典**！

### 2.2 协议 v0 冻结核心的“五原语”概览（详细类型规范见 `docs/architecture/04-protocol-v0-and-gateway-spec.md`）

1. **`HandshakeManifest`**：具身运行环境握手，声明 `Sensors / Realizers / Actuators`、`venue_type`、`current_audience`、`latency_budget_ms` 与 `auth_token`；
2. **`PerceptionEnvelope`**：上行标准化感知信封，携带完整 `UniversalObservationFrame`、`lifecycle`（`activity`、`interim`、`commit`、`retract`）与命名空间扩展。网关保留观察六元组；
3. **`ExpressionEnvelope`**：下行表达与具身动作意图信封，承载 `CommunicativeIntentEnvelope`、可选降级文案及协商后的扩展绑定；
4. **`DeliveryReceipt`**：上行播放、打断与动作执行回执，携带 `status (completed | interrupted | degraded | failed)`、`spoken_char_offset` 与 `actuator_outcome`；
5. **`ControlSignal`**：双向流控与注意力焦点信号（`barge_in_cancel` / `focus_shifted` / `sb243_break_reminder` / `crisis_intervention_card`）。

---

## 三、微内核“八大功能扩展总线 × 五阶多态扩展载体”（为何单一 Tool/MCP 或单一编译型插件不足以支撑数字生命生态）

若仅提供 `Shell`（收发消息的躯壳）与 `MCP / Skill`（普通 Agent 调用的外部工具），或者强制要求所有扩展都必须写 TypeScript 编译 `dist/index.js` 代码包，90% 的社区创作者（二次元角色写手、自然语言技能创作者、跨语言协议开发者、工作流调教玩家）将被挡在生态门外。

为此，本架构将系统扩展体系设计为 **《八大功能扩展总线（Where it hooks） × 五阶多态异构扩展载体（How it's built & played）》**（详细接口规范见 `docs/architecture/05-eight-dimension-extension-system.md`）：

### 3.1 八大功能扩展总线（The 8 Functional Buses）
1. **`ext.shell`（具身运行环境总线 — 系统核心一等交互架构层）**：决定“她在哪里存在、拥有什么感官探针（`Sensors`）、什么多模态表达渲染器（`Realizers` 含动态表现力词典 `expression_vocabulary`）与什么端侧身体动作（`Actuators`）”（桌宠、Live2D/3D、微信/QQ/Discord、Minecraft 等游戏、以及挂载在控制台内的 网页交互插件如 `plugins/shells/webchat`）。
2. **`ext.media_pipeline`（多模态音视频与感官管线总线）**：位于躯壳与大脑之间的信号加工厂——如流式 ASR 语音识别、情感 TTS 语音合成（GPT-SoVITS / FishAudio / ElevenLabs）、声线滤镜、摄像头微表情语义提取器。
3. **`ext.cognitive_organ`（大脑认知器官与生命周期钩子总线）**：允许社区研究者插拔或新增大脑内部的认知子系统（三大钩子：`contributeToBlackboard` / `onTurnCompleted` / `onSleepCycleWakeup`）——如自定义情绪动力学算法、睡眠期梦境日记器官、塔罗心境器官。
4. **`ext.action_mcp_skill`（外部行动工具与复合技能包总线）**：决定“她能调用什么外部软件工作流协助或陪伴使用者完成任务”（标准 MCP Servers、HTTP Webhook/OpenAPI 桥接器与包含角色内执行姿态的复合 `SKILL.md` 行动技能手册）。
5. **`ext.memory_knowledge`（内建混合 RAG 知识库与外部活体知识连接器总线）**：在内核**开箱即用内建混合 RAG 引擎（PDF/MD/代码分块 + `sqlite-vec` 稠密向量 + FTS5 BM25 稀疏检索 + Reranker）**基础上，支持热插拔连接 Obsidian 笔记库、Notion、本地代码库、游戏/番剧设定 Wiki，并在卸载时自动浓缩生成 `<150` 字 `CrystallizedGistCard` 常识卡。
6. **`ext.model_provider`（模型推理后端与角色 LoRA 总线）**：接入各类云端 API、本地推理引擎（Ollama / vLLM / llama.cpp）、Embedding/Reranker、本地安全危机分类器以及角色专属 **LoRA 权重热切换器**。
7. **`ext.soul_asset`（灵魂模板、世界观词库、关系里程碑与评测剧本总线）**：支持社区零代码安全分享不含私人记忆的“纯净角色基因包（`.soul-template`）”、SillyTavern 角色卡（V2/V3）、动态世界观词库（`Lorebook`）、关系羁绊里程碑与纪念日正向剧情触发包（`milestones_and_rituals.yaml`）及回归测试剧本（`.scenario.yaml`）。
8. **`ext.console_ui`** 允许插件声明页面和配置表单。页面可向其他插件提供扩展点。

### 3.2 五阶多态异构扩展载体（The 5 Polymorphic Extension Carriers）
* **载体 I（零代码声明式资产包 `.yaml / .json / .png`）**：角色卡、`.soul-template`、`Lorebook`、`milestones_and_rituals.yaml`、`.scenario.yaml`，网页拖拽即食；
* **载体 II（Agent `SKILL.md` 自然语言技能手册与沙盒脚本）**：在控制台直接用 Markdown 编写任务指南与角色内执行姿态，免编译即写即用；
* **载体 III（免代码标准协议与跨进程连接器 `MCP / Protocol v0 WebSocket / Webhook / OpenAPI`）**：填 URL 或启动命令即可跨语言热挂载；
* **载体 IV（可视化认知管线、好奇心子代理与跨插件 ECA 联动蓝图 `.flow.yaml`）**：在控制台通过可视化积木编排跨插件协同与 `blackboard_policy.yaml` 黑板槽位预设；
* **载体 V（微内核原生代码插件与动态 UI 视图包 `ai0.extension.json + ESM/WASM + ext.console_ui`）**：深度介入内核钩子与自定义控制台页面。

---

## 四、`WebUI 控制台` 的系统定位、`Shell` 架构正本清源、`<main>` 一体式圆角卡片路由视口与五大视图母版

### 4.0 八个工作区包与无头上线治理

| 主仓包 | 职责 |
| --- | --- |
| `@ai0/agent-core` | 通用模型与工具执行。 |
| `@ai0/perception-core` | 结构化观察、感官覆盖与话轮准入。 |
| `@ai0/cognition-core` | 状态、记忆、安全策略与行为提案裁决。 |
| `@ai0/expression-core` | 意图协商、交付与接地。 |
| `@ai0/protocol` | 五原语和扩展信封的类型及校验契约。 |
| `@ai0/gateway` | 双平面接入、授权、观察与回执保真。 |
| `@ai0/storage` | 宿主配置与灵魂持久化、投影与血缘。 |
| `@ai0/sdk` | Shell 与扩展作者使用的接入契约。 |

应用 `@ai0/daemon` 组装八包，持有[零预设 L0–L5 门禁](01-vision-and-predecessors.md#15-零预设-l0l5-deploy-to-live)。控制台通过管理 API 展示 `/healthz` 存活和 `/readyz` 就绪缺口，按 Owner 权限发起认领、模型实测、角色卡创建或导入、灵魂唤醒、能力授权与挂载。关闭或更换浏览器不改变权威阶段。 `L5_LIVE_READY` 才允许伴侣交互，参考 WebChat 使用与第三方 Shell 相同的受限令牌及握手。

### 4.1 系统定位、正本清源 `Shell` 一等架构层与“后端 100% 零阉割 + 前端渐进式降维视觉”铁律

1. **架构定位：无头认知微内核的唯一官方实体控制平面（Control Plane）**：
   系统的核心本体永远是无头（Headless）的**数字生命认知微内核**，而 `WebUI 控制台（@ai0/console-webui）` 是系统标配的**内建实体控制平面**，默认根路由首屏为 **`/dashboard`（数字生命全景态势、活跃 `Shells` 星图与系统总览大盘）**。
2. **正本清源 `Shell（具身运行环境）` 的一等架构地位，剥离 `plugins/shells/webchat` 的越位层级**：
   * 系统真正的顶层交互架构层是 **`Shell（具身运行环境，ext.shell）`**（作为控制台第 2 大核心一级导航域 `/shells/*`，统领所有桌宠、Live2D/3D、IM、游戏与 Web 躯壳的双向连接、三平面能力、注意力焦点仲裁、丘脑门控与媒体管线）。
   * WebChat 通过自己的 `/webchat` 页面提供网页会话，通过躯壳协议接入网关。
3. **后端全量设计 100% 零阉割投射与三层渐进式降维视觉表达（`Tier-V1 直觉图形层 -> Tier-V2 紧凑表单层 -> Tier-V3 权威源码层`）**：
   * 采用 **`ai0` 第一方紧凑二次封装 MD3 设计语言**（无边框 L 型环境底板 + 单一 `16px` 圆角主画布、5 级动态灵魂色调表面、紧凑 `32px` 控件、单色 `currentColor` SVG 图标、真实指针水波纹与弹簧/果冻物理缓动），将后端全量认知机制、五阶多态扩展配置与系统基建 100% 零阉割投射至前端 **8 大一级导航域 × 30 条专职子路由**。

### 4.2 `WebUI 控制台` 的正式定义与“运行扩展 vs. 管理扩展”职责边界

> **`WebUI 控制台（WebUI Console）` 是官方随项目提供的浏览器管理、配置、创作、观测与实验操作系统界面。使用者通过它监控与编排所有具身 `Shells`、通过可食用角色蒸馏工坊与可视化曲线调教灵魂实例、编排 `<2500 Token` 认知黑板积木、管理五脑区算力代谢与五阶多态扩展配置、通过四轨终端与 8 步决策轨迹查证数字个体的行为、治理其记忆血缘与内建混合 RAG 知识库，并在隔离的实验副本上执行感官模拟、时间拨快、模块消融与回归回放。**

* **关键工程边界：“运行扩展”在后台内核，“管理扩展”在网页控制台**：
  * **前 7 大功能总线（`ext.shell` 至 `ext.soul_asset`）由后台无头守护进程 `@ai0/daemon` 宿主运行**；关闭浏览器丝毫不影响数字生命与后台扩展持续运转；
   * 页面模块在访问插件声明的路由时挂载。

### 4.3 常驻多态应用外壳、`LIVE / SANDBOX` 二元实例环境隔离与 `<main>` 一体式圆角卡片路由视口盒子（`MainRoundedCardOutlet`）

1. **常驻外围多态壳层（Persistent Polymorphic App Shell）**：
   * 外围由 **混合顶栏（`48px`）+ 左侧三态可折叠路由导航栏/迷你栏（`56px ↔ 220px ↔ 56px+190px 双轨`）+ 右侧三态可折叠上下文检视副栏/迷你工具栏（`48px ↔ 400px ↔ 540px`）** 构成常驻布局框架，在路由切换时稳固不闪烁。
2. **顶栏纯粹的“二元实例运行环境隔离（`🟢 LIVE` vs. `🧪 SANDBOX:<fork_id>`）”**：
   * **`🟢 LIVE 正式运行实例（target_instance: "live"）`**：主权翡翠绿防呆围栏，虚拟时钟锁定 `1x` 物理时钟，硬性禁用时间拨快、虚假感官注入与核心脑区消融；
   * **`🧪 SANDBOX 隔离实验沙盒副本（target_instance: "sandbox:<fork_id>"）`**：实验琥珀/紫罗兰防呆警示围栏，从指定快照秒级派生隔离副本，解锁虚拟时间拨快、感官模拟注入、脑区消融与 `.scenario.yaml` 回放，一切提醒与动作重定向至 `MockSandboxSink`。
3. **中央 `<main>` 一体式圆角卡片路由视口容器盒子（`MainRoundedCardOutlet` = `<RouterOutlet />`）**：
   * 被外围多态栏紧密环绕（`6px~8px` 紧密间距）的中央 **`<main>` 主内容区本身，被整体包裹为一张完整、统一的大圆角悬浮卡片盒子（`border-radius: 16px`）作为 `<RouterOutlet />` 路由视口**；
   * **单路由单页面、拒绝首屏大杂烩与碎卡片套娃**：任意时刻 `<main>` 圆角卡片大盒子内部**仅专职渲染当前 URL 匹配的那 1 个路由页面**（内部采用高内聚平铺分栏与分节展开五大视图结构母版，严禁把所有功能塞进首屏，也严禁把 `<main>` 拆成满屏零散漂浮的小卡片）。

### 4.4 `<main>` 圆角卡片盒子内部的五大视图结构母版与 8 大导航域全景（详细 30 条路由与 45 项组件库见 `docs/architecture/06-webui-console-and-observability-arch.md`）

| 视图结构母版 (View Archetype) | 在 `<main>` 圆角卡片大盒子内部的结构与交互特征 | 承载的 8 大一级导航域与核心专职子路由 | 对应的内核与扩展架构层 |
| :--- | :--- | :--- | :--- |
| **母版 I：插件页面** | 主工作区加载插件声明的网页模块。 | WebChat 与社区页面 |
| **母版 II：高密度态势指标带与多轨实时流监控态**<br/>*(Telemetry Strip, Topology & Multi-Stream Terminal)* | `<main>` 圆角卡片盒子内上方为紧凑水平态势指标带或连接拓扑星图，下方通过 `1px` 分割线无缝衔接高对比暗色等宽四轨融合终端或状态机看板 | • **域 1 首页** `/dashboard`（数字生命全景态势总览默认根首屏）<br/>• **域 2 躯壳** `/shells/topology`（双向具身网关与在线 `Shell` 三平面星图：`Sensors` 视神经感官覆盖桶 `live_foveal/stale` TTL、`Realizers` 动态表现力词典、`Actuators` 动态热更新）<br/>• **域 7 运行时** `/runtime/coordinator-agency`（MVCC 五域水位、机会池 `InteractionOpportunity` 与 `W2` 8步行动看板）& `/runtime/terminal`（四轨融合遥测终端） | `@ai0/gateway` + MVCC 协调器 + 四路 Worker + 8 步行动认知环 |
| **母版 III：主从分节 Schema 配置器、降维曲线与版本 Diff 审批态**<br/>*(Master-Detail Configurator, Visual Curve & Diff Approval)* | `<main>` 圆角卡片盒子内左侧为二级锚点栏，右侧为 `Tier-V1` 拖拽曲线/积木矩阵 + `Tier-V2` 紧凑 `32px` 表单 + `Tier-V3` 源码切换，底部内嵌粘性 `FloatingDirtyDiffBar` 与双栏 Diff 审批器 | • **域 1 黑板** `/dashboard/blackboard`（`<2500 Token` 认知黑板槽位积木编排器与公私场合 70% 社交面具模拟器）<br/>• **域 2 感官与媒体** `/shells/attention-arbitration` & `/shells/thalamic-gate` & `/shells/media-pipeline`（三锚点关键帧排练台）<br/>• **域 3 灵魂** `/soul/persona`（三层人格与演化双栏 Diff 审批）& `/soul/lorebooks`（激活模拟器）& `/soul/homeostasis`（24h 生物钟与二阶情绪拖拽画布）<br/>• **域 4 检索** `/memory/retrieval-sleep`（混合检索公式沙盒、睡眠防反刍与 `W3` 好奇心外部冲浪源）<br/>• **域 5 算力** `/models/providers` & `/models/routing`（五脑区路由、算力代谢犯困降级环与声线漂移雷达图）<br/>• **域 6 扩展配置** `/extensions/configurator`（动态 `config_schema` 热重载与 `D1~D5` 黑板域权限矩阵）& `/extensions/cognitive-organs`（大脑器官三钩子工作台）<br/>• **域 8 系统底座** `/system/safety-sb243` & `/system/settings-security`（认证、Secrets Vault 密钥保险箱与网络代理） | 黑板编译器 + 五脑区路由器 + 内稳态与 `VirtualClock` + `ext.media_pipeline` + Tier 0 安全层 |
| **母版 IV：交互式全幅拓扑画布与时间线资产治理态**<br/>*(Interactive Graph Canvas & Timeline Governance)* | `<main>` 圆角卡片盒子内上方为多维溯源过滤栏，中央为全幅可缩放 DAG 拓扑画布/时间轴/规则连线画布，右侧内嵌节点手术台抽屉 | • **域 4 记忆与关系** `/memory/lineage`（四级溯源血缘 DAG、双时态 `supersedes` 折叠链、`CommonGround` 默契三态、`Hard Forget` 五表擦除与 `redaction_ledger` 墓碑手术台）& `/memory/relationship`（关系雷达、心结48h一键释怀、共同经历里程碑画廊 `milestones_and_rituals.yaml` 与跨平台身份绑定图谱）<br/>• **域 6 流程编排** `/extensions/flows-eca`（跨插件 `When->If->Then` ECA 联动积木与 `.flow.yaml` 蓝图编排器）<br/>• **域 8 实例与快照** `/system/instances-storage`（多 `.soul` 实例、Git 快照回档弥合与 SQLite WAL/vec/FTS5 健康中心） | `.soul` 存储底座 + 血缘 DAG 引擎 + 关系里程碑引擎 + 跨插件编排引擎 |
| **母版 V：多态扩展市场网格、四步料理流水线与沙盒消融实验室态**<br/>*(Polymorphic Registry Grid, Distiller Wizard & Sandbox Lab)* | `<main>` 圆角卡片盒子内上方为五阶载体/八大总线分类栏或沙盒控制条，主区为紧凑平铺网格、四步分馏向导、在线技能创作台或 A/B 双轨消融对比矩阵 | • **域 3 角色蒸馏** `/soul/distiller`（可食用蒸馏角色四步料理工坊与一键脱敏打包台）<br/>• **域 4 知识与资产** `/memory/knowledge-rag`（内建混合 RAG 文档分块与卸载前百字常识卡 `CrystallizedGistCard` 提炼向导）& `/memory/events-media`<br/>• **域 6 五阶扩展工作坊** `/extensions/marketplace`（五阶多态扩展市场与 Creator Asset Bundler 脱敏打包器）& `/extensions/skills-mcp`（在线 `SKILL.md` 自然语言技能创作工坊与 MCP 调试沙盒）& `/extensions/custom/:pluginId`<br/>• **域 7 沙盒实验室** `/sandbox/lab`（`sandbox:<fork_id>` 时间拨快、感官注入、脑区消融对比与 `.scenario.yaml` Fail-Closed 回放实验室） | 五阶多态扩展总线 + 内建混合 RAG + 角色蒸馏管线 + `Sandbox Fork` 评测引擎 |
