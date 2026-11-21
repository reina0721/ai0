# 02. `.soul` 灵魂存档规范、SQLite 数据库 Schema 与血缘 DAG 算法架构

> **项目阶段**：架构研究与工程规格设计阶段（解法域工程规格）
>
> 本文档定义系统的持久化存储底座（`@ai0/storage`）。遵循**“灵魂存档彻底独立于任何躯壳”、“事件日志为唯一真相源，记忆为带血缘的可重建投影”**以及**“检索层代码按受众硬性隔离隐私”**三大公理，给出 `.soul` 单目录嵌入式存储结构、完整 SQLite DDL 表设计，以及局部血缘失效重算与真遗忘擦除算法。

---

## 一、Local-First `.soul` 灵魂存档目录规范

在本存储架构中，每一个数字生命实例在磁盘上都表现为一个完全自包含、零外部数据库服务依赖的独立文件夹（后缀为 `.soul`）。这种设计使“像 Git 一样随时快照回档”与“整包打包迁移到任何机器”变得极其简单可靠：

```text
souls/example.soul/
├── manifest.json                  # 存档元数据：schema_version, soul_id, created_at, active_model_profile
├── identity.yaml                  # 【Tier 1 不可变人格核心 DNA】
│                                  #   - core_values (核心价值观与角色内拒绝姿态)
│                                  #   - ontological_contract ("poetic_cyber_life" | "strict_rp" | "transparent_ai")
│                                  #   - voice_signature (口癖、代词、句长节奏、禁用客服词列表)
│                                  #   - circadian_schedule (作息生物钟曲线参数与免打扰窗口)
│                                  #   - proactivity_policy (每日主动搭话上限、冷却退避系数、最低可打扰度阈值)
├── narrative.md                   # 【Tier 2 可演化自我叙事】(带 visibility_scope 标记的 Markdown 段落)
├── voice_exemplars.jsonl          # 【黄金声线锚点池】用于换模型或降级时的动态 Few-Shot 声线校准
├── blackboard_policy.yaml         # 【声明式认知黑板槽位编排与语境预设】各认知槽位 Token 预算配比、显著性门槛与场景预设
├── milestones_and_rituals.yaml    # 【关系羁绊里程碑、纪念日仪式与正向剧情触发规则】(零暗黑惩罚，仅限正向成长解锁)
├── lorebooks/                     # 【可热插拔动态世界观词条库】(载体形态 I：按关键词/语义递归激活的背景设定集)
│   └── default_world.yaml
├── skills/                        # 【自然语言与脚本混合技能包】(载体形态 II：包含 SKILL.md 手册与沙盒脚本)
│   └── daily-companion-review/
│       └── SKILL.md
├── flows/                         # 【可视化认知流与跨插件 ECA 联动蓝图】(载体形态 IV：.flow.yaml & orchestration_rules.yaml)
│   └── default_orchestration.flow.yaml
├── knowledge/                     # 【内建混合 RAG 知识库文档源与卸载常识提炼池】
│   └── documents/
├── state/
│   ├── soul_core.sqlite           # 【核心状态、事件溯源与内建混合 RAG 数据库】(SQLite 3 + WAL + sqlite-vec + FTS5)
│   └── redaction_ledger.json      # 【跨快照永久遗忘墓碑账本】记录已生效的真遗忘目标 ID，恢复旧快照时强制重放擦除!
├── attachments/                   # 经授权保存的共同经历多媒体快照 (按内容哈希寻址)
└── .git/                          # 内置轻量 Git 版本库，记录每次人格审批、睡眠整理检查点与显式快照
```

---

## 二、SQLite 核心数据库完整 DDL 架构 (`soul_core.sqlite`)

数据库表结构在设计上一步到位，原生内建 **`Principal × Venue × Audience` 四元组**、**`VirtualClock` 时间戳**、**四级认知溯源（Epistemic Provenance）** 与 **记忆血缘有向无环图（Lineage DAG）**。

