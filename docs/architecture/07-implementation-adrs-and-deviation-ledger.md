# 07. 核心工程架构决断记录 (Architectural Decision Records)

> 本文档记录 `ai0` 工程底座中已定型的核心架构决断（ADR），用于约束仓库拓扑、数据存储引擎、扩展安全边界与控制台组件体系。

---

## ADR-001：Monorepo 顶层目录与反后门编译期边界

- **背景**：为避免内置 WebChat 等官方参考实现被误认为与认知微内核平级的特权层，需要从物理目录和编译期依赖两层确立“灵魂内核”与“具身扩展”的绝对边界。
- **决断**：
  1. **`packages/` 锁定为五大无头核心包**：`packages/protocol` (`@ai0/protocol`)、`packages/storage` (`@ai0/storage`)、`packages/kernel` (`@ai0/kernel`)、`packages/gateway` (`@ai0/gateway`)、`packages/sdk` (`@ai0/sdk`)。
  2. **`plugins/**` 统一承载全部官方参考与社区扩展**：包括具身躯壳（`plugins/shells/*`）、认知器官（`plugins/cognitive-organs/*`）、多模态媒体管线（`plugins/media-pipelines/*`）、声明式技能（`plugins/skills-and-mcp/*`）与自动化联动流（`plugins/flows-and-assets/*`）。
  3. **编译期双向反后门守卫**：[verify-architecture-boundaries.mjs](../../scripts/verify-architecture-boundaries.mjs) 强制校验：
     - **Invariant 3（插件零后门与依赖闭包自包含）**：`plugins/**` 可在自身 `package.json` 内独立管理第三方依赖，但在 `@ai0/*` 内部包中仅允许依赖 `@ai0/protocol` 与 `@ai0/sdk`，严禁任何直接引用 `@ai0/kernel`、`@ai0/storage`、`@ai0/gateway`、`@ai0/console-webui` 或 `@ai0/daemon` 的行为；
     - **Invariant 7（宿主零插件污染与防反向依赖锁）**：`packages/*` 与 `apps/*` 编译期严禁依赖或导入任何 `@ai0/plugin-*` 或 `plugins/**`，严禁将具体插件的业务实现目录或专属第三方依赖塞入宿主应用，严禁 `@ai0/storage` 与 `@ai0/kernel` 出现具体插件硬编码方法。

---

## ADR-007　外置插件的发现与依赖隔离

- **背景**：若官方参考插件 `plugins/shells/webchat` 将 UI 实现、第三方 npm 依赖或专属流式后端路由耦合在 `apps/console`、`apps/daemon` 或 `packages/storage` 中，社区开发者将被迫修改宿主源码树与 `package.json` 才能接入新插件；一旦官方上游迭代更新（`git pull` 或镜像升级），用户自建插件将爆发严重的依赖冲突或被覆盖，且违背 `plugins/shells/webchat` 零特权官方参考样板的定位。
- **决断**：
  1. **源码树与外置用户插件目录物理隔离**：`@ai0/daemon` 通过 `RuntimePluginLoader` 统一扫描官方参考目录 `plugins/*/*`、灵魂级插件目录 `<soulDir>/plugins/*` 及外置用户目录（`user-plugins/*`、`AI0_PLUGINS_DIR`），社区与用户插件完全驻留于官方 Git 树之外，天然免疫上游更新冲突。
  2. 插件随包构建页面资源，daemon 托管 `dist/`，持有者授权的 shell 页面可申请作用域令牌。现行页面协议见 ADR-008。
  3. **Channel A 通用具身流式会话协议**：将流式对话、阶段进度、中途打断字符偏移回执与会话历史恢复全部下沉为按 `shell_id` 参数化的通用 `/protocol/v0/shell/*` 端点与 `@ai0/storage` 通用接口（`listShellDecisionTraces` / `markShellRunEnded`），确保官方参考插件与任意社区 `ext.shell` 插件 100% 平权同构。

---

## ADR-002：基于原生 `node:sqlite` 的零原生编译依赖存储架构

- **背景**：为实现跨平台（Windows / macOS / Linux）开箱即用，同时完整支持 WAL 并发读写、FTS5 全文检索与稠密向量混合召回，需要规避易在宿主机阻塞的原生 C++ 编译工具链依赖。
- **决断**：
  - `@ai0/storage` 基于 `Node.js >= 24` 原生 `node:sqlite` (`DatabaseSync`) 构建同步事务存储层，强制启用 `PRAGMA journal_mode = WAL`、`PRAGMA foreign_keys = ON` 与 `PRAGMA secure_delete = ON`。
  - 通过 `Float32Array` IEEE-754 BLOB 存储与 SQL 自定义余弦相似度函数 `vec_cosine_similarity` 实现稠密检索，并与 `FTS5` (`knowledge_chunks_fts`) BM25 稀疏检索组合为两阶段混合检索管线。
  - 所有检索查询在 SQL 游标阶段硬性先行执行 `WHERE visibility_scope IN (...) AND invalidated_at_ts IS NULL`，杜绝跨受众隐私泄露。

