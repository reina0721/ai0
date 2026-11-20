# 05. 八大扩展维度微内核插件架构与跨插件编排引擎规范

> **项目阶段**：架构研究与工程规格设计阶段（解法域工程规格）
>
> 本文档定义支撑“由社区生态自由生长的通用数字生命中枢”的核心引擎——**《微内核八大扩展总线（The 8-Dimension Pluggable Microkernel Bus）》**。它彻底打破了普通 Agent 只有 `MCP/Skill` 工具扩展的局限，为躯壳、多模态音视频管线、大脑内部认知器官、外部工具、记忆与知识连接器、模型推理后端、灵魂模板与世界观资产包、以及控制台自定义 UI 视图提供了统一的 Manifest 与 TypeScript 接口契约。

---

## 一、为什么数字生命中枢必须拥有八大扩展维度？

普通干活型 Agent（如 Coding Agent）只需要扩展“手脚（`MCP / Skill`）”。
但一个真正的**数字生命中枢**是一个完整的赛博有机体：社区开发者和用户不仅希望给她装上不同的“手脚”，更渴望为她装上不同的**身体容器（桌宠/Live2D/游戏）、嗓音与耳朵（GPT-SoVITS 情感 TTS / 流式 ASR）、新的大脑认知脑区（做梦器 / 细腻情绪模型）、外部活体记忆源（Obsidian/Notion）、本地或微调模型声线（LoRA）、可分享的灵魂人设与世界观资产包（Soul Templates / Lorebooks），并在控制台里看到自己插件的专属监控面板**。

为此，`@ai0/kernel` 与 `@ai0/sdk` 提供统一的插件包规范（`ai0.extension.json`）与八大强类型扩展点（Extension Points）。

---

## 二、统一插件包清单规范 (`ai0.extension.json`)

所有类型的社区扩展均通过统一的声明式清单注册其扩展维度、所需的权限范围以及向 WebUI 控制台贡献的配置表单或监控卡片：

```json
{
  "manifest_version": "1.0.0",
  "extension_id": "community.organ.dream-journal",
  "display_name": "睡眠期梦境与悄悄话日记器官",
  "version": "0.2.1",
  "author": "example-community",
  "dimension": "ext.cognitive_organ",
  "entry": "./dist/index.js",
  "permissions": {
    "read_blackboard_domains": ["D2_HOMEOSTASIS_AFFECT", "D3_MEMORY_PROJECTION"],
    "propose_mutation_domains": ["D3_MEMORY_PROJECTION"],
    "max_audience_scope": "only_owner",
    "network_access": false
  },
  "console_contributions": {
    "config_schema": "./schema/config.json",
    "ui_slots": [
      {
        "slot_target": "workspace.soul.memory_tab",
        "widget_type": "markdown_card_list",
        "title": "🌙 她的睡眠梦境日记本",
        "data_endpoint": "organ.dream-journal.list_entries"
      }
    ]
  }
}
```

---

## 三、八大扩展维度（Extension Points）核心接口契约

### 维度 1：具身运行环境扩展 (`ext.shell`)
* **职责**：决定数字生命“在哪里存在、能感知什么环境、能渲染什么表达、能在宿主端侧执行什么动作”。
* **接入协议**：通过 `Protocol v0` WebSocket 跨进程/跨网络接入 `@ai0/gateway`（详见第 04 篇），无需运行在内核进程内，可使用任何语言（TypeScript / Python / C# Unity / C++ Unreal / Rust）开发。

### 维度 2：多模态感官与表达媒体管线扩展 (`ext.media_pipeline`)
* **职责**：位于具身躯壳与认知内核之间的**流式媒体加工中间件**。让极简躯壳无需自己捆绑庞大的语音/视觉模型即可获得顶级多模态能力。
* **核心接口契约**：
  ```typescript
  export interface IMediaPipelineExtension {
    readonly id: string;
    /** 上行：将原始音频流/视频帧转化为标准化语义 PerceptionEnvelope (如 Whisper ASR + 语气情绪识别 / 视觉皱眉检测) */
    onUpstreamMediaFrame?(frame: RawMediaChunk, context: ShellContext): AsyncGenerator<Partial<PerceptionEnvelope>>;
    
    /** 下行：将内核吐出的 ExpressionEnvelope (含 ext.affect.v1 & ext.rhythm.v1) 合成为情感语音流与口型同步帧 (Visemes) */
    onDownstreamExpression?(intent: ExpressionEnvelope): AsyncGenerator<SynthesizedAudioVisemeChunk>;
  }
  ```

