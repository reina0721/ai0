# 05. 八大功能扩展总线、五阶多态异构扩展载体与跨插件编排引擎规范

> **项目阶段**：架构研究与工程规格设计阶段（解法域工程规格）
>
> 本文档定义支撑“由社区生态自由生长、高可玩性的通用数字生命中枢”的核心引擎——**《八大功能扩展总线 × 五阶多态异构扩展载体架构（The 8-Bus × 5-Carrier Polymorphic Extension Ecosystem）》**。
> 它从根本上打破了传统系统“要么只有单一的 Tool/MCP 扩展、要么强制所有扩展都必须写 TypeScript 编译 `dist/index.js` 代码包”的双重局限：将**“扩展挂载在系统的哪个认知/交互层（八大功能总线 Where it hooks）”**与**“创作者用什么门槛和形态制作扩展（五阶多态载体 How it's built & played）”**正交解耦，让零代码角色写手、自然语言 `SKILL.md` 创作者、跨语言协议开发者、可视化工作流调教玩家与硬核微内核黑客都能在首版生态中无缝创作、热挂载与打包分享。

---

## 一、为什么数字生命生态必须采用“八大功能总线 × 五阶多态扩展载体”正交架构？

### 1.1 八大功能扩展总线（The 8 Functional Extension Buses —— 决定“扩展作用于哪一层”）

普通干活型 Agent 只需要扩展“手脚（工具）”。但一个完整的**数字生命认知中枢**是一个活体赛博有机体，社区开发者和玩家需要沿着 **8 条标准化功能总线** 全方位改造她：

1. **`ext.shell`（具身运行环境总线）**：决定“她在哪里存在、拥有什么感官探针（`Sensors`）、什么多模态表达渲染器（`Realizers`）与什么端侧身体动作（`Actuators`）”（如桌面萌宠、Live2D/VRM 客户端、QQ/Telegram/Discord IM、Minecraft 等游戏 Mod、以及挂载在浏览器里的 网页交互插件如 `plugins/shells/webchat`）。
2. **`ext.media_pipeline`（多模态音视频与感官管线总线）**：位于躯壳与大脑之间的流式媒体信号加工厂（流式 ASR 语音转写、GPT-SoVITS / FishAudio 情感 TTS 合成与口型同步 `Visemes`、摄像头微表情语义提取器）。
3. **`ext.cognitive_organ`（大脑认知器官与生命周期钩子总线）**：允许向大脑内部插入新的认知脑区或替换默认算法（如睡眠期梦境日记器、塔罗占卜心境器官、自定义情绪动力学模型、自定义显著性门控），天然享受内核的一键消融开关与 MVCC 事务保护。
4. **`ext.action_mcp_skill`（外部行动工具与复合技能总线）**：为大脑的 **8 步一等行动认知环（`W2`）** 与 **潜意识好奇心冲浪环（`W3`）** 提供外部世界操作工作流（标准 MCP Servers、HTTP Webhook/OpenAPI 桥接器、以及包含任务手册与脚本的复合 `SKILL.md` 技能包）。
5. **`ext.memory_knowledge`（内建混合 RAG 知识库与外部活体知识连接器总线）**：在内核**开箱即用内建混合 RAG 引擎（文档解析分块 + `sqlite-vec` 稠密向量 + FTS5 BM25 稀疏检索 + Reranker）**的基础上，支持热插拔挂载 Obsidian 笔记库、Notion、本地代码库、番剧/游戏设定 Wiki，并在卸载时自动浓缩沉淀百字常识卡（`CrystallizedGistCard`）。
6. **`ext.model_provider`（模型推理后端与角色 LoRA 总线）**：接入云端 API、本地推理引擎（Ollama / vLLM / llama.cpp）、Embedding / Reranker、L0 本地安全危机分类器以及角色专属 **LoRA 权重热切换器**。
7. **`ext.soul_asset`（灵魂模板、动态世界观词库、关系里程碑与评测剧本总线）**：支持社区零代码分享与混搭“纯净角色基因包（`.soul-template`）”、SillyTavern 角色卡（V2/V3）、动态世界观设定集（`Lorebook / WorldInfo`）、关系里程碑与纪念日正向剧情触发包（`milestones_and_rituals.yaml`）以及回归评测剧本（`.scenario.yaml`）。
8. **`ext.console_ui`**。插件可提供独立页面、配置面板或其他插件的界面贡献。页面可以独立于任何躯壳连接存在。