---

## ADR-003：控制台无框 L 型外围壳层、单一 `<main>` 卡片视口与 MD3 二次封装规范

- **背景**：复杂认知中枢控制台同时承载 16 个专业配置模块与高密度参数表单，必须避免多层嵌套白卡片、彩色系统 Emoji 噪音与原生裸控件混用导致的视觉割裂。
- **决断**：
  1. **无边框环境底板壳层 + 单一 `<main>` 抬升圆角卡片**：顶栏（`HybridTopBar`）与左侧导航栏（`PolymorphicNavRail`）直接融入全局底板环境色（`--ai0-surface-frame-base`），无独立卡片边框与背景框；全屏仅右下方 `<main>` 主内容视口（`MainRoundedCardOutlet`）作为唯一 `16px` 圆角白色抬升画布。
  2. **5 子目录 45 项模块化组件架构**：`apps/console/src/design-system/` 严格划分为 `tokens/`、`primitives/`（10 项）、`shell/`（7 项）、`domain-visualizers/`（16 项）与 `composites/`（12 项），禁止单体文件堆砌。
  3. **单色 SVG 矢量图标与 MD3 二次封装原语**：控制台 Chrome 全面禁用彩色系统 Emoji，统一使用跟随 `currentColor` 的单色 SVG 矢量图标；页面表单统一使用具备左侧激活竖条指示器、底部 `2px` 动态聚焦高亮线、果冻弹性 Switch 与真实指针坐标水波纹的二次封装紧凑控件（`32px` 高度）。

---

## ADR-004：本地优先 `.soul` 存档与跨快照防复活墓碑账本

- **背景**：当用户对敏感记忆执行彻底遗忘（Hard Forget）后，若后续通过 Git 快照回滚至历史节点，传统备份恢复机制会导致已擦除数据重新复活。
- **决断**：
  - 彻底遗忘采用五表级联物理擦除并同步向 `redaction_ledger.json` 写入不可逆墓碑记录。
  - `SoulArchiveManager` 在任何历史快照回滚操作完成后，强制重放墓碑账本，确保被擦除的隐私记录跨快照永久不可复活。

---

## ADR-005：确定性隐私脱敏导出契约

- **背景**：面向创作者分享角色配置与技能生态时，必须从代码层杜绝个人聊天记录、私密情景记忆与模型 API Key 随分享包外泄。
- **决断**：
  - 资产导出服务强制执行白名单字段投影与黑名单敏感键剥离（物理剔除 `event_log`、`memories`、`api_key`、`owner_token` 等字段），并为导出文件计算确定性 `SHA-256` 校验指纹与审计明细。

---

## ADR-006：通用领域语言统一、规范自包含与去外部参考命名污染原则

- **背景**：在面向全球开源社区演进的过程中，研发探索阶段用于对齐审美或交互直觉的外部小众参考项目，若被直接透传为对外门面文案、架构规格术语、文件名前缀、CSS 命名空间、协议枚举键或内核默认路由 ID，将造成规范失去“零外部先验知识可独立复现”的自包含性，并在代码库中诱发“视觉参考 / UI 命名空间 / 内核基础设施 / 示例灵魂”四层语义混叠。
- **决断**：
  1. **外部名词三层隔离契约**：
     - **行业互操作标准与事实格式**（如 `Material Design 3`、`MCP`、`SillyTavern Character Card V2/V3 & Lorebook`、`OKLCH`、`SB 243`）作为真实技术依赖或导入协议，允许并应当直接写入工程规格正文；
     - **先行者对照与视觉工艺致敬**（如 `AIRI`、`Letta`、`SAIBA`、`Neuro-sama`、`AstrBot/NapCat/Koishi` 及前端封装案例）仅归位于问题域先例研究文档（`docs/vision/01-vision-and-predecessors.md`），且必须自带零先验知识可读的语境解释，严禁以“借鉴/对齐并超越 X”或外部品牌代称形式渗入 `README.md` 与工程规格正文；
     - **第一方规范与设计语言自包含**：所有控制台视觉与交互规范均提炼为可量化、可验证的 `ai0` Console Design System 五大设计支柱，不依赖读者知晓任何外部参考项目即可完整实现与验收。
  2. **四层代码命名正交解耦**：
     - 控制台设计系统统一收口于 `console-theme.css`、`--ai0-*` CSS 变量、`.ai0-*` 类名与 45 项无外部前缀的纯语义组件（Layer 1 原语 `RippleButton` … `HoverTooltip` 与 Layer 2–4 命名风格完全一致）；
     - 协议主题枚举与无头内核默认模型/算力路由 ID 采用中性自解释命名（`sakura-pink` / `astral-blue` / `cyber-emerald`，并保留对遗留 `"cerasus-pink"` 存档值的 Schema 向后兼容映射；内核路由 ID 统一采用 `ai0-*` 命名空间）；
     - 默认示例灵魂存档（`soul.mio` / `Mio`）作为独立样例数据层，与前端设计系统、协议枚举及内核基础设施物理正交解耦。

