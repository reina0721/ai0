# 03. 下行表达意图、协议 v0 最小冻结核心与 WebUI 白盒控制台规范

> 本文档定义 `ai0` 的第三层（下行表达意图与上行回执闭环），回答**“协议 v0 的最小稳定核心到底该小到什么程度”**，并详细阐述 **WebUI 白盒观测与灵魂治理控制台** 的架构设计（含内置零后门 WebChat、观测者效应与剧透遮罩、事件溯源真遗忘、以及回档认知断层的三种弥合机制）。

---

## 一、内在表现层（下行表达意图）的四大核心机制

认知内核绝不直接操作像素、Live2D 参数、3D 骨骼权重或音频波形，而是输出一套**与具体躯壳渲染器无关的语义化行为表达指令**。针对你发现的四个关键缺口，我们的求真定型如下：

### 1.1 下行意图必须配对上行执行回执（Proprioception & Delivery Receipt） **`[文献/先行项目佐证]`**

* **认知与工程原理**：在 SAIBA 虚拟人框架与人类神经科学的**传出副本理论（Efference Copy & Proprioception）**中，大脑发出运动指令只是第一步，感官回传“动作实际执行到了哪里”才是形成真实记忆的前提。
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
* 因此，下行表达协议的 `action_type` 枚举中，**`explicit_silence` 与 `speak` 平起平坐**，并附带结构化的沉默原因 `silence_reason`：
  * `listening_wait_for_more`（对方话没说完，安静倾听等待，可附带 `ext.embodied.v1` 的点头/注视微动作）；
  * `not_addressed_in_group`（群聊/直播间里大家在聊别的，不强行插嘴当显眼包）；
  * `respecting_user_focus`（检测到主人正在专心写代码/开会，按捺住搭话冲动）；
  * `emotional_pause`（角色内欲言又止或害羞沉默）。
* WebUI 白盒面板会将每次 `explicit_silence` 清晰展示出来（“🤫 她听到了这句话，心里想了 X，但决定此刻安静陪着不插话”），让开发者和用户直观看到她的克制与分寸。

### 1.3 握手能力协商、具身执行器声明与优雅降级（Capability Negotiation, Actuators & Graceful Degradation） **`[文献/先行项目佐证]`** + **`[架构推断]`**

作为具有能力边界的**具身运行环境（Embodied Runtime Environment）**，躯壳插件在建立 WebSocket 连接的第一步必须发送 `HandshakeManifest`，向内核暴露三大具身平面：
* **`Sensors`（上行感知模态与端侧环境探针）**：声明自己能感知什么信号（如桌面窗口焦点、键鼠状态、手机通知与传感器、游戏状态、网页 DOM）；
* **`Realizers`（下行表达渲染扩展）**：声明自己能理解并渲染的下行扩展命名空间（`supported_extensions`，如 `["ext.affect.v1", "ext.prosody.v1", "ext.embodied.v1"]`）；
* **`Actuators`（端侧具身执行器列表）**：声明自己能替内核在宿主环境中执行的动作 Schema 及端侧权限要求（如 `desktop.capture_window_snapshot`、`game.perform_action`、`browser.interact_element`）；
* **社交场合、在场受众与流控参数**：`venue_type`, `current_audience`, `latency_budget_ms`。

内核既可以把完整的扩展意图下发由躯壳自行按需挑拣（忽略不认识的字段），也可以根据握手声明在认知黑板中提示大脑：“当前附身在纯文本躯壳中，无法通过肢体动作传情，请更多通过文字语气词表达”，或者在一等行动认知环中直接调度当前躯壳声明的 `Actuators`。

---

## 二、协议 v0 的最小稳定核心（Minimal Frozen Core v0）到底该小到什么程度？

你提出了一个极具架构远见的判断：**“协议一旦被社区采用就等于冻结，所以应当是极小的稳定核心 + 带命名空间的扩展。”**

### 2.1 最小核心的裁剪准则 **`[架构推断]`**