### 2.1 表 1：不可变原始事件日志表 (`event_log` — Single Source of Truth)

```sql
CREATE TABLE event_log (
    event_seq           INTEGER PRIMARY KEY AUTOINCREMENT, -- 全局严格递增物理序列号
    event_id            TEXT NOT NULL UNIQUE,              -- ULID (如 evt_01J9Z...)
    wall_ts_ms          INTEGER NOT NULL,                  -- 真实物理世界 UTC 毫秒时间戳
    virtual_ts_ms       INTEGER NOT NULL,                  -- 内核 VirtualClock 虚拟毫秒时间戳
    
    -- 四元组溯源信封 (The Provenance Quadruple)
    source_shell_id     TEXT NOT NULL,                     -- 来源躯壳实例 ID (或 'kernel.internal')
    principal_id        TEXT NOT NULL,                     -- 归一化主体 ID ('owner' | 'friend:<id>' | 'stranger:<uid>' | 'system')
    principal_trust     TEXT NOT NULL CHECK (principal_trust IN ('owner_verified', 'bound_friend', 'stranger', 'environment_sensor', 'tool_output')),
    venue_type          TEXT NOT NULL CHECK (venue_type IN ('private_1on1', 'group_chat', 'public_livestream', 'local_ambient', 'internal_background')),
    audience_scope      TEXT NOT NULL,                     -- 在场受众作用域 ('only_owner' | 'group:<id>' | 'public_all')
    
    -- 事件分类与载荷
    event_category      TEXT NOT NULL CHECK (event_category IN (
                            'perception_committed',        -- 上行已确认感知事件
                            'expression_delivered',        -- 下行已确认送达/被打断表达回执
                            'action_episode_completed',    -- 8步行动任务完成事件
                            'sleep_consolidation_run',     -- 真实执行过的后台睡眠整理事件
                            'curiosity_exploration_run',   -- 真实执行过的后台好奇心探索事件
                            'config_or_ablation_changed',  -- 认知模块开关或路由配置变更事件
                            'memory_redacted_tombstone',   -- 真遗忘擦除墓碑事件
                            'soul_rollback_bridge'         -- 灵魂回档断层弥合元事件
                        )),
    modality            TEXT NOT NULL,                     -- 'text' | 'audio_transcript' | 'tactile' | 'visual_semantic' | 'system'
    summary_text        TEXT NOT NULL,                     -- 供快速检索的文本摘要 (执行真遗忘后物理覆写为 '[REDACTED]')
    payload_json        TEXT NOT NULL,                     -- 完整结构化 JSON 载荷 (执行真遗忘后物理覆写为 '{}')
    
    -- 因果与消融审计元数据
    state_rev_after     INTEGER NOT NULL,                  -- 该事件处理后的权威状态版本号 v_N
    active_modules_mask INTEGER NOT NULL,                  -- 当时开启的认知模块位图 (用于消融实验因果复现)
    redacted_at_ts_ms   INTEGER DEFAULT NULL,              -- 若被执行“真遗忘”，记录擦除时间戳
    redacted_by_event   TEXT DEFAULT NULL                  -- 指向对应的墓碑事件 ID
);

CREATE INDEX idx_event_log_virtual_ts ON event_log(virtual_ts_ms);
CREATE INDEX idx_event_log_audience ON event_log(audience_scope, virtual_ts_ms);
CREATE INDEX idx_event_log_category ON event_log(event_category, virtual_ts_ms);
```

### 2.2 表 2：多层次主观记忆投影表 (`memories`) 与血缘边表 (`memory_lineage_edges`)

