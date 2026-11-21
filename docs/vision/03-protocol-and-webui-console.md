# 03. 下行表达意图、协议 v0 最小冻结核心、八大扩展生态与 WebUI 控制台定位

> **项目阶段**：架构研究与工程规格设计阶段（问题域规范）
>
> 本文档定义系统的第三层（下行表达意图与上行回执闭环）、**协议 v0 最小稳定核心的裁剪准则**、**微内核“八大功能扩展总线 × 五阶多态异构扩展载体”生态架构**，以及 **`WebUI 控制台`** 的系统定位、`Shell` 一等架构层正本清源（剥离 `plugins/shells/webchat` 越位层级）、顶栏 `LIVE / SANDBOX` 二元实例环境隔离、常驻多态外壳 + `<main>` 一体式圆角卡片路由视口盒子（`<RouterOutlet />`）与 8 大域 30 条专职路由全景。

---

## 一、内在表现层（下行表达意图与具身动作）的三大核心机制

认知内核绝不直接操作像素、Live2D 参数、3D 骨骼权重或音频波形，而是输出一套**与具体躯壳渲染器无关的语义化行为表达指令与端侧具身动作委托**。

### 1.1 下行意图必须配对上行执行回执（Proprioception & Delivery Receipt） **`[文献/先行项目佐证]`**

* **认知与工程原理**：在 SAIBA 虚拟人框架与人类神经科学的**传出副本理论（Efference Copy & Proprioception）**中，大脑发出运动或语言指令只是第一步，感官回传“动作实际执行到了哪里”才是形成真实记忆的前提。
* **断层场景**：她一次性生成了 12 个字的台词（或连发 3 条短消息），躯壳用 TTS 刚播到第 7 个字（或刚发出第 1 条），用户就开口打断或切走了窗口。如果内核不知道，内核的对话历史里会记录“我把 12 个字全说完了”，导致后续对话出现严重的上下文幻觉。
* **回执闭环规范** **`[架构推断]`**：
  1. 下行表达按自然语义切分为带序号的分段帧（`chunk_seq: 0, 1, 2...`）；
  2. 躯壳必须针对每个分段帧回传 `DeliveryReceipt`，状态包括：
     * `completed`：该帧已完整播放/展示给用户；
     * `interrupted`：播放中途被打断，必须附带 **`spoken_char_offset`（精确到已实际播出的字符偏移量，如 `7`）** 与 `interrupted_by_event_id`；
     * `degraded`：躯壳因能力限制丢弃了某些扩展层（如纯文本端丢弃了 `ext.embodied.v1` 动作，仅渲染了文字）；
     * `failed`：因网络或平台限流导致发送失败。
  3. **内核记忆修正**：一旦收到 `interrupted (spoken_char_offset=7)`，内核立即在事件日志与短期记忆中将已发生话轮截断至前 7 个字，并将第 8~12 个字转存进认知黑板的 **`unsaid_remainder`（被打断而未说出口的腹稿）** 槽位。下一轮她就可以极其自然地决定是“先把刚才没说完的半句话补上”还是“算了先顺着你的话说”。

### 1.2 “沉默（Explicit Silence）”是一等公民动作 **`[架构推断]`**

* 在群聊、直播间、桌面陪伴甚至一对一私聊（如对方只是发了一句感叹或正在连续倾诉）中，**“经过思考后决定不说话（只安静倾听或只做一个微表情）”** 是生命感与社交分寸感的最高体现。
* 因此，下行表达协议的 `action_type` 枚举中，**`explicit_silence` 与 `speak`、`invoke_actuator` 平起平坐**，并附带结构化的沉默原因 `silence_reason`（`listening_wait_for_more` / `not_addressed_in_group` / `respecting_user_focus` / `emotional_pause`）。

### 1.3 握手能力协商、运行期动态执行器声明、动画关键帧序列与优雅降级 **`[文献/先行项目佐证]`** + **`[架构推断]`**