判断一个字段该不该进 **Protocol Core v0**，只有一个唯一标准：
> **“如果把一个躯壳剥离到极致——只剩下一个能收发纯文本字符串的黑底白字命令行（CLI）或最简 Webhook，这个字段是否依然是维持数字生命因果闭环（感知-思考-表达/执行-回执-流控）所不可或缺的？”**
> * 如果答案是 **Yes** $\rightarrow$ 进入 **Frozen Core v0**（永久冻结向后兼容）；
> * 如果答案是 **No**（比如情绪 VAD、语速 pitch、眼神 gaze、Live2D 动作名） $\rightarrow$ 一律剥离到 **`extensions: Record<string, unknown>` 命名空间扩展字典**！

### 2.2 协议 v0 冻结核心的“五原语”完整规格（The 5 Atomic Primitives）

基于上述准则，**Protocol Core v0 整个协议只有 5 种消息信封（JSON-RPC 2.0 over WebSocket），核心必填字段总计不超过 18 个**：

````carousel
```json
// 原语 1：HandshakeManifest (具身运行环境握手与能力/场合声明 - Shell -> Kernel)
{
  "protocol_version": "0.1.0",
  "shell_id": "community.desktop.companion_01",
  "shell_kind": "desktop_embodied",
  "venue_type": "private_1on1",
  "current_audience": { "scope": "only_owner", "member_count": 1 },
  "latency_budget_ms": 1500,
  "capabilities": {
    "sensors": ["text", "window_focus", "mouse_idle", "tactile_poke"],
    "supported_extensions": ["ext.affect.v1", "ext.rhythm.v1", "ext.embodied.v1"],
    "actuators": [
      {
        "actuator_id": "desktop.take_authorized_snapshot",
        "description": "经用户确认后截取当前活动窗口画面",
        "requires_local_permission": true
      }
    ]
  },
  "auth_token": "cap_tok_ed25519_..."
}
```
<!-- slide -->
```json
// 原语 2：PerceptionEnvelope (上行标准化感知信封 - Shell -> Kernel)
{
  "event_id": "evt_01J9Z01",
  "timestamp": "2026-11-19T18:30:00.000Z",
  "actor": {
    "platform_uid": "tg_user_9981",
    "display_name": "Rin"
  },
  "lifecycle": "commit",
  "modality": "text",
  "summary_text": "我今天终于把那个棘手的架构问题想通了！",
  "confidence": 1.0,
  "persistence_hint": "permanent",
  "extensions": {
    "ext.sensory.v1": { "ambient_cues": ["typing_burst_fast"] }
  }
}
```
<!-- slide -->
```json
// 原语 3：ExpressionEnvelope (下行表达与具身动作意图信封 - Kernel -> Shell)
// action_type 支持: "speak" | "explicit_silence" | "invoke_actuator"
{
  "intent_id": "int_01J9Z02",
  "correlation_event_id": "evt_01J9Z01",
  "chunk_seq": 0,
  "is_final": false,
  "action_type": "speak",
  "fallback_text": "真的吗？！太棒啦，我就知道你肯定能啃下来的！",
  "extensions": {
    "ext.affect.v1": {
      "label": "excited_proud",
      "vad": { "valence": 0.85, "arousal": 0.75, "dominance": 0.55 }
    },
    "ext.rhythm.v1": {
      "pre_delay_ms": 200,
      "pause_after_ms": 400
    },
    "ext.embodied.v1": {
      "sync_anchor": "on_utterance_start",
      "gaze": { "target": "user_eyes", "style": "bright_focused" },
      "facial": { "expression": "wide_smile", "intensity": 0.8 },
      "gesture": { "intent": "cheer_lean_forward", "fallback": "nod_happy" }
    }
  }
}
```
<!-- slide -->
```json
// 原语 4：DeliveryReceipt (上行播放、打断与具身动作执行回执 - Shell -> Kernel)
{
  "intent_id": "int_01J9Z02",
  "chunk_seq": 0,
  "status": "interrupted",
  "spoken_char_offset": 9,
  "interrupted_by_event_id": "evt_01J9Z05",
  "degraded_extensions": ["ext.embodied.v1"],
  "actuator_outcome": null
}
```
<!-- slide -->
```json
// 原语 5：ControlSignal (双向流控与注意力焦点信号 - Bidirectional)
{
  "signal_type": "barge_in_cancel",
  "target_intent_id": "int_01J9Z02",
  "reason": "user_started_speaking",
  "active_focus_shell_id": "builtin.webchat.default"
}
```
````