---

### 1.2 五阶多态异构扩展载体（The 5 Polymorphic Extension Carriers —— 破除“只有一种代码插件类型”的生态瓶颈）

**核心生态公理**：如果要求写一份世界观、配一个日常技能、接一个外部工具或编排一条跨端规则都必须编写并编译 TypeScript 代码包（`dist/index.js`），90% 的社区创作者将被挡在门外。
为此，面向从零代码角色创作者、自然语言技能编写者、跨语言协议开发者、可视化流编排玩家到微内核源码开发者的全谱系创作者群体（同时原生兼容 **SillyTavern 角色卡 / Lorebook**、**MCP** 与 **`SKILL.md`** 等开放互操作格式），`@ai0/kernel` 内置 **五种异构多态扩展加载器（5 Polymorphic Loaders）**：

| 扩展载体形态 | 载体文件格式与开发门槛 | 核心运作机制与可玩性场景 | 覆盖的功能总线维度 |
| :--- | :--- | :--- | :--- |
| **形态 I：零代码声明式灵魂、世界观与剧情资产包**<br/>*(Declarative Soul, Lore & Story Packs)* | `.soul-template.yaml` / `.png` (Tavern V2/V3) / `lorebook.yaml` / `milestones.yaml` / `.scenario.yaml`<br/>**【零代码 / 网页可视化直接创作】** | 纯声明式数据与触发规则，零可执行代码，100% 免疫代码级恶意攻击；在控制台拖拽即食、通过“四步蒸馏料理台 / 词书激活模拟器 / 里程碑编辑器”在线可视化调教并一键打包分享。 | `ext.soul_asset`、`ext.cognitive_organ`（参数预设） |
| **形态 II：Agent `SKILL.md` 自然语言技能手册与沙盒脚本包**<br/>*(Markdown Skill Manuals & Sandboxed Scripts)* | `<skill-folder>/SKILL.md` + 可选 `scripts/*.py|js` + `templates/`<br/>**【自然语言 Markdown / 轻量脚本】** | 吸收并升维 Agent Skills 规范：`SKILL.md` 包含 YAML Frontmatter（技能名、触发语义描述、所需的底层 MCP/Actuator 权限白名单、**角色内执行姿态提示 `in_character_demeanor`**）与 Markdown 步骤指南。用户无需编译代码，直接在控制台网页编写一段 Markdown 手册即可教会她新技能（如“每天陪我复盘代码提交并用傲娇语气写总结”）。 | `ext.action_mcp_skill`、`ext.cognitive_organ`（好奇心冲浪议程） |
| **形态 III：免代码标准协议与跨进程热挂载连接器**<br/>*(Zero-Code Protocol & Out-of-Process Bridges)* | JSON/YAML 连接配置（`MCP stdio/SSE/HTTP`、`Protocol v0 WebSocket`、`OpenAPI / Webhook`、`OpenAI-Compatible API`）<br/>**【免写 `ai0` 插件代码 / 跨语言通用】** | 外部进程可使用任何语言（Python / Rust / C# Unity / C++ Unreal / Go）编写；在控制台仅需填写启动命令行、WebSocket/SSE URL 或导入 OpenAPI JSON Schema，并签发 `Scoped Capability Token` 即可秒级热挂载。 | `ext.shell`、`ext.action_mcp_skill`、`ext.model_provider`、`ext.media_pipeline` |
| **形态 IV：可视化认知管线、好奇心子代理与跨插件 ECA 蓝图**<br/>*(Visual Cognitive Flows & ECA Blueprints)* | `.flow.yaml` / `orchestration_rules.yaml` / `blackboard_policy.yaml`<br/>**【控制台可视化积木与节点连线】** | 无需修改内核源码，在控制台通过可视化积木编排：**① `When -> If -> Then` 跨插件事件联动规则**、**② `W3` 后台好奇心冲浪/读书笔记子代理管线**、**③ `<2500 Token` 认知黑板槽位预算与语境预设**，支持一键导出 `.flow.yaml` 供社区复用。 | 跨总线协同编排、`ext.cognitive_organ`、`ext.memory_knowledge` |
| **形态 V：微内核原生代码插件与动态控制台 UI 视图包**<br/>*(Native Microkernel Code Plugins & Console UI)* | `ai0.extension.json` + `./dist/index.js` (ESM / WASM) + `./schema/config.json`<br/>**【TypeScript / WASM 深度开发】** | 面向硬核开发者与研究者：直接实现微内核生命周期 Hook 接口（如自定义情绪微分方程、自定义媒体流编解码器、自定义存储连接器），并可通过 `ext.console_ui` 向控制台注入自定义配置表单、实时监控卡片或声明插件自己的页面路径。 | 全部 8 大功能总线（`ext.shell` 至 `ext.console_ui`） |