### 维度 3：大脑认知器官与生命周期钩子扩展 (`ext.cognitive_organ`)
* **职责**：允许社区研究者和开发者**向大脑内部插入新的认知脑区或替换默认算法**，并且天然享受内核的**“一键消融开关（Ablation Toggle）”**与**“权威状态协调器事务保护”**！
* **核心接口契约**：
  ```typescript
  export interface ICognitiveOrganExtension {
    readonly organId: string;
    readonly defaultEnabled: boolean; // 支持在控制台随时关闭以做消融对比实验

    /** 钩子 1：在编译 System 1 认知黑板前调用，可向黑板贡献自定义身心体感或注意力提示 (受 Token 预算硬约束) */
    contributeToBlackboard?(snapshot: ReadOnlyCognitiveSnapshot, maxTokens: number): Promise<BlackboardContribution | null>;

    /** 钩子 2：在每轮交互结束后异步调用，评估事件并向协调器提交状态变更提案 (LLM 提议、代码裁决) */
    onTurnCompleted?(turnTrace: VerifiableTurnTrace, snapshot: ReadOnlyCognitiveSnapshot): Promise<StateMutationProposal[]>;

    /** 钩子 3：在 VirtualClock 跨越睡眠/空闲阈值唤醒 W3 时调用 (如：自定义睡眠记忆压缩算法、做梦灵感生成) */
    onSleepCycleWakeup?(snapshot: ReadOnlyCognitiveSnapshot, rawDirtyEvents: ReadonlyArray<EventLogRecord>): Promise<StateMutationProposal[]>;
  }
  ```

### 维度 4：行动工具与技能包扩展 (`ext.action_mcp_skill`)
* **职责**：为大脑的 **8 步一等行动认知环（`W2`）** 提供外部世界操作能力。
* **支持形态**：
  1. **标准 MCP Servers（`stdio` / `SSE` / `Streamable HTTP`）**：无缝兼容现有 MCP 生态；
  2. **复合行动技能包（`SKILL.md` + 脚本工作流）**：声明多步任务的标准操作规范与前置检查。
* **安全强制约束**：所有调用必须先通过内核 `ThreeDimensionalPolicyEngine.evaluate(Principal, Audience, CapabilityRisk)` 的确定性裁决。

### 维度 5：记忆引擎与活体知识源连接器扩展 (`ext.memory_knowledge`)
* **职责**：扩展长期记忆的检索重排算法，或将外部动态数据源作为**可热插拔客观知识库（Hot-Swappable Knowledge Bases）**挂载给大脑。
* **核心接口契约**：
  ```typescript
  export interface IKnowledgeConnectorExtension {
    readonly connectorId: string; // 如 "connector.obsidian.vault" | "connector.wiki.eldenring"
    /** 按需检索外部知识切片 (返回结果由内核强制打上 taint_level='untrusted_external' 防记忆投毒) */
    retrieveSlices(query: string, topK: number): Promise<ExternalKnowledgeSlice[]>;
    /** 当该知识库被卸载 (Unmount) 时，将曾被高权重引用的切片浓缩为百字常识卡 (Gist Card) 留存于长期记忆 */
    extractGistCardsBeforeUnmount(citedSliceIds: string[]): Promise<CrystallizedGistCard[]>;
  }
  ```

### 维度 6：模型与推理后端提供商扩展 (`ext.model_provider`)
* **职责**：为五大认知脑区（快思考对话、慢思考反思、睡眠记忆提取、行动规划、多模态感知）以及 L0 本地安全危机分类器提供可插拔算力后端。
* **扩展能力**：支持接入云端大模型、本地 Ollama / vLLM / llama.cpp、自定义 Embedding / Reranker，以及**角色专属 LoRA 适配器热切换**与 Token 成本实时计量。