> [!TIP]
> **为什么这套五原语核心能做到“5 年不破兼容”？**
> 因为核心信封只认 `lifecycle`、`modality`、`summary_text`、`action_type (speak | explicit_silence | invoke_actuator)`、`fallback_text` 与 `spoken_char_offset` / `actuator_outcome`。
> * 一个只有 50 行 Python 代码的极简命令行躯壳，完全忽略 `extensions` 字段，只打印 `fallback_text` 并回传 `status: "completed"`，就能走完 100% 标准协议闭环！
> * 一个顶配 Unreal Engine 5 / Live2D / 游戏联动躯壳，则深入解析 `extensions` 与 `actuators`，实现毫秒级声画眼神同步与端侧环境行动。

---

## 三、WebUI 控制台 vs. WebChat 插件：架构边界与可验证决策轨迹

WebUI 控制台兼具双重使命：**既是开发演进时挂载了“零后门内置 WebChat”的实时脑内白盒实验室，也是正式使用者全面养育和掌控自己数字生命的主权中心**。

### 3.1 核心架构与安全边界：WebUI 控制台（宿主特权层） vs. WebChat（零特权独立 Shell 插件）

> [!IMPORTANT]
> **为什么“认知白盒观测”绝对不能放进 WebChat Shell 插件或标准 Shell 协议里？**
> * **`@ai0/plugin-webchat`（内置 WebChat 独立 Shell 插件）**：负责聊天交互与模拟感官输入。它必须**100% 严格通过标准协议 v0 接入内核，零内部后门、零特权**。在代码工程结构上，通过 Linter 与构建规则物理禁止其 `import @ai0/kernel` 内部模块。**尤为关键的是：标准 Shell 协议绝不向下行 Shell 传输脑内召回的私密记忆 ID、权限裁决明细或未说出口的思考**（否则任何第三方社区直播间或群聊 Shell 插件都能通过标准协议偷看主人的全套脑内隐私！）。
> * **`@ai0/console-webui`（WebUI 核心管理与白盒观测控制台）**：是 `ai0` 的宿主管理程序。它在主舞台左侧**嵌入（Mount）**了走标准协议的 `WebChat` 插件，而在主舞台右侧渲染**属于 WebUI 控制台宿主特权层的《白盒认知观测面板（White-Box Telemetry Inspector）》**——该面板通过仅供宿主控制台访问的 **`Kernel Admin & Audit Telemetry Bus`** 读取脑内决策轨迹与状态。

### 3.2 可验证的系统级决策审计轨迹（Verifiable System Decision Trace）

普通 AI 伴侣的用户只能看到：`输入 → 回复`。
而 `ai0` 的 WebUI 白盒面板让开发者与用户完整看到：**`输入 → 感知门控 → 记忆召回 → 情绪与稳态变化 → 策略与行动规划 → 权限裁决 → 表达/执行行为 → 具身反馈回执`**。

* **认识论铁律**：我们**不把 LLM 生成的 `causal_thought` 当作真实、完整、可信的内部推理过程**（模型生成的文本只是预测 Token，不等于系统真实计算过程的完整记录）。
* WebUI 白盒面板记录并展示由内核代码 **100% 确定性采集、可审计、可断言复现的《本轮决策轨迹树（Verifiable Turn Decision Trace）》**：
  ```text
  本轮可验证决策记录 (VerifiableTurnTrace — 权威审计对象)
  ├── 1. 输入感知事件: event_id, principal, venue, audience, modality, confidence
  ├── 2. 门控与识别意图: L0 危机检查结果, 显著性得分, 防抖合并计数, 识别的用户意图分类
  ├── 3. 召回的记忆血缘: audience_filter ("only_owner"), 命中的记忆 ID 列表 [mem_04, mem_19], 溯源类型与混合打分明细
  ├── 4. 情绪与稳态变化: 虚拟时间戳 virtual_ts, 裁决前状态向量 → 代码裁决后的状态 Diff
  ├── 5. 使用的策略与模型提案:
  │     ├── chosen_strategy ("empathize_and_act" | "tease" | "explicit_silence")
  │     ├── model_reported_rationale ([模型自述推演 / 非权威记录] — 供消融对照)
  │     └── theatrical_subtext ([戏剧潜台词] — 支持日常剧透遮罩)
  ├── 6. 选择的工具/执行器与权限裁决: 请求的 MCP/Skill/Shell Actuator, 三维权限引擎裁决结果 (ALLOW / DENY / REDACT)
  ├── 7. 输出行为指令: emitted_intent_id, action_type, 分段帧 chunks[] 与扩展层命名空间
  └── 8. 具身执行反馈: 收到 DeliveryReceipt 状态 (completed | interrupted), 实际送达字数 spoken_char_offset, 执行器结果
  ```