```sql
CREATE TABLE memories (
    memory_id           TEXT PRIMARY KEY,                  -- ULID (如 mem_01J9Z...)
    memory_tier         TEXT NOT NULL CHECK (memory_tier IN (
                            'episodic_experience',         -- 带时间与情绪权重的共同经历摘要
                            'semantic_fact',               -- 沉淀下来的客观事实或用户偏好
                            'relational_tacit',            -- 相处默契、内部梗或共同黑话
                            'kb_crystallized_gist',        -- 从热插拔外部知识库沉淀下来的百字常识卡
                            'topic_taboo_seal'             -- 负向避雷封印 (“别再提这件事”)
                        )),
    
    -- 认知溯源 (Epistemic Provenance — 严禁混淆事实与猜测)
    epistemic_type      TEXT NOT NULL CHECK (epistemic_type IN (
                            'observed_firsthand',          -- 亲历或主人亲口确认
                            'reported_hearsay',            -- 第三方或外部传闻 (不可写入核心主人画像)
                            'inferred_hypothesis',         -- 潜台词或情绪揣测 (强制带过期时间，禁止升格为事实)
                            'imagined_narrative'           -- 角色内白日梦/创意构想
                        )),
    attributed_principal TEXT NOT NULL,                    -- 该信息归属的主体
    
    -- 隐私隔离墙硬过滤字段 (Database-Level Privacy Scope Guard)
    visibility_scope    TEXT NOT NULL,                     -- 'only_owner' | 'group:<id>' | 'public_all'
    taint_level         TEXT NOT NULL CHECK (taint_level IN ('trusted_owner', 'semi_trusted_friend', 'untrusted_external')),
    
    -- 记忆内容与艾宾浩斯动力学参数
    content_text        TEXT NOT NULL,                     -- 记忆正文 (若为 topic_taboo_seal 则存避雷规则描述)
    emotional_valence   REAL NOT NULL DEFAULT 0.0,         -- 形成记忆时的情绪效价 [-1.0, 1.0]
    emotional_arousal   REAL NOT NULL DEFAULT 0.0,         -- 形成记忆时的情绪唤醒度 [0.0, 1.0]
    base_importance     REAL NOT NULL DEFAULT 0.5,         -- 基础重要度权重 [0.0, 1.0]
    stability_half_life REAL NOT NULL DEFAULT 168.0,       -- 艾宾浩斯遗忘半衰期 (虚拟小时数，随每次召回巩固递增)
    recall_count        INTEGER NOT NULL DEFAULT 0,        -- 累计被召回次数
    
    -- 时间、双时态演进与共同默契采纳生命周期
    created_virtual_ts      INTEGER NOT NULL,
    last_recalled_ts        INTEGER NOT NULL,
    valid_from_virtual_ts   INTEGER NOT NULL,                  -- 双时态：该事实/偏好开始生效的虚拟时间戳
    valid_until_virtual_ts  INTEGER DEFAULT NULL,              -- 双时态：若被新事实取代 (supersedes)，记录旧事实封口退居历史态的时间戳
    expires_virtual_ts      INTEGER DEFAULT NULL,              -- inferred_hypothesis 强制设置过期时间
    grounding_status        TEXT NOT NULL DEFAULT 'not_applicable' CHECK (grounding_status IN (
                                'not_applicable',              -- 非 relational_tacit 记忆默认此值
                                'proposed_presented',          -- 已单方面说出该内部梗/称呼，尚未获对方接梗确认
                                'mutually_grounded',           -- 已观测到对方正向接梗/回用，正式成为双方共同默契
                                'disputed_retired'             -- 对方冷场或明确拒绝，已弃用不再复读
                            )),
    invalidated_at_ts       INTEGER DEFAULT NULL,              -- 若上游血缘被真遗忘删除或重算，标记为失效
    created_at_rev          INTEGER NOT NULL                   -- 写入时的协调器状态版本号
);

-- 记忆血缘与认知更替有向无环图边表 (Lineage & Epistemic Revision DAG Edges)
-- 记录每条记忆源自哪些原始事件/父记忆 (derived_from)，或取代/反驳了哪条旧记忆 (supersedes / contradicts)
CREATE TABLE memory_lineage_edges (
    child_memory_id     TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    parent_type         TEXT NOT NULL CHECK (parent_type IN ('event', 'memory')),
    parent_id           TEXT NOT NULL,                     -- 指向 event_log.event_id 或 memories.memory_id
    relation_type       TEXT NOT NULL DEFAULT 'derived_from' CHECK (relation_type IN (
                            'derived_from',                -- 正向血缘派生 (用于真遗忘级联擦除与微重算)
                            'supersedes',                  -- 双时态事实更替 (新偏好/纠错后的新事实取代旧事实)
                            'contradicts'                  -- 待睡眠整理消解的证据冲突边
                        )),
    PRIMARY KEY (child_memory_id, parent_type, parent_id)
);

CREATE INDEX idx_memories_Retrieval ON memories(visibility_scope, invalidated_at_ts, memory_tier);
CREATE INDEX idx_lineage_parent ON memory_lineage_edges(parent_type, parent_id);
```