作为具有能力边界的**具身运行环境（Embodied Runtime Environment）**，躯壳插件在建立 WebSocket 连接的第一步必须发送 `HandshakeManifest`，向内核暴露三大具身平面：
* **`Sensors`（上行感知模态与端侧环境探针）**：声明自己能感知什么信号（如桌面窗口焦点、键鼠状态、手机通知与传感器、游戏状态、网页 DOM）；
* **`Realizers`（下行表达渲染扩展）**：声明自己能理解并渲染的下行扩展命名空间（`supported_extensions`，如 `["ext.affect.v1", "ext.rhythm.v1", "ext.embodied.v1"]`），其中 `ext.embodied.v1` 原生支持遵循动画演出规律的**“开口前视线先行（`pre_speech`）$\rightarrow$ 词中微表情高潮（`on_substring`）$\rightarrow$ 句末余韵残留（`on_utterance_end`）”轻量关键帧序列**；
* **`Actuators`（端侧具身执行器列表与运行期动态热增删）**：声明自己能替内核在宿主环境中执行的动作 Schema 及端侧权限要求（如 `desktop.capture_window_snapshot`、`game.perform_action`、`browser.interact_element`）。同时吸收 `neuro-sdk` 的动态动作可供性设计，允许躯壳在运行中途通过 `ControlSignal(signal_type="capabilities_updated")` 随场景切换（如游戏从主菜单进入战斗、或桌面切换焦点应用）动态注册或注销当前可用的具身执行器；
* **社交场合、在场受众与流控参数**：`venue_type`, `current_audience`, `latency_budget_ms`。

---

## 二、协议 v0 的最小稳定核心（Minimal Frozen Core v0）到底该小到什么程度？

### 2.1 最小核心的裁剪准则 **`[架构推断]`**

判断一个字段该不该进 **Protocol Core v0**，只有一个唯一标准：
> **“如果把一个躯壳剥离到极致——只剩下一个能收发纯文本字符串的黑底白字命令行（CLI）或最简 Webhook，这个字段是否依然是维持数字生命因果闭环（感知-思考-表达/执行-回执-流控）所不可或缺的？”**
> * 如果答案是 **Yes** $\rightarrow$ 进入 **Frozen Core v0**（永久冻结向后兼容）；
> * 如果答案是 **No**（比如情绪 VAD、语速 pitch、眼神 gaze、Live2D 动作名） $\rightarrow$ 一律剥离到 **`extensions: Record<string, unknown>` 命名空间扩展字典**！

### 2.2 协议 v0 冻结核心的“五原语”概览（详细类型规范见 `docs/architecture/04-protocol-v0-and-gateway-spec.md`）

1. **`HandshakeManifest`**：具身运行环境握手，声明 `Sensors / Realizers / Actuators`、`venue_type`、`current_audience`、`latency_budget_ms` 与 `auth_token`；
2. **`PerceptionEnvelope`**：上行标准化感知信封，携带 `actor`、`lifecycle (activity | interim | commit | retract)`、`modality`、`summary_text`、`confidence` 与 `extensions`；
3. **`ExpressionEnvelope`**：下行表达与具身动作意图信封，携带 `action_type (speak | explicit_silence | invoke_actuator)`、`fallback_text` 与 `extensions (ext.affect.v1 / ext.rhythm.v1 / ext.embodied.v1)`；
4. **`DeliveryReceipt`**：上行播放、打断与动作执行回执，携带 `status (completed | interrupted | degraded | failed)`、`spoken_char_offset` 与 `actuator_outcome`；
5. **`ControlSignal`**：双向流控与注意力焦点信号（`barge_in_cancel` / `focus_shifted` / `sb243_break_reminder` / `crisis_intervention_card`）。

---

## 三、微内核“八大功能扩展总线 × 五阶多态扩展载体”（为何单一 Tool/MCP 或单一编译型插件不足以支撑数字生命生态）

若仅提供 `Shell`（收发消息的躯壳）与 `MCP / Skill`（普通 Agent 调用的外部工具），或者强制要求所有扩展都必须写 TypeScript 编译 `dist/index.js` 代码包，90% 的社区创作者（二次元角色写手、自然语言技能创作者、跨语言协议开发者、工作流调教玩家）将被挡在生态门外。

为此，本架构将系统扩展体系设计为 **《八大功能扩展总线（Where it hooks） × 五阶多态异构扩展载体（How it's built & played）》**（详细接口规范见 `docs/architecture/05-eight-dimension-extension-system.md`）：