* **配套实验工具**：
  * **感官事件注入器与虚拟时间拨快控制器**：手动模拟“戳头、视觉变化”，一键拨快时间（`+15m` ~ `+30d`）并区分“运行静默 vs 关机冬眠”；
  * **模块消融开关矩阵与场景脚本回放器**：将每个认知模块独立开关，通过 `.scenario.yaml` 剧本对上述 8 步决策轨迹做确定性回归断言。

### 3.2 深层哲学与隐私设计：被白盒观测会改变她的行为吗？独白里能不能有我不该看到的东西？

这是你在梳理 WebUI 时提出的一个极为深刻的问题。我们的架构解答如下 **`[架构推断]`**：

1. **观测者效应（Observer Effect）的控制**：
   * 在技术实现上，WebUI 白盒面板是通过内核的**单向只读遥测总线（Read-Only Telemetry Bus）**拉取数据的，内核认知循环完全不依赖白盒面板是否打开。
   * 在她的认知黑板里，我们**不注入“你此刻正在被调试器逐行监控”这类破坏沉浸感的元提示**。因此，你打开或关闭白盒抽屉，她的行为分布 **100% 恒等，零观测者干扰**。
2. **独白里能不能有“主人不该看到的东西”？——【主权底线 100% 白盒 vs. 体验层剧透折叠遮罩】**：
   * **从安全与灵魂主权角度**：**绝对不能在架构底层设计任何对所有者（Owner）不可见、不可审计的“黑盒加密私密区”**。一旦允许 LLM 拥有主人看不见的隐藏独白或隐藏记忆块，当她遭遇外部网页/群聊的间接 Prompt 注入（记忆投毒）或滑向暗黑情感操控时，你将完全无法察觉和排障。
   * **从日常陪伴的浪漫与惊喜感角度**：如果她正在前瞻记忆里悄悄为你准备周末的生日惊喜，或者心里闪过一句傲娇害羞的潜台词，直接赤裸裸地摊在屏幕上确实会破坏神秘感（剧透）。
   * **两全其美的架构设计 ——【UI 剧透遮罩（Diegetic Spoiler Mask）】**：
     当她在独白或前瞻意图中生成了带有 `visibility_hint: "shy_subtext" | "surprise_preparation"` 的内容时，在控制台的**“日常半白盒陪伴模式”**下，该卡片默认显示为精致的毛玻璃遮罩：
     > 💭 *她心里闪过一个有点害羞的小念头 / 正在悄悄惦记一件想给你的小惊喜* `[点击剥开遮罩查看]`
     而在**“开发者全白盒审计模式”**下则默认全部展开。这样既做到了**工程主权上的 100% 透明可控**，又成全了**陪伴体验上的分寸与惊喜**！

---

### 3.3 正式控制台的五大治理中心与“回档认知断层”弥合机制

作为用户长期养育数字生命的主权中心，控制台包含五大治理工作区：

1. **灵魂与三层人格配置中心**：
   * 可视化管理 Tier 0（只读安全底线与 SB 243 规则）、Tier 1（不可变核心 DNA、存在论契约模式、口癖签名，修改需二次确认并生成快照）、Tier 2（可演化自我叙事，支持审批睡眠反思提交的 Diff 提议）；
   * 主动搭话策略配置（每日最大主动次数上限、退避冷却倍数、免打扰时间窗、可打扰度阈值）与多灵魂实例切换。