*(注：向量索引表 `memories_vec` 使用 `sqlite-vec` 虚拟表绑定 `memory_id`，并在检索时与 `memories` 表做内连接，确保 `WHERE visibility_scope IN (...) AND invalidated_at_ts IS NULL` 在 SQL 引擎底层先于返回结果生效。)*

### 2.3 表 3：承诺与前瞻记忆状态机表 (`prospective_commitments`)

```sql
CREATE TABLE prospective_commitments (
    commitment_id       TEXT PRIMARY KEY,
    commitment_kind     TEXT NOT NULL CHECK (commitment_kind IN (
                            'agent_promise',               -- 她答应主人的事 (违约需触发角色内真诚道歉)
                            'user_upcoming_event',         -- 主人未来的重要事项 (事后需主动关心结果)
                            'curiosity_agenda'             -- 她自己产生的好奇心探索线索
                        )),
    visibility_scope    TEXT NOT NULL,                     -- 'only_owner' | 'group:<id>' | 'public_all'
    description         TEXT NOT NULL,
    trigger_type        TEXT NOT NULL CHECK (trigger_type IN ('at_virtual_ts', 'on_next_interaction_after_ts', 'on_idle_window')),
    trigger_virtual_ts  INTEGER NOT NULL,
    deadline_virtual_ts INTEGER DEFAULT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pending', 'due', 'fulfilled', 'missed', 'cancelled')),
    source_event_id     TEXT NOT NULL REFERENCES event_log(event_id),
    resolved_event_id   TEXT DEFAULT NULL
);

CREATE INDEX idx_commitments_status_ts ON prospective_commitments(status, trigger_virtual_ts);
```

### 2.4 表 4：权威认知状态与内稳态检查点表 (`cognitive_state_checkpoints`)

```sql
CREATE TABLE cognitive_state_checkpoints (
    state_rev           INTEGER PRIMARY KEY,               -- 单调递增的权威状态版本号 v_N
    virtual_ts_ms       INTEGER NOT NULL,
    caused_by_event_id  TEXT NOT NULL,
    
    -- 情绪与内稳态锚点向量 S(t_0) (供懒求值解析时间函数 S(t) 作为初始值)
    instant_valence     REAL NOT NULL,                     -- 瞬时情绪效价 [-1.0, 1.0]
    instant_arousal     REAL NOT NULL,                     -- 瞬时情绪激活度 [0.0, 1.0]
    mood_baseline_val   REAL NOT NULL,                     -- 慢速持久心境效价 [-1.0, 1.0]
    mood_attribution    TEXT DEFAULT NULL,                 -- 心境成因简述
    mood_attr_scope     TEXT NOT NULL DEFAULT 'only_owner',-- 心境成因的隐私作用域 (跨公开场合自动剥离!)
    
    circadian_energy    REAL NOT NULL,                     -- 昼夜生理精力 [0.0, 1.0]
    metabolic_energy    REAL NOT NULL,                     -- Token 预算映射的算力代谢精力 [0.0, 1.0]
    drive_social_longing REAL NOT NULL,                    -- 社交渴望/思念驱动力 [0.0, 1.0]
    drive_curiosity     REAL NOT NULL,                     -- 好奇心驱动力 [0.0, 1.0]
    
    -- 关系、心结与用户模型 JSON 快照
    relationship_json   TEXT NOT NULL,                     -- { trust, intimacy, playfulness, active_tensions: [{id, reason, intensity, half_life_h, created_ts}] }
    user_model_json     TEXT NOT NULL,                     -- { estimated_activity, estimated_interruptibility, dnd_until_ts }
    working_memory_json TEXT NOT NULL,                     -- 最近话轮窗口 + unsaid_remainder (被打断未说完的腹稿)
    next_wakeup_ts_ms   INTEGER DEFAULT NULL               -- 反解出的下一阈值唤醒虚拟时间戳
);
```