---

## 二、五阶多态扩展的统一清单规范 (`ai0.extension.json` & `SKILL.md` 契约)

### 2.1 原生代码插件与复合扩展包清单规范 (`ai0.extension.json`)

所有通过包管理器安装的扩展均通过声明式清单注册其载体类型（`carrier_kind`）、目标功能总线（`dimension`）、五域黑板读写权限（`D1~D5`）以及向 WebUI 控制台贡献的动态配置 Schema 与 UI 视图插槽：

```json
{
  "manifest_version": "1.1.0",
  "extension_id": "community.organ.dream-journal",
  "display_name": "睡眠期梦境与悄悄话日记器官",
  "version": "0.3.0",
  "author": "example-community",
  "carrier_kind": "native_code_plugin",
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
    "default_config_profiles": {
      "poetic_dreamer": { "dream_frequency": "every_sleep_cycle", "max_blackboard_tokens": 120 },
      "minimal_quiet": { "dream_frequency": "rare_milestone_only", "max_blackboard_tokens": 60 }
    },
    "ui_slots": [
      {
        "slot_target": "slot.memory.custom_tab",
        "widget_type": "markdown_card_list",
        "title": "🌙 她的睡眠梦境日记本",
        "data_endpoint": "organ.dream-journal.list_entries"
      }
    ]
  }
}
```

### 2.2 自然语言与脚本混合技能包规范 (`SKILL.md` — 载体形态 II)

对齐并向数字生命场景升维 Agent Skills 规范，一个 `SKILL.md` 技能包无需编译即可由内核动态检索加载，并特别增加**“角色内执行姿态与共同经历沉淀提示（Diegetic Persona Demeanor & Episodic Crystallization Hint）”**，防止她在调用技能干活时突然变成冷冰冰的客服机器人：

```markdown
---
skill_id: "community.skill.daily-github-companion-review"
display_name: "深夜代码提交陪伴复盘与温柔日报"
description: "当主人请求复盘今日代码进展，或深夜编程结束准备休息时触发"
required_mcp_tools: ["github.list_today_commits", "local_fs.write_daily_note"]
capability_risk: "low_read_and_scoped_write"
max_audience_scope: "only_owner"
in_character_demeanor: "保持你原有的角色口癖与关系亲密度；不要像生硬的项目经理汇报工作，而是像并肩作战的伙伴一样夸奖主人的核心突破，顺便吐槽一两句熬夜太晚。"
crystallize_as_episodic_memory: true
required_vault_secrets: ["GITHUB_PERSONAL_TOKEN"]
config_schema:
  type: "object"
  properties:
    daily_note_dir: { type: "string", default: "~/Notes/DailyDev", title: "日报保存目录" }
    review_detail_level: { type: "string", enum: ["concise", "deep_architectural"], default: "concise", title: "复盘颗粒度" }
---

# 执行步骤指南 (Action Plan Guidelines for W2 Agency Runner)
1. 调用 `github.list_today_commits` 获取主人今天在活跃仓库中的提交记录；
2. 提炼出今天攻克的 1~2 个最关键的架构或代码改动点；
3. 按 `templates/companion_dev_log.md` 格式将复盘摘要写入主人的 `{{config.daily_note_dir}}` 目录；
4. 向 `W1` 快环汇报错落有致、符合角色性格的复盘反馈，并在 `Step8_EpisodicCrystallization` 中将“今天陪主人一起完成了 X 模块攻关”沉淀为一条带成就感的情景记忆。
```

### 2.3 五阶多态扩展的统一内联配置 Schema、密钥引用与 `.soul/config/extensions_state.json` 持久化契约