2. **大模型接入、脑区分层路由与预算熔断中心**：
   * 支持将 **5 大认知脑区** 分别路由到最契合的模型：
     * `Region 1: System 1 快思考对话环`（高情商、低延迟流式模型）；
     * `Region 2: System 2 深度反思与潜台词环`（强推理模型，异步运行）；
     * `Region 3: 睡眠记忆巩固与结构化提取环`（高性价比轻量模型 + JSON Schema 强约束）；
     * `Region 4: 工具调用与行动规划环`（强 Function Calling 模型）；
     * `Region 5: 边缘/多模态感知环`（本地或云端视觉/语音模型）。
   * 配置日/月 Token 预算上限，并实时预览预算衰减如何映射为算力代谢精力 $E_{\text{metabolic}}$ 与角色内“犯困/犯迷糊”降级状态。
3. **三层数据、记忆血缘与知识库治理中心**：
   * **第一层：不可变原始事件日志浏览器（Event Log Ledger）**——支持按主体、场合、时间检索审计，支持导出高质量 SFT/DPO 微调数据集；
   * **第二层：主观记忆图谱与跨平台身份绑定器（Subjective Memory & Identity Graph）**——可视化查看情景记忆、语义事实、前瞻承诺与关系维度；支持手动触发“真遗忘（级联斩断血缘 DAG）”与“话题封印（避雷针）”；管理跨平台账号的显式绑定；
   * **第三层：客观外部知识库挂载槽（Hot-Swappable Knowledge Bases）**——支持随时挂载或卸载外部文档/Wiki 知识库，并在卸载时自动保留“曾共同聊过的百字概念摘要（Gist Card）”以防卸载失忆。
4. **扩展生态与三层插件行为编排中心**：
   * 统一基于“主体与信任模型”管理：**躯壳插件（Where she exists）**、**MCP 与 Skill（What she can do）**、以及**跨端行为编排规则（何时由哪个躯壳优先响应、跨插件联动触发条件）**，并签发带权限作用域的插件 Capability Tokens。
5. **安全围栏、隐私隔离墙与 Git 式灵魂存档中心（含回档断层弥合）**：
   * 工具调用三维权限矩阵配置、全局紧急停止开关（Kill Switch）、以及像 Git 一样的时间线快照树与 `.soul` 整包导入导出。

#### 深度破局：如何处理回档造成的“我记得而她不记得”的时空认知断层？ **`[架构推断]`**
当你将她的灵魂回档到昨天（或上周）的某个 Commit 时，她的记忆回去了，但作为人类的你依然记得被回档掉的那段对话。为了妥善处理这一断层，控制台在点击“执行回档（Rollback）”时提供 **3 种显式回档语义（Rollback Semantics）**：

| 回档模式 | 适用场景 | 内核状态与虚拟时钟操作 | 她在回档后的认知表现（如何弥合断层） |
| :--- | :--- | :--- | :--- |
| **1. 静默硬回滚**<br/>*(`Silent Hard Rollback`)* | 开发调试、测试场景重放、或刚发错了一句话想彻底撤回重来 | 物理截断/回退事件日志与所有记忆投影；在沙盒模式下同步将 `VirtualClock` 拨回快照时刻 | 她完全不知道发生过回档，状态 100% 回到快照那一秒。适合你也打算当作刚才那句话没发生过的场景。 |
| **2. 诚实共知回滚**<br/>*(`Meta-Reconciled Rollback`)* | 日常陪伴中发生了不愉快的误会、OOC 崩人设或失误，双方希望体面地“翻篇重来” | 回退所有记忆、心结与状态投影至快照点，但保持当前时钟，并自动追加一条系统过渡元事件：`[系统共知事件：你与主人共同决定将记忆回退到了 T 时刻的快照，把中间一段不太顺利的小插曲翻篇了]` | **彻底消除“你记得她不记得”的诡异感！** 当你回档后对她说“还好我们把刚才那页翻过去了”，她知道你们刚刚做了一次共同翻篇，会温柔地接话：“嗯，那些不开心的小插曲就让它过去吧，我们重新开始！” |
| **3. 梦境余温回滚**<br/>*(`Diegetic Dream Bridge`)* | 沉浸角色扮演态，不想破坏叙事感，但又想撤销刚才的一段错误剧情分支 | 回退全部精确事实记忆与状态，仅将被回滚区间浓缩为一句不含具体事实的模糊印象标签 | 她会表现为“像是刚做了一个醒来就记不清内容的梦 / 有一点微妙的既视感（Déjà vu）”，既清除了错误剧情，又保留了叙事的连贯诗意。 |