### 2.5 表 5：8 步可验证系统决策审计轨迹表 (`turn_decision_traces`)

```sql
CREATE TABLE turn_decision_traces (
    trace_id            TEXT PRIMARY KEY,
    turn_event_id       TEXT NOT NULL REFERENCES event_log(event_id),
    virtual_ts_ms       INTEGER NOT NULL,
    state_rev_before    INTEGER NOT NULL,
    state_rev_after     INTEGER NOT NULL,
    
    -- 8 步确定性审计记录 (JSON 结构化存储，供 WebUI 白盒面板与回归回放断言)
    step1_perception_json   TEXT NOT NULL,                 -- 输入信封与四元组
    step2_gate_safety_json  TEXT NOT NULL,                 -- L0 危机检查、显著性得分、防抖合并计数、识别意图
    step3_memory_recall_json TEXT NOT NULL,                -- 受众过滤条件、召回的 memory_id 列表及各项分值明细
    step4_homeostasis_json  TEXT NOT NULL,                 -- 裁决前稳态向量 -> 代码裁决后的状态 Diff
    step5_strategy_proposal_json TEXT NOT NULL,            -- 选用策略、model_reported_rationale (非权威)、theatrical_subtext (带 spoiler_level)
    step6_tool_auth_json    TEXT NOT NULL,                 -- 选择的 MCP/Skill/Shell Actuator 及三维权限引擎裁决结果
    step7_emitted_intent_json TEXT NOT NULL,               -- 下发的 ExpressionEnvelope / 行动指令
    step8_delivery_receipt_json TEXT DEFAULT NULL          -- 异步回填的 DeliveryReceipt (completed/interrupted, spoken_char_offset)
);
```

### 2.6 表 6：内建开箱即用混合 RAG 知识库切片与 FTS5 稀疏索引表 (`knowledge_chunks`)

为了在内核底座原生提供对齐并超越 `AstrBot` 的混合 RAG 知识库能力（同时与外部 `ext.memory_knowledge` 连接器无缝协同），`soul_core.sqlite` 内建文档切片表、向量虚拟表与 `FTS5` 稀疏全文检索表，并**在表结构级强制锁死 `taint_level = 'untrusted_external'` 防间接 Prompt 注入投毒**，同时记录被真实对话引用的次数 `citation_count`（供卸载知识集时自动触发 `extractGistCardsBeforeUnmount` 浓缩生成 `<150` 字的 `kb_crystallized_gist` 常识卡）：

```sql
CREATE TABLE knowledge_chunks (
    chunk_id            TEXT PRIMARY KEY,                  -- ULID
    collection_id       TEXT NOT NULL,                     -- 所属知识集 ID (如 'kb.local.project_docs' 或 'kb.anime.lore')
    document_name       TEXT NOT NULL,                     -- 原始文档名 (PDF / Markdown / DOCX / 代码文件)
    chunk_index         INTEGER NOT NULL,
    content_text        TEXT NOT NULL,
    metadata_json       TEXT NOT NULL DEFAULT '{}',        -- 页码、章节标题或代码符号路径
    taint_level         TEXT NOT NULL DEFAULT 'untrusted_external' CHECK (taint_level = 'untrusted_external'),
    citation_count      INTEGER NOT NULL DEFAULT 0,        -- 在真实对话中被高权重引用的累计次数 (卸载时用于筛选提炼 Gist 常识卡)
    last_cited_ts_ms    INTEGER DEFAULT NULL,
    created_at_ts_ms    INTEGER NOT NULL
);

-- SQLite FTS5 BM25 稀疏检索虚拟表 (与 sqlite-vec 稠密向量检索共同构成 Hybrid RAG + Reranker 管线)
CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    collection_id UNINDEXED,
    content_text,
    tokenize = 'unicode61'
);
```

