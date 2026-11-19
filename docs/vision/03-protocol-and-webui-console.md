# 03. 下行表达意图、协议 v0 最小冻结核心、八大扩展生态与 WebUI 控制台定位

> 本文档定义 `ai0` 的第三层（下行表达意图与上行回执闭环），回答**“协议 v0 的最小稳定核心到底该小到什么程度”**，阐明为什么只有 `Shell / Skill / MCP` 远远不足以支撑社区生态并提出**《八大扩展维度》**，最后对 **`WebUI 控制台`** 进行概念归位与功能全景定义。

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

### 1.3 握手能力协商、具身执行器声明与优雅降级 **`[文献/先行项目佐证]`** + **`[架构推断]`**

作为具有能力边界的**具身运行环境（Embodied Runtime Environment）**，躯壳插件在建立 WebSocket 连接的第一步必须发送 `HandshakeManifest`，向内核暴露三大具身平面：
* **`Sensors`（上行感知模态与端侧环境探针）**：声明自己能感知什么信号（如桌面窗口焦点、键鼠状态、手机通知与传感器、游戏状态、网页 DOM）；
* **`Realizers`（下行表达渲染扩展）**：声明自己能理解并渲染的下行扩展命名空间（`supported_extensions`，如 `["ext.affect.v1", "ext.prosody.v1", "ext.embodied.v1"]`）；
* **`Actuators`（端侧具身执行器列表）**：声明自己能替内核在宿主环境中执行的动作 Schema 及端侧权限要求（如 `desktop.capture_window_snapshot`、`game.perform_action`、`browser.interact_element`）；
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
5. **`ControlSignal`**：双向流控与注意力焦点信号（`barge_in_cancel` / `focus_changed` / `system_break_reminder`）。

---

## 三、扩展生态升维：为什么只有 `Shell + Skill + MCP` 远远不够？

如果一个项目的扩展机制只有 `Shell`（收发消息的躯壳）和 `MCP / Skill`（普通 Agent 调的外部工具），那么它的“大脑内核、媒体信号加工、记忆引擎、灵魂资产分享与控制台视图”就依然是一个封闭黑盒，社区根本无法围绕“数字生命的共同养成与进化”自由生长。

为此，`ai0` 将扩展生态从单一的工具扩展升维为 **《微内核 + 八大标准化扩展维度（The 8-Dimension Pluggable Ecosystem）》**（详细接口规范见 `docs/architecture/05-eight-dimension-extension-system.md`）：

1. **`ext.shell`（具身运行环境扩展）**：决定“她在哪里存在、拥有什么感官与端侧身体动作”（WebChat、桌宠、Live2D/3D、微信/QQ/Discord、Minecraft 等游戏、硬件音箱）。
2. **`ext.media_pipeline`（多模态音视频与感官管线扩展）**：位于躯壳与大脑之间的信号加工厂——如流式 ASR 语音识别、情感 TTS 语音合成（GPT-SoVITS / FishAudio / ElevenLabs）、声线滤镜、摄像头微表情语义提取器。
3. **`ext.cognitive_organ`（大脑认知器官与生命周期钩子扩展）**：允许社区研究者插拔或新增大脑内部的认知子系统——如自定义情绪动力学算法、睡眠期写日记/做梦灵感插件、好奇心自主冲浪探索器、自定义显著性门控。
4. **`ext.action_mcp_skill`（外部行动工具与技能包扩展）**：决定“她能调用什么外部软件工作流帮你或陪你做事”（标准 MCP Servers 与复合 `SKILL.md` 行动剧本）。
5. **`ext.memory_knowledge`（记忆存储后端与活体知识连接器扩展）**：支持扩展图谱/向量混合检索引擎，以及热插拔连接 Obsidian 笔记库、Notion、本地代码库、游戏/番剧设定 Wiki。
6. **`ext.model_provider`（模型与推理后端提供商扩展）**：接入各类云端 API、本地推理引擎（Ollama / vLLM / llama.cpp）、本地安全危机分类器以及角色专属 **LoRA 权重热切换器**。
7. **`ext.soul_asset`（灵魂模板、世界观词库与评测剧本包扩展）**：支持社区安全分享不含私人记忆的“纯净角色基因包（`.soul-template`）”、关键词触发的世界观设定集（`Lorebook`）与标准化回归测试剧本（`.scenario.yaml`）。
8. **`ext.console_ui`（控制台自定义 UI 视图与观测卡片扩展）**：允许任何第三方插件在 WebUI 控制台中动态注册自己的**专属配置面板、实时状态监控卡片和调试视图**。