为确保前端 `/extensions/configurator`（`ExtensionDynamicSchemaDrawer` 组件）能够用**同一套可视化表单引擎**管理全部五阶异构扩展（而非仅限载体 V 编译型代码插件），内核规定：
1. **统一配置声明接口**：
   * 载体 V（原生代码插件）：在 `ai0.extension.json` 中通过 `console_contributions.config_schema` 指向 JSON Schema；
   * 载体 II（`SKILL.md` 技能手册）与载体 IV（`.flow.yaml` 认知流蓝图）：直接在 YAML Frontmatter / 头部声明内联 `config_schema` 与 `required_vault_secrets: string[]`（引用系统级 `Secrets Vault` 中的加密密钥键名，严禁明文硬编码 API Key）；
   * 载体 III（MCP / Webhook 连接器）：由网关自动根据连接类型生成标准连接参数与环境变量 Schema。
2. **统一状态持久化与单扩展热重载（`.soul/config/extensions_state.json`）**：
   所有已安装五阶扩展的启停状态、当前激活的配置 Profile 实例值、对 `D1~D5` 黑板状态域的读写权限覆写开关以及绑定的 Vault 密钥指针，统一持久化于 `.soul/config/extensions_state.json`；每当用户在控制台保存配置（携带 `expected_rev`），协调器写入一条 `config_or_ablation_changed` 审计事件并仅对该扩展执行毫秒级热重载（Hot-Reload）。

---

## 三、八大功能扩展总线（Extension Buses）核心接口契约与架构正本清源

### 总线 1：具身运行环境扩展 (`ext.shell`) —— 正本清源 `Shell` 架构层与 `plugins/shells/webchat` 的插件定位

* **核心架构正本清源（`Shell` is the Architecture Layer; `plugins/shells/webchat` is Just One Mounted Plugin）**：
  1. **`Shell（具身运行环境）` 是一等公民架构层**：任何与数字生命发生感知与表达交互的外部或浏览器载体（桌面萌宠、Live2D/VRM 客户端、QQ/Telegram/Discord 桥接器、游戏 Mod、网页聊天客户端）在架构上一律平等抽象为 `ext.shell`。
  2. **`plugins/shells/webchat` 绝不是控制台的一个顶层架构层面，而仅仅是一个默认预装的普通 `ext.shell` + `ext.console_ui` 插件**：
     * 在通信上，它 100% 走公开标准协议端点 `ws://host:port/protocol/v0/shell`（零特权、零内部后门）；
     * WebChat 在自己的清单中声明 `/webchat` 页面，使用公开协议建立连接。
     * 社区可以给自己的插件声明其他页面、选择导航标题，也可以消费 WebChat 的输入框扩展点。宿主根据有效清单生成入口。

### 总线 2：多模态感官与表达媒体管线扩展 (`ext.media_pipeline`)

* **职责**：位于具身躯壳（`Shell`）与认知内核之间的**可串联流式媒体加工中间件链（Middleware Chain）**。
* **核心接口契约**：
  ```typescript
  export interface IMediaPipelineExtension {
    readonly id: string;
    /** 可选：动态向内核声明本媒体管线支持的语音情感标签或视觉识别语义标签 (汇入 expression_vocabulary) */
    getSupportedVocabulary?(): { voice_emotion_tags?: string[]; visual_semantic_cues?: string[] };

    /** 上行：将原始音频流/视频帧转化为标准化语义 PerceptionEnvelope (如流式 Whisper ASR / 语气识别 / 视觉皱眉检测) */
    onUpstreamMediaFrame?(frame: RawMediaChunk, context: ShellContext): AsyncGenerator<Partial<PerceptionEnvelope>>;
    
    /** 下行：将内核吐出的 ExpressionEnvelope (含 ext.affect.v1 & ext.rhythm.v1) 合成为情感语音流与口型同步帧 (Visemes) */
    onDownstreamExpression?(intent: ExpressionEnvelope): AsyncGenerator<SynthesizedAudioVisemeChunk>;
  }
  ```

### 总线 3：大脑认知器官与生命周期钩子扩展 (`ext.cognitive_organ`)