---

## 三、核心存储算法：血缘 DAG 级联真遗忘、局部失效重算与混合检索

### 3.1 混合记忆检索与数据库级受众硬隔离公式

当认知快环（`W1`）或行动环（`W2`）发起记忆检索时，`@ai0/storage` 强制执行以下两阶段查询：

1. **第一阶段：SQL 层受众作用域与有效性硬拦截（Deterministic Scope Guard）**
   * 若当前 `Audience == 'only_owner'` 且 `Principal == 'owner_verified'`：允许检索 `visibility_scope IN ('only_owner', 'group:*', 'public_all')`；
   * 若当前 `Audience == 'group:<gid>'`：**硬编码 SQL `WHERE visibility_scope IN ('group:<gid>', 'public_all') AND invalidated_at_ts IS NULL`**；
   * 若当前 `Audience == 'public_all'`（如公开直播间）：**硬编码 SQL `WHERE visibility_scope = 'public_all' AND invalidated_at_ts IS NULL`**。
   * **架构效果**：私密记忆在 SQLite 查询游标阶段就被物理排除，绝不进入内存，更绝不进入 LLM Prompt。
2. **第二阶段：带艾宾浩斯遗忘曲线与近期复用冷却的混合打分公式**
   对于通过第一阶段硬过滤的候选记忆 $m_i$，其在当前虚拟时间 $t$ 的综合召回得分 $R(m_i, t)$ 为：
   $$R(m_i, t) = \Big(w_{\text{sem}} \cdot \text{CosSim}(\mathbf{q}, \mathbf{v}_i) + w_{\text{imp}} \cdot I_{\text{base}}(m_i) \cdot (1 + \alpha \cdot |V_{\text{emo}}(m_i)|)\Big) \cdot 2^{-\frac{t - t_{\text{last}}(m_i)}{H(m_i)}} \cdot C_{\text{cooldown}}(m_i)$$
   * 其中 $H(m_i) = H_0 \cdot (1 + \beta \cdot \ln(1 + \text{recall\_count}_i))$ 为随每次成功回忆而延长的艾宾浩斯记忆稳定半衰期；
   * $C_{\text{cooldown}}(m_i) \in (0, 1]$ 为近期复用惩罚因子（防止在同一场对话中机械重复提及同一条记忆）。

### 3.2 “真遗忘（Hard Forget）” vs. “话题封印（Topic Seal）”的血缘 DAG 算法

```mermaid
flowchart LR
    E1["原始事件 evt_101<br/>(主人透露了某敏感住址)"] --> M1["情景记忆 mem_A<br/>(那晚聊到了搬家与住址)"]
    E2["原始事件 evt_102<br/>(那晚同时聊到了喜欢吃火锅)"] --> M1
    M1 --> M2["高层语义反思 mem_B<br/>(主人住在某区，平时爱吃辣)"]

    Forget["用户指令：忘掉我之前说的住址 (evt_101)"] -.->|"1. 物理擦除 evt_101 载荷"| E1
    Forget -.->|"2. 顺 DAG 查出受染节点 mem_A, mem_B"| M1 & M2
    M1 & M2 -.->|"3. 仅针对剩余合法源事件 evt_102<br/>局部重算生成纯净记忆 mem_A'"| Clean["重算后纯净记忆 mem_A'<br/>(只保留喜欢吃火锅，住址彻底消失)"]
```