---

## 四、`WebUI 控制台` 的概念归位、正式定义与四大工作区全景

### 4.1 概念归位：控制台在项目中的真实位置

1. **在项目顶层愿景中，不喧宾夺主**：
   任何一个复杂的 AI 中枢系统天然都必须具备控制台才能配置与管理。因此，项目的主角永远是 **`ai0` 数字生命认知中枢**，控制台是系统理所当然自带的**内建控制平面（Control Plane）**，也不应以局部的“白盒观测”一词来以偏概全地命名整个控制台。
2. **在系统工程架构中，远超普通静态 `Settings` 页面**：
   由于 `ai0` 是无头（Headless）中枢、大脑状态随时间自发演化、且拥有八大扩展生态，它的 `WebUI 控制台` 除了常规参数配置外，还承担着**“无头内核的开箱互动沙盒与官方协议样板间（内置 WebChat）”、“活体记忆血缘与人格成长手术台”、“八大扩展生态的装配车间与插件 UI 宿主”、以及“跨时间尺度的认知时光机与回归实验室”**四大工程职责。

### 4.2 `WebUI 控制台` 的正式定义

> **`WebUI 控制台（ai0 WebUI Console）`** 是 `ai0` 数字生命认知中枢自带的**可视化系统控制平面、灵魂主权治理中心、全维度扩展宿主与内置交互仿真沙盒**。

### 4.3 核心安全边界：WebUI 控制台（宿主特权层） vs. 内置 WebChat（零特权标准 Shell 插件）

* **`@ai0/plugin-webchat`（内置 WebChat 独立 Shell 插件）**：**100% 纯粹走标准协议 v0 的零特权 Shell 插件**，既用于日常陪伴聊天，也作为社区躯壳插件的官方参考代码模板。标准 Shell 协议绝不向下传输脑内私密记忆 ID、权限裁决明细或未说出口的思考（防止第三方外部 Shell 插件窃取脑内隐私）。
* **`@ai0/console-webui`（WebUI 控制台宿主）**：在主舞台左侧**挂载（Embed）**走标准协议的 `WebChat` 插件，在右侧与后台各工作区通过**仅供宿主控制台访问的 `Kernel Admin & Audit Telemetry Bus`** 提供完整的脑内观测与全域治理功能。

### 4.4 结合项目架构的控制台四大工作区与 19 项功能面板全景（详细架构见 `docs/architecture/06-webui-console-and-observability-arch.md`）