### 3.1 八大功能扩展总线（The 8 Functional Buses）
1. **`ext.shell`（具身运行环境总线 — 系统核心一等交互架构层）**：决定“她在哪里存在、拥有什么感官探针（`Sensors`）、什么多模态表达渲染器（`Realizers` 含动态表现力词典 `expression_vocabulary`）与什么端侧身体动作（`Actuators`）”（桌宠、Live2D/3D、微信/QQ/Discord、Minecraft 等游戏、以及挂载在控制台内的 Web 交互舞台插件如 `plugins/shells/webchat`）。
2. **`ext.media_pipeline`（多模态音视频与感官管线总线）**：位于躯壳与大脑之间的信号加工厂——如流式 ASR 语音识别、情感 TTS 语音合成（GPT-SoVITS / FishAudio / ElevenLabs）、声线滤镜、摄像头微表情语义提取器。
3. **`ext.cognitive_organ`（大脑认知器官与生命周期钩子总线）**：允许社区研究者插拔或新增大脑内部的认知子系统（三大钩子：`contributeToBlackboard` / `onTurnCompleted` / `onSleepCycleWakeup`）——如自定义情绪动力学算法、睡眠期梦境日记器官、塔罗心境器官。
4. **`ext.action_mcp_skill`（外部行动工具与复合技能包总线）**：决定“她能调用什么外部软件工作流协助或陪伴使用者完成任务”（标准 MCP Servers、HTTP Webhook/OpenAPI 桥接器与包含角色内执行姿态的复合 `SKILL.md` 行动技能手册）。
5. **`ext.memory_knowledge`（内建混合 RAG 知识库与外部活体知识连接器总线）**：在内核**开箱即用内建混合 RAG 引擎（PDF/MD/代码分块 + `sqlite-vec` 稠密向量 + FTS5 BM25 稀疏检索 + Reranker）**基础上，支持热插拔连接 Obsidian 笔记库、Notion、本地代码库、游戏/番剧设定 Wiki，并在卸载时自动浓缩生成 `<150` 字 `CrystallizedGistCard` 常识卡。
6. **`ext.model_provider`（模型推理后端与角色 LoRA 总线）**：接入各类云端 API、本地推理引擎（Ollama / vLLM / llama.cpp）、Embedding/Reranker、本地安全危机分类器以及角色专属 **LoRA 权重热切换器**。
7. **`ext.soul_asset`（灵魂模板、世界观词库、关系里程碑与评测剧本总线）**：支持社区零代码安全分享不含私人记忆的“纯净角色基因包（`.soul-template`）”、SillyTavern 角色卡（V2/V3）、动态世界观词库（`Lorebook`）、关系羁绊里程碑与纪念日正向剧情触发包（`milestones_and_rituals.yaml`）及回归测试剧本（`.scenario.yaml`）。
8. **`ext.console_ui`（控制台动态 UI 视图、专属配置页与 Web 躯壳挂载槽总线）**：允许任何扩展在 WebUI 控制台中动态注册自己的专属配置面板、实时状态监控卡片、独立路由页面（`/extensions/custom/:pluginId`）或挂载 Web 具身躯壳互动舞台（`/shells/stage/:shellPluginId`）。

### 3.2 五阶多态异构扩展载体（The 5 Polymorphic Extension Carriers）
* **载体 I（零代码声明式资产包 `.yaml / .json / .png`）**：角色卡、`.soul-template`、`Lorebook`、`milestones_and_rituals.yaml`、`.scenario.yaml`，网页拖拽即食；
* **载体 II（Agent `SKILL.md` 自然语言技能手册与沙盒脚本）**：在控制台直接用 Markdown 编写任务指南与角色内执行姿态，免编译即写即用；
* **载体 III（免代码标准协议与跨进程连接器 `MCP / Protocol v0 WebSocket / Webhook / OpenAPI`）**：填 URL 或启动命令即可跨语言热挂载；
* **载体 IV（可视化认知管线、好奇心子代理与跨插件 ECA 联动蓝图 `.flow.yaml`）**：在控制台通过可视化积木编排跨插件协同与 `blackboard_policy.yaml` 黑板槽位预设；
* **载体 V（微内核原生代码插件与动态 UI 视图包 `ai0.extension.json + ESM/WASM + ext.console_ui`）**：深度介入内核钩子与自定义控制台页面。

---

## 四、`WebUI 控制台` 的系统定位、`Shell` 架构正本清源、`<main>` 一体式圆角卡片路由视口与五大视图母版

### 4.1 系统定位、正本清源 `Shell` 一等架构层与“后端 100% 零阉割 + 前端渐进式降维视觉”铁律

1. **架构定位：无头认知微内核的唯一官方实体控制平面（Control Plane）**：
   系统的核心本体永远是无头（Headless）的**数字生命认知微内核**，而 `WebUI 控制台（@ai0/console-webui）` 是系统标配的**内建实体控制平面**，默认根路由首屏为 **`/dashboard`（数字生命全景态势、活跃 `Shells` 星图与系统总览大盘）**。