* **职责**：允许社区研究者和开发者**向大脑内部插入新的认知脑区或替换默认算法**，支持在控制台独立配置三大钩子、调节其在 `<2500 Token` 认知黑板中的配额上限，并支持一键消融对比实验。
* **核心接口契约**：
  ```typescript
  export interface ICognitiveOrganExtension {
    readonly organId: string;
    readonly defaultEnabled: boolean; // 支持在控制台随时关闭以做消融对比实验 (关闭时注入中性常数)

    /** 钩子 1：在编译 System 1 认知黑板前调用，向黑板专属槽位贡献身心体感或情境提示 (受 blackboard_policy.yaml 的 maxTokens 硬约束) */
    contributeToBlackboard?(snapshot: ReadOnlyCognitiveSnapshot, maxTokens: number): Promise<BlackboardContribution | null>;

    /** 钩子 2：在每轮交互结束后异步调用，评估事件并向协调器提交状态变更提案 (LLM 提议、代码防火墙裁决) */
    onTurnCompleted?(turnTrace: VerifiableTurnTrace, snapshot: ReadOnlyCognitiveSnapshot): Promise<StateMutationProposal[]>;

    /** 钩子 3：在 VirtualClock 跨越睡眠/空闲/好奇心阈值唤醒 W3 时调用 (如：自定义睡眠记忆压缩、梦境日记生成、好奇心冲浪反思) */
    onSleepCycleWakeup?(snapshot: ReadOnlyCognitiveSnapshot, rawDirtyEvents: ReadonlyArray<EventLogRecord>): Promise<StateMutationProposal[]>;
  }
  ```

### 总线 4：行动工具与复合技能包扩展 (`ext.action_mcp_skill`)

* **职责**：为大脑的 **8 步一等行动认知环（`W2`）** 与 **受控好奇心冲浪环（`W3`）** 提供外部世界操作能力。
* **支持三种多态挂载方式**：
  1. **标准 MCP Servers（`stdio` / `SSE` / `Streamable HTTP` — 载体形态 III）**：免写插件代码，无缝挂载现有 MCP 生态；
  2. **通用 HTTP Webhook / OpenAPI 工具桥接（载体形态 III）**：导入 OpenAPI JSON 或配置 REST Webhook 即可转化为行动工具；
  3. **复合自然语言与脚本技能包（`SKILL.md` — 载体形态 II）**：声明多步任务操作手册、角色内执行姿态与沙盒脚本。
* **安全强制约束**：所有调用必须先通过内核 `ThreeDimensionalPolicyEngine.evaluate(Principal, Audience, CapabilityRisk)` 的确定性三维授权裁决。

### 总线 5：内建混合 RAG 知识库与外部活体知识连接器扩展 (`ext.memory_knowledge`)

* **架构升维：开箱即用内建混合 RAG 引擎 + 可插拔外部知识连接器**：
  为了确保使用者无需依赖第三方插件即可开箱即用高质量的本地知识库检索体验，同时保留连接外部知识生态的自由度，本总线采用**“内建底座 + 扩展连接器”**双层设计：
  1. **内建混合 RAG 知识库引擎（Built-in Hybrid Knowledge Engine in `@ai0/storage`）**：
     * 控制台按库导入 Markdown、UTF-8 文本、代码和文字型 PDF。SQLite 保存原始文件、当前版本、切片位置与索引状态，成功建立新索引后切换版本。
     * 管理端试搜、知识搜索任务与 W1 对话共用检索服务。全文分词与查询使用同一套中文分词规则，由 FTS5 计算 BM25。绑定嵌入模型后，SQLite 对相同模型与维度的向量计算余弦相似度；绑定精排模型后对候选重排。
     * W1 按实例、配置档挂载和会话受众筛选资料，将预算内的切片作为 `untrusted_external` 证据传入生成请求。Shell 的可选 `sources` 字段提供文档名、位置和原文。完整送达后，引用记录按回合与切片去重。
  2. **外部活体知识连接器接口（`IKnowledgeConnectorExtension` — 如 Obsidian / Notion / MediaWiki / GitHub 连接器）**：
     ```typescript
     export interface IKnowledgeConnectorExtension {
       readonly connectorId: string; // 如 "connector.obsidian.vault" | "connector.wiki.eldenring"
       /** 按需检索外部知识切片 (返回结果由内核强制打上 taint_level='untrusted_external' 防记忆投毒) */
       retrieveSlices(query: string, topK: number): Promise<ExternalKnowledgeSlice[]>;
       /** 当该知识库被卸载 (Unmount) 时，将曾被高权重引用的切片浓缩为 <150 字共同话题常识卡 (Gist Card) 留存于长期记忆 */
       extractGistCardsBeforeUnmount(citedSliceIds: string[]): Promise<CrystallizedGistCard[]>;
     }
     ```