## ADR-008　插件组合、躯壳接入与个体连续性

**躯壳**是通过协议为一个数字个体提供感知、表达或动作能力的外部载体。网页聊天、终端、群聊机器人和虚拟形象都可以是躯壳。控制台的“接入通道”展示实际连接与可用入口，“会话记录”读取存档，“躯壳协议模拟器”独立调试协议。

| 决策及上游依据 | ai0 的实现与验证 |
| --- | --- |
| 由上下文记录可撤销效果，并在依赖出现或消失时激活或停止消费方。[时空可组合性论文](https://arxiv.org/abs/2608.25512) | SDK 固定依赖 `@deepseek-ai/cordis@4.1.0`。daemon 的正式与沙盒运行时分别创建上下文，浏览器按个体和目标挂载。SDK 测试覆盖三级依赖的六种安装顺序、激活失败、局部卸载和资源释放。 |
| 允许插件公开可继续扩展的位置。[DSH 模型选择菜单](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-model-selection/README.md) · [VS Code 贡献点](https://code.visualstudio.com/api/references/contribution-points) | `ExtensionPoint<T>` 以 `owner/name/version` 标识，提供方验证输入。`scope.contribute(point, value, child => ...)` 的 `child` 可继续定义子菜单。控制台浏览器测试从三个独立目录装载页面、按钮和菜单。 |
| 一个持久个体允许多条会话。[Letta 持久个体](https://docs.letta.com/concepts/stateful-agents) | `.soul` 保存个体标识、已绑定人物、受众、事件和协调器检查点。连接按租约统计。会话按载体、受众与线程区分，已接收发言和已确认交付文本共用查询口径。`composition-e2e.test.ts` 在卸载、重启和切换终端后读取同一份历史。 |
| 客户端在运行中提供动作并按标识返回结果。[Neuro SDK 协议](https://github.com/VedalAI/neuro-sdk/blob/main/API/SPECIFICATION.md) | ai0 的租约用 `PATCH` 更新能力。持有者提交的动作绑定到具体连接，载体按 `intent_id` 去重执行并履行本地同意要求。回执成为 `action_episode_completed` 事件。端到端用例在网页输出中断后继续提交另一载体的回执。 |

### 插件作者入口

将页面资源放入插件的 `dist/`，在 `console_contributions.pages` 中声明 `path`、`title`、`entry_module` 和可选的 `navigation`、`shell_id`。模块导出 `mountPage(container, host)`。WebChat 提供 `/webchat`，梦境手记提供 `/dream-journal`。扩展其他页面的插件在 `console_contributions.modules` 中列出模块路径，每个模块导出 `activate(scope)`。缺少构建产物时，插件详情列出缺失文件。

WebChat 在输入框旁公开 `@ai0/plugin-shell-webchat/contracts` 的 `composerActions`。其参数为 `{ label, run }`。安装该契约的插件可调用 `scope.contribute(composerActions, command)`。在 `scope.effect` 内取得订阅、定时器或 DOM 资源，并返回清理函数。模块级副作用和自行启动的外部进程须由作者显式管理。同源原生模块需要持有者信任；Cordis 的作用域负责生命周期。

### 无网页客户端

持有者向 `POST /api/studio/shell-grants` 提交 `shellId`、已核实的 `externalUserId` 和 `principalId`、`audience` 及 `mode`，并附 `x-ai0-owner-token`。给终端配置 `AI0_URL`、`AI0_SHELL_ID`、`AI0_SHELL_TOKEN`、`AI0_MODE` 后，执行 `node plugins/shells/terminal/client.mjs`。终端只接收限定作用域的令牌。它在输出写入完成后提交字符偏移；缺少回执时，存档把交付列为未知。

`POST /protocol/v0/shell/connections` 建立连接，`PATCH` 续约或变更能力，`DELETE` 主动断开。租约有效期为 45 秒，同时受令牌有效期限制。持有者通过 `POST /api/studio/shell-actions` 指定 `sessionId` 与已公布的 `actuatorId`。客户端通过 `GET /protocol/v0/shell/connections/:id/actions` 领取指令，并在同一地址 `POST` 交付回执。连接到期后，新连接独立协商动作；相同动作标识的终态回执只产生一条事件。

### 存档与验收

新建个体获得独立 ID。`--demo` 显式载入示例经历。旧版配置按完整指纹识别随仓发布的示例任务和日志，编辑过的条目保留。v5 读取时先生成兼容视图，首次保存前备份原件；新格式校验后通过同目录临时文件替换。损坏或更高版本的配置会返回错误。

安装浏览器一次后运行 `pnpm verify:all`。该命令执行依赖边界检查、构建、类型检查、单元与 HTTP 验收，以及三级扩展和 WebChat 的 Chromium 验收。浏览器安装命令为 `pnpm --filter @ai0/console-webui exec playwright install chromium`。`pnpm replay:golden` 独立运行内核回放。群聊与形象设备在自动验收中使用协议客户端，终端验收实际启动独立 Node 进程。