2. **正本清源 `Shell（具身运行环境）` 的一等架构地位，剥离 `plugins/shells/webchat` 的越位层级**：
   * 系统真正的顶层交互架构层是 **`Shell（具身运行环境，ext.shell）`**（作为控制台第 2 大核心一级导航域 `/shells/*`，统领所有桌宠、Live2D/3D、IM、游戏与 Web 躯壳的双向连接、三平面能力、注意力焦点仲裁、丘脑门控与媒体管线）。
   * **`plugins/shells/webchat` 绝不是控制台的一个顶层架构层面或顶栏模式**——它仅仅是遵循 `Shell` 架构与 `Protocol v0` 的一个默认预装插件，启用后通过 `ext.console_ui` 在 `/shells/stage/builtin.webchat` 下动态挂载一个普通子路由页面（与社区开发的 Web Live2D/3D 舞台插件 100% 平权，可随时替换或禁用，绝不绑架控制台本身架构）。
3. **后端全量设计 100% 零阉割投射与三层渐进式降维视觉表达（`Tier-V1 直觉图形层 -> Tier-V2 紧凑表单层 -> Tier-V3 权威源码层`）**：
   * 借鉴 **`AstrBot / NapCat / Koishi`** 的成熟面板操作体验，融合 **`kirakira.moe (KIRAKIRA-Cerasus)`** 对 Material Design 3 的二次元个性化组件封装（紧凑 `32px` 控件、细腻水波纹 Ripple、弹簧物理缓动、动态灵魂色调），将后端全量认知机制、五阶多态扩展配置与系统基建 100% 零阉割投射至前端 **8 大一级导航域 × 30 条专职子路由**。

### 4.2 `WebUI 控制台` 的正式定义与“运行扩展 vs. 管理扩展”职责边界

> **`WebUI 控制台（WebUI Console）` 是官方随项目提供的浏览器管理、配置、创作、观测与实验操作系统界面。使用者通过它监控与编排所有具身 `Shells`、通过可食用角色蒸馏工坊与可视化曲线调教灵魂实例、编排 `<2500 Token` 认知黑板积木、管理五脑区算力代谢与五阶多态扩展配置、通过四轨终端与 8 步决策轨迹查证数字个体的行为、治理其记忆血缘与内建混合 RAG 知识库，并在隔离的实验副本上执行感官模拟、时间拨快、模块消融与回归回放。**