| 工作区划分 | 包含的核心功能面板（共 19 项） | 对应的内核与扩展架构层 |
| :--- | :--- | :--- |
| **工作区 I：日常陪伴与认知沙盒**<br/>*(Stage & Cognitive Sandbox)* | **1. 内置标准协议 WebChat 舞台**（支持一键切入全屏纯净沉浸陪伴模式）<br/>**2. 本轮 8 步可验证决策轨迹抽屉**（即“白盒观测”面板：展示输入事件 $\rightarrow$ 门控 $\rightarrow$ 召回记忆 ID $\rightarrow$ 稳态变化 $\rightarrow$ 策略与模型自述推演 [含日常剧透遮罩] $\rightarrow$ 权限裁决 $\rightarrow$ 输出指令 $\rightarrow$ 播放/打断字数回执）<br/>**3. 感官事件模拟注入器**（手动模拟摸头、视觉变化、游戏掉血、打字撤回）<br/>**4. 虚拟时间拨快控制器（Time-Warp）**（`+15m` ~ `+30d`，区分运行静默 vs 关机冬眠） | 协议 v0 网关 + 权威状态协调器 + `VirtualClock` 引擎 + 决策审计日志 |
| **工作区 II：灵魂、记忆血缘与关系治理**<br/>*(Soul, Memory & Relationship)* | **5. 灵魂实例与三层人格配置台**（Tier 0 底线预览 / Tier 1 核心 DNA 与存在论契约 / **Tier 2 可演化自我叙事成长 Diff 审批** / `.soul-template` 与 `Lorebook` 装载）<br/>**6. 内稳态动力学、作息生物钟与主动搭话策略面板**（情绪/心境/双轨精力曲线、主动配额上限与免打扰）<br/>**7. 原始对话与事件流水审计台**（多维检索、审计、导出微调数据）<br/>**8. 主观记忆血缘树（Lineage DAG）与前瞻承诺治理台**（溯源分类 `亲历|传闻|揣测` 查看、**连根真遗忘 `Hard Forget`**、**痛点话题封印 `Topic Seal`**、睡眠防火墙异常审批、承诺状态机管理）<br/>**9. 客观外部知识库热插拔挂载台**（Obsidian/Notion/Wiki 挂载与卸载常识摘要卡 Gist Cards 管理）<br/>**10. 关系羁绊、用户模型与跨平台身份显式绑定台**（信任/亲密/默契、**心结成因查看与一键释怀**、可打扰度模型、跨平台账号显式合并绑定） | 大脑七大认知模块 + 睡眠写入防火墙 + `.soul` 存储底座 |
| **工作区 III：八大扩展生态、媒体管线与行动编排**<br/>*(8-Dimension Ecosystem & Agency)* | **11. 八大扩展工作坊与插件宿主管理面板**（统一安装、启停、监控全部 8 类扩展插件及签发 Scoped Capability Tokens）<br/>**12. 多模态语音、情感 TTS 与感官媒体管线调音台**（配置 `ext.media_pipeline`：TTS 声线情绪试听、流式 ASR 与 VAD 打断阈值、视觉语义置信度门控）<br/>**13. 一等行动能力（MCP / Skills / Shell Actuators）与运行中长任务监控台**（监控后台 8 步行动任务进度，支持随时暂停或中止）<br/>**14. 多端注意力焦点与跨插件联动规则编排器**（配置多 Shell 同时在线时的响应优先级与触发规则）<br/>**15. 第三方插件动态 UI 扩展槽容器（Plugin UI Slots）**（渲染社区插件注册的专属配置页与实时监控卡片） | 八大扩展总线 + 注意力仲裁器 + 8 步一等行动认知环 |
| **工作区 IV：算力路由、安全主权、系统监控与回归实验室**<br/>*(Compute, Sovereignty & Replay Lab)* | **16. 大模型接入、五脑区分层路由与 Token 预算“犯困降级”中心**（快对话/慢反思/睡眠整理/行动规划/多模态各配最优模型 + 预算熔断）<br/>**17. 安全围栏、三维权限审批矩阵与 SB 243 合规中心**（`主体×受众×工具风险` 矩阵、公私隐私隔离墙、全局紧急停止开关 Kill Switch、危机热线与 3 小时休息提醒配置）<br/>**18. Git 式灵魂快照时间线、回档断层弥合与整包迁移中心**（快照分支、**静默硬回滚 / 诚实共知翻篇回滚 / 梦境余温回滚**、`.soul` 整包导入导出）<br/>**19. 并发协调器监控、消融开关、场景回归回放与声线语料精炼实验室**（监控 MVCC `state_rev` 与四路 Worker 队列、一键开关认知模块做消融、运行 `.scenario.yaml` 剧本回放、提炼黄金声线样本与 LoRA 训练集） | 模型路由器 + Tier 0 安全层 + MVCC 协调器 + 回归评估引擎 |