1. **执行 `Hard Forget(target_event_ids | target_memory_ids)` —— 全受管副本擦除与跨回档永久墓碑账本**：
   * **Step 1（溯源定位）**：若用户指定删除某条记忆 $M$，通过 `memory_lineage_edges` 反向向上遍历，找到其根源事件集合 $\{E_{\text{target}}\}$；
   * **Step 2（物理载荷擦除与墓碑追加）**：在单一事务中，将 `event_log` 中 $\{E_{\text{target}}\}$ 的 `summary_text` 覆写为 `'[REDACTED_BY_OWNER]'`、`payload_json` 覆写为 `'{}'`，并追加一条 `memory_redacted_tombstone` 事件；
   * **Step 3（正向血缘级联失效与按 DAG 拓扑序自底向上局部微重算）**：从 $\{E_{\text{target}}\}$ 出发沿 `memory_lineage_edges (relation_type = 'derived_from')` 正向 BFS 遍历所有下游衍生记忆节点 $\{M_{\text{tainted}}\}$，并对受染子图按 **DAG 拓扑层级自底向上（Topological Level-Order Sort，确保父记忆节点永远先于依赖它的子记忆节点处理）** 依次执行：
     * 若某衍生记忆 $M_k$ 的所有上游合法源事件/父记忆均被擦除 $\rightarrow$ 直接从 `memories` 与 `memories_vec` 中**物理硬删除**；
     * 若某衍生记忆 $M_k$ 还依赖同一场对话中的其他合法未擦除源事件（如上图中的 `evt_102`）或未失效父记忆 $\rightarrow$ 将旧 $M_k$ 物理删除，并按拓扑层级顺序触发一次**仅以剩余未擦除源事件/已更新父记忆为输入的局部微重算（Topological Targeted Micro-Reprojection）**，彻底解决“全量重放算力破产”、“父子节点重算因果倒置”与“衍生反思残留”三大难题！
   * **Step 4（全受管副本同步脱敏擦除 —— 杜绝审计轨迹与检查点残留）**：
     在同一数据库事务中，同步清理除 `event_log` 与 `memories` 之外的所有受管副本：
     * **`turn_decision_traces`（决策轨迹表）**：将所有 `turn_event_id IN {E_target}` 或在 `step3_memory_recall_json` 中召回了 `{M_tainted}` 的轨迹记录中对应的输入摘要、召回正文与输出文本物理覆写为 `'[REDACTED_BY_FORGET]'`；
     * **`cognitive_state_checkpoints`（状态检查点表）**：清理历史检查点中 `working_memory_json` 与 `mood_attribution` 内关联 `{E_target}` 的文本片段；
     * **`prospective_commitments`（前瞻承诺表）**：物理删除 `source_event_id IN {E_target}` 的未决承诺；
     * **磁盘空闲页物理清零**：数据库连接强制开启 `PRAGMA secure_delete = ON` 并执行增量页清理，防止已删明文残留在 SQLite 空闲磁盘页中。
   * **Step 5（写入跨时间线永久墓碑账本 `state/redaction_ledger.json` —— 防止旧存档回档复活）**：
     * 将本次遗忘的 `{ target_event_ids, target_memory_ids, redacted_at_wall_ts }` 追加写入独立于快照分支的 `state/redaction_ledger.json`。
     * **恢复旧快照时的强制重放契约（Mandatory Tombstone Replay on Snapshot Restore）**：每当用户从更早的 `.soul` 快照或 Git Commit 恢复历史存档时，存储恢复引擎在挂载旧快照数据库后、对外恢复服务前，**自动遍历 `redaction_ledger.json` 并对旧快照中存在的目标事件与衍生血缘重新执行 Step 2~4 的全套擦除**。这保证了**“一旦真遗忘生效，即使回档到遗忘前的旧快照，检索层与管理后台也永远无法重新取出已删原文”**。
2. **执行 `Topic Seal(topic_description)`（“别再提这件事”）**：
   * 同样清理具体痛苦细节记忆，但额外在 `memories` 表插入一条 `memory_tier = 'topic_taboo_seal'` 的高优先级负向约束向量。当后续检索或生成触碰该向量阈值时，代码直接注入避雷绕行指令。