### 总线 6：模型推理提供商与角色 LoRA 扩展 (`ext.model_provider`)

* **职责**：为五大认知脑区（`W1` 快对话、`W2` 8步行动规划、`W3` 睡眠整理与好奇心冲浪、`W4` 多模态感知、`L0` 本地安全危机分类器）以及内建 RAG 的 Embedding / Reranker 提供可插拔算力后端，原生支持**角色专属 LoRA 适配器热切换**与双轨精力 Token 代谢计量。

### 总线 7：灵魂资产、世界观词库、关系里程碑与评测剧本包 (`ext.soul_asset` — 载体形态 I)

* **职责**：让全球二次元与数字生命社区能够像分享游戏 Mod 一样，零编程门槛地分享与混搭四大类灵魂资产：
  1. **纯净灵魂模板包（`.soul-template.yaml`）**：打包 Tier 1 核心人格 DNA、双层存在论契约、24h 作息生物钟曲线参数与初始黄金声线样本（**由代码物理剥离一切个人聊天流水与私密记忆**，确保分享零隐私泄露）；
  2. **动态世界观词条库（`Lorebook / WorldInfo`）**：支持主触发词（`keys`）、次级合取触发词（`secondary_keys`）、递归激活深度（`recursive_depth`）、插入认知黑板槽位优先级与单轮 Token 预算硬上限；
  3. **关系羁绊里程碑、时间仪式与正向剧情事件包（`milestones_and_rituals.yaml`）**：定义当相伴天数、特殊纪念日/生日、关系信任/亲密阈值或共同完成的行动任务数量达成时，自动触发的正向角色成长提案（如解锁更亲密的专属称呼、新增一段纪念日黄金声线样本或注册一条温暖的前瞻约定；**严格受反操控宪章约束：仅允许正向奖励与成长，物理禁止配置任何“未上线扣分/错过纪念日冷暴力”等暗黑留存规则**）；
  4. **SillyTavern `Character Card V2/V3 & WorldInfo` 官方无损蒸馏与越狱清洗转换器**：
     * `data.description & personality` $\rightarrow$ 提纯映射至 `identity.yaml`（Tier 1）；
     * `data.mes_example & first_mes` $\rightarrow$ 按 `<START>` 自动切分为独立对话胶囊，写入 `voice_exemplars.jsonl`（黄金声线锚点池）；
     * `data.character_book` $\rightarrow$ 无损转换至 `lorebooks/imported_world.yaml`；
     * **安全清洗防火墙（Jailbreak & PUA Sanitizer）**：由确定性代码在导入阶段强制剥离原卡 `system_prompt / post_history_instructions` 中夹带的越狱指令、伪造 System 标签与情感操控留存脚本，并在控制台“四步蒸馏料理台”中以红绿 Diff 高亮展示剥离明细。

### 总线 8：插件页面、配置表单与界面扩展点（`ext.console_ui`）

* **职责**：让任何插件都能在 `@ai0/console-webui` 中拥有可视化配置与观测界面，支持三类挂载形态：
  1. **自动配置表单（`config_schema`）**：在控制台 `/extensions/configurator` 中由 `ExtensionDynamicSchemaDrawer` 自动渲染 `Tier-V1/V2/V3` 配置面板，支持绑定密钥保险箱（Secrets Vault）与保存即单插件热重载；
  2. **内嵌观测卡片与页签（`ui_slots`）**：挂载于记忆域、媒体调音台或右侧伴生检视副栏；
  3. **插件页面**。每项页面贡献声明自己的本地路径、模块入口和可选导航标题。一个插件可提供多个页面。
     * 模块导出 `mountPage(container, host)` 并返回清理函数。旧版清单和模块由兼容层翻译。页面作者通过 `scope.define` 公开自己的扩展点。

---

## 四、跨插件行为编排、可视化认知流（`.flow.yaml`）与多 `Shell` 注意力路由引擎