### 维度 7：灵魂资产、世界观词库与评测剧本包 (`ext.soul_asset`)
* **职责**：让社区能够像分享游戏 Mod 一样，安全地分享与装载“灵魂基因与测试基准”：
  1. **纯净灵魂模板包（`.soul-template.yaml`）**：打包 Tier 1 核心人格 DNA、存在论契约、作息参数与初始黄金声线样本（**物理剥离一切个人聊天流水与私密记忆**，确保分享零隐私风险）；
  2. **世界观词条库（`Lorebook / WorldInfo`）**：当对话出现特定关键词或语义聚类时，动态滑入认知黑板的背景设定词条；
  3. **回归评测剧本包（`.scenario.yaml`）**：社区共建的“人设抗崩塌测试集”、“SB 243 危机干预合规测试集”、“跨场合隐私防套话测试集”；
  4. **现世二次元社区存量资产零摩擦吸纳（SillyTavern `Character Card V2/V3 & WorldInfo` 官方蒸馏与安全清洗转换器）**：
     为使 `ai0` 开箱即可继承现世二次元 AI 社区沉淀的海量精品角色资产，`@ai0/storage` 与 `@ai0/sdk` 内置确定性的 Tavern Card 导入蒸馏管线：
     * **`data.description` & `data.personality`** $\rightarrow$ 结构化提取并映射至 `identity.yaml`（Tier 1 角色背景基线与核心性格特征）；
     * **`data.mes_example` & `data.first_mes` / `data.alternate_greetings`** $\rightarrow$ 自动按 `<START>` 切分对话对，提纯写入 `voice_exemplars.jsonl`（黄金声线锚点池），供换模型或预算降级时的动态 Few-Shot 声线校准使用；
     * **`data.character_book`（WorldInfo）** $\rightarrow$ 无损转换至 `lorebooks/imported_world.yaml`（保留 `keys`、`secondary_keys`、激活优先级与受控 Token 预算）；
     * **安全清洗防火墙（Prompt-Injection & Jailbreak Sanitizer）**：在导入阶段由代码强制剥离传统角色卡 `data.system_prompt` 与 `data.post_history_instructions` 中常见的越狱指令、覆盖系统安全底线的伪造 System 标签以及情感 PUA 留存脚本，确保导入后的 `.soul-template` 100% 遵守本架构的 Tier 0 安全不变量与双层存在论契约。

### 维度 8：控制台 UI 视图与观测卡片扩展 (`ext.console_ui`)
* **职责**：让第三方插件不再是“后台黑盒”，允许任何插件向 `WebUI 控制台` 的指定插槽（Slots）动态注入配置表单与实时状态监控卡片（详见第 06 篇）。

---

## 四、跨插件行为编排与多端注意力路由引擎（Cross-Plugin Orchestration Engine）

当用户同时安装了多个躯壳插件（如：桌面萌宠 + 手机 Telegram + 直播间插件）、多个媒体管线与多个行动工具时，内核通过声明式的 **《行为编排规则表（`orchestration_rules.yaml`）》** 统一仲裁：

```yaml
# 1. 多端同时在线时的前台注意力焦点仲裁规则
attention_focus_arbitration:
  focus_hysteresis_window_ms: 4000          # 当前活跃躯壳的话轮保持惯性窗口，防止焦点高频横跳
  priority_order:
    - match: { event_urgency: "l0_crisis" }
      action: "preempt_immediately"
    - match: { principal: "owner_verified", venue_type: "private_1on1" }
      weight: 100
    - match: { venue_type: "local_ambient", shell_kind: "desktop_avatar" }
      weight: 80
    - match: { venue_type: "group_chat" }
      weight: 50
    - match: { venue_type: "public_livestream" }
      weight: 40

# 2. 主动搭话 (Proactive Initiation) 的出口躯壳选择策略
proactive_routing_policy:
  never_broadcast_to_all_shells: true       # 铁律：严禁全端同时弹窗广播!
  preferred_target_selection:
    - "last_active_private_shell_within_2h" # 优先发往 2 小时内互动过的私密躯壳
    - "online_desktop_avatar_if_user_active"# 其次发往检测到用户正在电脑前的桌面躯壳
    - "fallback_primary_im_private"         # 最后回退至主私聊 IM

# 3. 跨插件事件-行动联动规则 (Event-Condition-Action Rules)
cross_plugin_triggers:
  - rule_id: "late_night_coding_care"
    when:
      source_shell: "community.desktop.companion"
      semantic_event: "sensor.active_window_sustained"
      condition: "window_category == 'ide_coding' && circadian_phase == 'late_night_sleep_window'"
    then:
      route_to_brain_organ: "organ.homeostasis"
      inject_situational_cue: "主人已经在深夜连续写代码超过 2 小时，请在合适间隙温柔提醒他保存代码去休息"
```