* **关键工程边界：“运行扩展”在后台内核，“管理扩展”在网页控制台**：
  * **前 7 大功能总线（`ext.shell` 至 `ext.soul_asset`）由后台无头守护进程 `@ai0/kernel` & `@ai0/daemon` 宿主运行**；关闭浏览器丝毫不影响数字生命与后台扩展持续运转；
  * **只有第 8 总线 `ext.console_ui`（插件贡献的配置表单、监控卡片或挂载在 `/shells/stage/:id` 的 Web 躯壳页面）才在打开控制台对应路由时按需渲染**。

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
| **母版 I：插件挂载互动舞台与伴生白盒检视态**<br/>*(Mounted Shell Stage & Companion Inspector)* | `<main>` 圆角卡片盒子内渲染已挂载的 Web `Shell` 舞台或虚拟躯壳模拟器；点击右上角或话轮联动展开右侧 `400px` **8 步可验证决策轨迹**与 `KiraSpoilerMask` 毛玻璃潜台词剧透副栏 | • `/shells/stage/:shellPluginId`（如挂载零特权 `builtin.webchat` 或社区 Web Live2D/3D 舞台插件）<br/>• `/shells/simulator`（内置免客户端虚拟躯壳与多模态感官调试模拟器） | `ext.shell` + `Protocol v0` 网关 + 只读审计轨迹表 |
| **母版 II：高密度态势指标带与多轨实时流监控态**<br/>*(Telemetry Strip, Topology & Multi-Stream Terminal)*<br/>`[借鉴 NapCat 并升维]` | `<main>` 圆角卡片盒子内上方为紧凑水平态势指标带或连接拓扑星图，下方通过 `1px` 分割线无缝衔接高对比暗色等宽四轨融合终端或状态机看板 | • **域 1 首页** `/dashboard`（数字生命全景态势总览默认根首屏）<br/>• **域 2 躯壳** `/shells/topology`（双向具身网关与在线 `Shell` 三平面星图：`Sensors` 视神经感官覆盖桶 `live_foveal/stale` TTL、`Realizers` 动态表现力词典、`Actuators` 动态热更新）<br/>• **域 7 运行时** `/runtime/coordinator-agency`（MVCC 五域水位、机会池 `InteractionOpportunity` 与 `W2` 8步行动看板）& `/runtime/terminal`（四轨融合遥测终端） | `@ai0/gateway` + MVCC 协调器 + 四路 Worker + 8 步行动认知环 |
| **母版 III：主从分节 Schema 配置器、降维曲线与版本 Diff 审批态**<br/>*(Master-Detail Configurator, Visual Curve & Diff Approval)*<br/>`[借鉴 AstrBot 并升维]` | `<main>` 圆角卡片盒子内左侧为二级锚点栏，右侧为 `Tier-V1` 拖拽曲线/积木矩阵 + `Tier-V2` 紧凑 `32px` 表单 + `Tier-V3` 源码切换，底部内嵌粘性 `FloatingDirtyDiffBar` 与双栏 Diff 审批器 | • **域 1 黑板** `/dashboard/blackboard`（`<2500 Token` 认知黑板槽位积木编排器与公私场合 70% 社交面具模拟器）<br/>• **域 2 感官与媒体** `/shells/attention-arbitration` & `/shells/thalamic-gate` & `/shells/media-pipeline`（三锚点关键帧排练台）<br/>• **域 3 灵魂** `/soul/persona`（三层人格与演化双栏 Diff 审批）& `/soul/lorebooks`（激活模拟器）& `/soul/homeostasis`（24h 生物钟与二阶情绪拖拽画布）<br/>• **域 4 检索** `/memory/retrieval-sleep`（混合检索公式沙盒、睡眠防反刍与 `W3` 好奇心外部冲浪源）<br/>• **域 5 算力** `/models/providers` & `/models/routing`（五脑区路由、算力代谢犯困降级环与声线漂移雷达图）<br/>• **域 6 扩展配置** `/extensions/configurator`（动态 `config_schema` 热重载与 `D1~D5` 黑板域权限矩阵）& `/extensions/cognitive-organs`（大脑器官三钩子工作台）<br/>• **域 8 系统底座** `/system/safety-sb243` & `/system/settings-security`（认证、Secrets Vault 密钥保险箱与网络代理） | 黑板编译器 + 五脑区路由器 + 内稳态与 `VirtualClock` + `ext.media_pipeline` + Tier 0 安全层 |
| **母版 IV：交互式全幅拓扑画布与时间线资产治理态**<br/>*(Interactive Graph Canvas & Timeline Governance)* | `<main>` 圆角卡片盒子内上方为多维溯源过滤栏，中央为全幅可缩放 DAG 拓扑画布/时间轴/规则连线画布，右侧内嵌节点手术台抽屉 | • **域 4 记忆与关系** `/memory/lineage`（四级溯源血缘 DAG、双时态 `supersedes` 折叠链、`CommonGround` 默契三态、`Hard Forget` 五表擦除与 `redaction_ledger` 墓碑手术台）& `/memory/relationship`（关系雷达、心结48h一键释怀、共同经历里程碑画廊 `milestones_and_rituals.yaml` 与跨平台身份绑定图谱）<br/>• **域 6 流程编排** `/extensions/flows-eca`（跨插件 `When->If->Then` ECA 联动积木与 `.flow.yaml` 蓝图编排器）<br/>• **域 8 实例与快照** `/system/instances-storage`（多 `.soul` 实例、Git 快照回档弥合与 SQLite WAL/vec/FTS5 健康中心） | `.soul` 存储底座 + 血缘 DAG 引擎 + 关系里程碑引擎 + 跨插件编排引擎 |
| **母版 V：多态扩展市场网格、四步料理流水线与沙盒消融实验室态**<br/>*(Polymorphic Registry Grid, Distiller Wizard & Sandbox Lab)*<br/>`[借鉴 AstrBot/Koishi 并升维]` | `<main>` 圆角卡片盒子内上方为五阶载体/八大总线分类栏或沙盒控制条，主区为紧凑平铺网格、四步分馏向导、在线技能创作台或 A/B 双轨消融对比矩阵 | • **域 3 角色蒸馏** `/soul/distiller`（可食用蒸馏角色四步料理工坊与一键脱敏打包台）<br/>• **域 4 知识与资产** `/memory/knowledge-rag`（内建混合 RAG 文档分块与卸载前百字常识卡 `CrystallizedGistCard` 提炼向导）& `/memory/events-media`<br/>• **域 6 五阶扩展工作坊** `/extensions/marketplace`（五阶多态扩展市场与 Creator Asset Bundler 脱敏打包器）& `/extensions/skills-mcp`（在线 `SKILL.md` 自然语言技能创作工坊与 MCP 调试沙盒）& `/extensions/custom/:pluginId`<br/>• **域 7 沙盒实验室** `/sandbox/lab`（`sandbox:<fork_id>` 时间拨快、感官注入、脑区消融对比与 `.scenario.yaml` Fail-Closed 回放实验室） | 五阶多态扩展总线 + 内建混合 RAG + 角色蒸馏管线 + `Sandbox Fork` 评测引擎 |