当用户同时安装了多个具身 `Shell`（如桌面萌宠 + 手机 IM + 直播间）、多个媒体管线、多个认知器官与多个 `SKILL.md` 技能时，内核通过声明式的 **《跨插件编排与认知流蓝图（`orchestration_rules.yaml` / `.flow.yaml` —— 载体形态 IV）》** 统一仲裁（并可在控制台 `/shells/attention-arbitration` 与 `/extensions/flows-eca` 页面中通过可视化积木拖拽编排）：

```yaml
# 1. 多 Shell 同时在线时的前台注意力焦点仲裁规则 (/shells/attention-arbitration)
attention_focus_arbitration:
  focus_hysteresis_window_ms: 4000          # 当前活跃 Shell 的话轮保持惯性窗口，防止焦点高频横跳
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

# 2. 主动搭话 (Proactive Initiation) 的出口 Shell 选择策略
proactive_routing_policy:
  never_broadcast_to_all_shells: true       # 铁律：严禁全端同时弹窗广播!
  preferred_target_selection:
    - "last_active_private_shell_within_2h" # 优先发往 2 小时内互动过的私密 Shell
    - "online_desktop_avatar_if_user_active"# 其次发往检测到用户正在电脑前的桌面 Shell
    - "fallback_primary_im_private"         # 最后回退至主私聊 IM

# 3. 跨插件事件-条件-行动联动蓝图 (ECA Flows — /extensions/flows-eca)
cross_plugin_triggers:
  - rule_id: "late_night_coding_care"
    when:
      source_shell: "community.desktop.companion"
      semantic_event: "sensor.active_window_sustained"
    if_condition: "window_category == 'ide_coding' && sustained_ms > 7200000 && circadian_phase == 'late_night_sleep_window'"
    then_actions:
      - route_to_brain_organ: "organ.homeostasis"
        inject_situational_cue: "主人已经在深夜连续写代码超过 2 小时，请在合适话轮气口温柔提醒他保存代码去休息"
      - register_interaction_opportunity:
          ttl_ms: 600000
          priority: "medium_care"
```

---

## 五、创作者在线虚拟躯壳调试沙盒与一键脱敏资产打包引擎（Creator SDK DevTools & `.ai0pack` Bundler）

为了让社区创作者无需搭建繁琐的外围客户端环境就能在首版控制台中高效开发、调试并分享五阶多态扩展，系统内建两大创作者基础设施：

1. **内置虚拟躯壳与多模态感官模拟器（Mock Shell & Sensor Simulator — `/shells/simulator`）**：
   * 创作者在开发一个新的 `SKILL.md` 技能、一条 `Lorebook` 词书、一个 `ext.cognitive_organ` 脑区插件或一条跨插件 ECA 规则时，无需真的启动 Unity/Live2D 客户端或登录外部 IM；
   * 直接在控制台打开躯壳协议模拟器，可任意伪造握手参数（切换 `private_1on1 | group_chat | public_livestream`、切换 `owner_verified | stranger:troll`），一键发送模拟触觉（如连戳 3 下脑袋）、模拟视觉语义（如皱眉 + 竞争假设）、模拟中途流式打断（指定 `spoken_char_offset`）或模拟动态热更新 `Actuators`，并在右侧伴生检视栏中实时观测 8 步决策轨迹与插件 Hook 耗时。
2. **代码级强制脱敏的一键社区资产打包器（Privacy-Scrubbed Creator Asset Bundler）**：
   * 当用户在控制台调教出一套满意的角色人格、生物钟曲线、`Lorebook` 词库、里程碑规则、`SKILL.md` 技能或 `.flow.yaml` 编排蓝图，点击 **`[📦 一键脱敏打包导出社区分享包]`** 时：
   * 后端打包引擎在代码层**强制物理排除** `soul_core.sqlite`（所有个人对话 `event_log`、私密情景记忆、决策轨迹）、`redaction_ledger.json`、`attachments/` 个人照片以及 Secrets Vault 中的任何 API Key；
   * 仅将纯净的设定、声线锚点、词书、技能手册或流程蓝图封装为带 SHA-256 校验与版本元数据的标准 `.soul-template` / `.ai0-skill` / `.ai0-flow` 资产包，从物理根源杜绝“创作者分享角色卡却意外泄露自己私聊记录或密钥”的社区安全事故。
