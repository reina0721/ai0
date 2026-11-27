# ai0 · 通用数字生命认知中枢

**Clean-Slate V1：始终保持第一版，零历史沉积、零预设默认角色卡、三级渐进派生、五核正交分立。**

ai0 以九个工作区包构成正交微内核；其中七个有状态包（五个无头核心 + `storage` + `gateway`）统一采用 **`./kernel`（L0 不可约公理层）← `./subsystems`（L1 可替换治理子系统层）** 双层微内核分层。五个无头核心分别负责扩展治理、通用话轮执行、结构化感知、通用状态化认知与可验证表达；特定陪伴或垂直场景能力全部作为 `plugins/` 插件按需挂载。宿主持有算力与凭据，`.soul` 持有角色运行状态，`InteractionChannel` 经标准协议接入，可独立声明 `EmbodimentSurface`。

通用能力的所有权、作者接入路径和冻结条件见[通用 Agent 的扩展边界与验证方案](docs/architecture/09-universal-agent-contracts.md)。

## 快速启动与零预设上线

需要 Node.js 24+ 和 pnpm 10+。

```bash
pnpm install
pnpm verify:boundaries
pnpm test
pnpm dev
```

`pnpm test` 包含 `labs/` 渐进派生测试套件。启动后打开 <http://127.0.0.1:4173>。在另一终端运行 `pnpm replay:golden` 可回放黄金回归场景。

控制台的 **Go-Live Onboarding Checklist** 根据守护进程返回的阶段和缺项引导 Owner 操作。

| 当前阶段 | 上线清单 |
| --- | --- |
| `L0_UNCLAIMED` | Owner 认领宿主、确认 `deployment_mode` 并初始化加密 Secrets Vault。新部署的角色卡、Soul 与挂载列表为空。 |
| `L1_CLAIMED_NO_PROVIDER` | 在 Host Provider Pool 配置并在线验证真实模型，绑定必需的 `consciousness` 宿主默认模型。`vision` 和 `speech` 按需配置。支持 OpenCode Go（`opencode_go`，如 `deepseek-v4.1-flash`）、OpenAI-compatible、Anthropic、DeepSeek 和 Ollama。探测失败时保留本级缺项。 |
| `L2_PROVIDER_READY_NO_SOUL` | 创建空白 Character Card V3（`chara_card_v3`）或导入角色卡，无损保留未知 `extensions.<namespace>`。Owner 显式从静态卡唤醒独立的 `<soul_id>.soul`。 |
| `L3_SOUL_AWAKENED_CONFIG_NEEDED` | 补齐必需扩展、Vault 引用及角色模型绑定。角色可按模块选择 `Inherit` 沿用宿主默认，或用 `Override` 指定角色模型。未授权的可选传感器锁定为 `"blind"`，禁止推断未观测信息。 |
| `L4_SOUL_AWAKENED_NO_CHANNEL` | 绑定跨端 `Principal`，签发限定作用域的 `Scoped Capability Token`，通过 `HandshakeManifest` 配对首个在线且合规的 InteractionChannel，例如 `builtin.webchat`。 |
| `L5_LIVE_READY` | 全部前置条件满足，开始接纳 LIVE 陪伴话轮，`VirtualClock` 锁定 1x。 |

阶段按 L0 → L1 → L2 → L3 → L4 → L5 推进，条件失效时从首个未满足条件重新计算。`GET /healthz` 独立检查进程存活。`GET /readyz` 返回 `stage` 与 `missing_prerequisites`，仅在 L5 返回 HTTP 200，其余阶段返回 503。Channel A 以同一门控接纳话轮。

部署的 WebChat 使用 Channel A 的 HTTP/SSE 桥。五原语的 JSON-RPC WebSocket 绑定与部署桥接路径详见[协议与网关规范](docs/architecture/04-protocol-v0-and-gateway-spec.md)。

## 三级渐进派生

1. **Level 1 · 四层物理实体分离**。宿主基础设施落在 `souls/host/`，管理 Vault、Provider Pool 和卡片注册表。静态 CCv3 角色卡负责角色定义，唤醒后的 `*.soul` 实例拥有独立运行状态，InteractionChannel 与扩展在运行时按权限挂载。
2. **Level 2 · 跨场景能力消去与五核正交分立**。逐项移除特定场景的感官、媒介和执行能力，提取跨场景稳定的协议与职责边界。
3. **Level 3 · 渐进证伪与主仓收敛**。`labs/stage0-paper-traces` → `labs/stage1-agent-core` → `labs/stage2-airi-dissection` → `labs/stage3-perception-expression` → `labs/stage4-universal-derivation` → `labs/stage5-composite-channel-facets` → `labs/stage6-mechanism-policy-ablation` → `labs/stage7-public-contracts`。

## 五个正交无头核心

| 包 | 权威职责 |
| --- | --- |
| `@ai0/extension-core` | `ExtensionCoreHost` 按包启停、配置、热重载与故障隔离，`defineFacetPoint` 声明能力接点，`ExtensionComposition` 管理 Cordis Fiber 贡献生命周期。 |
| `@ai0/agent-core` | 机械式 `Turn/Round` 执行、工具调度和多 Provider 传输。以 `system_invariant`、`developer_frame`、`untrusted_observation` 三层分离指令权威与数据。缺乏目标证据时结算为 `unverified`，与数字生命领域零耦合。 |
| `@ai0/perception-core` | 通过 `EmbodimentAffordanceRegistry` 注册具身能力，以 `UniversalObservationFrame` 六元组元语法归一观察。TTL 和 `"blind"` 锁约束推断，`TurnLifecycleGate` 处理 `activity\|interim\|commit\|retract`，`ReflexGate` 拦截例行信号，`ChronoceptiveSignalSynthesizer` 从经过时间扣除冬眠区间。 |
| `@ai0/cognition-core` | `./kernel` 提供 `VirtualClock`、`ContinuousStateMetaEngine` 与 `StateDomainArbiter`；`./subsystems` 提供通用五域状态协调器、四级认识论记忆防火墙、`CommonGround` 状态机、三维污点门控、受众隔离黑板编译器与能动性/睡眠巩固循环，零伴侣人设硬编码。[认知核](packages/cognition-core/README.md) · [稳态插件](plugins/cognitive-organs/companion-homeostasis/src/index.ts) |
| `@ai0/expression-core` | 零人形假设的 `CommunicativeIntentEnvelope` 描述表达意图。`RealizerVocabularyNegotiator` 在缺少合规 InteractionChannel 时将表达置为 `held_pending_compliant_channel`，`InteractionOpportunityPool` 管理表达机会。四态真值链为 `generated_unpresented → physically_presented → actuation_verified → interlocutor_grounded`。基于 `silenced` 和 `done` 双边界回执恢复 `unsaid_remainder`。 |

`@ai0/protocol` 提供零内部依赖的 Zod 机器契约（含 `HandshakeManifest`、`Ai0ExtensionManifest` 与协议帧）。`@ai0/storage` 管理宿主基础设施及 Local-First `.soul`，以 SQLite WAL、FTS5 和向量索引支撑持久化与检索，并执行受众过滤和跨快照真遗忘。`@ai0/gateway` 以 `ChannelProtocolGateway` 提供 `/protocol/v0/channel`，以 `PrivilegedAdminServer` 提供 Owner 管理。`@ai0/sdk` 以 `defineExtensionPackage` 与标准 `FacetPoint` 提供一包多切面接入，参考插件与社区插件同受零后门边界约束，仅可依赖 `@ai0/protocol` 与 `@ai0/sdk`。

`ContinuousStateMetaEngine` 默认 `descriptors = []`，状态为 `{}` 且无状态唤醒期限。`PerceptionFilterPipeline` 无过滤切面时直通，撤稿只触发中性取消。Stage 6 在同一套五核实验机制上验证陪伴配置和 Task Agent 配置。CLI 话轮在输入的虚拟时间立即执行，策略等待为 0 ms，工具结果仍需证据核验。

## Monorepo 拓扑

```text
ai0/
├── packages/
│   ├── protocol/
│   ├── extension-core/
│   ├── agent-core/
│   ├── perception-core/
│   ├── cognition-core/
│   ├── expression-core/
│   ├── storage/
│   ├── gateway/
│   └── sdk/
├── labs/
│   ├── stage0-paper-traces/
│   ├── stage1-agent-core/
│   ├── stage2-airi-dissection/
│   ├── stage3-perception-expression/
│   ├── stage4-universal-derivation/
│   ├── stage5-composite-channel-facets/
│   ├── stage6-mechanism-policy-ablation/
│   └── stage7-public-contracts/
├── plugins/
│   ├── channels/              # WebChat、Terminal 等交互通道
│   ├── perception-filters/    # 感知策略
│   ├── cognitive-organs/       # 认知器官
│   ├── media-pipelines/        # 多模态媒体管线
│   ├── skills-and-mcp/         # 技能与 MCP
│   └── flows-and-assets/       # 工作流与资产
├── apps/
│   ├── daemon/                 # @ai0/daemon，组装运行时
│   └── console/                # @ai0/console-webui，Owner 控制台
├── souls/
│   ├── host/                   # 宿主基础设施与初始为空的卡片注册表
│   └── <soul_id>.soul/          # Owner 显式唤醒后生成
├── scripts/
│   └── verify-architecture-boundaries.mjs
└── docs/
    ├── vision/                 # 01～05
    └── architecture/           # 01～08
```

## 架构全景

```mermaid
flowchart TB
    InteractionChannel["已挂载 InteractionChannel 与媒体管线"]
    Console["@ai0/console-webui（Owner 控制台）"]
    Probe["部署探针"]
    subgraph Gateway["@ai0/gateway（双平面网关）"]
        A["Channel A · /protocol/v0/channel（协议入口）"]
        B["Channel B · /api/admin/v1/*（Owner REST / SSE）"]
        H["/healthz · /readyz"]
    end
    subgraph Cores["五个正交无头核心"]
        Extensions["@ai0/extension-core"]
        Perception["@ai0/perception-core"]
        Cognition["@ai0/cognition-core"]
        Agent["@ai0/agent-core"]
        Expression["@ai0/expression-core"]
    end
    Storage["@ai0/storage（宿主基础设施与 .soul 存档）"]
    InteractionChannel <-->|"结构化观察、表达与回执"| A
    Console <-->|"配置与可观测性"| B
    Probe --> H
    A --> Perception --> Cognition
    Cognition <--> Agent
    Cognition --> Expression --> A
    Cognition <--> Storage
    B --> Cognition
    B --> Storage
    B --> Extensions
    Extensions -.-> Agent & Perception & Cognition & Expression
```

## 文档导航

### 通用层开发入口

| 开发任务 | 对应 README |
| --- | --- |
| 修改跨包契约、编写或装载扩展 | [协议](packages/protocol/README.md) · [插件 SDK](packages/sdk/README.md) · [扩展宿主](packages/extension-core/README.md) · [参考插件](plugins/README.md) |
| 追踪一次输入如何成为话轮并交付 | [感知](packages/perception-core/README.md) · [Agent 执行](packages/agent-core/README.md) · [认知状态](packages/cognition-core/README.md) · [表达与回执](packages/expression-core/README.md) |
| 接入存储、通道或宿主策略 | [持久化](packages/storage/README.md) · [网关](packages/gateway/README.md) · [daemon 装配](apps/daemon/README.md) · [参考插件](plugins/README.md) |
| 开发控制台页面或共享组件 | [控制台入口](apps/console/README.md) · [请求客户端](apps/console/src/api/README.md) · [共享上下文](apps/console/src/context/README.md) · [路由](apps/console/src/router/README.md) · [工作区](apps/console/src/pages/README.md) · [设计系统](apps/console/src/design-system/README.md) |

### 愿景与问题域

1. 项目立基公理、先行体系对照与零预设 Deploy-to-Live。[01 愿景与先行者](docs/vision/01-vision-and-predecessors.md)
2. 认知与行为边界、隐私约束和失效防护。[02 认知内核与边界](docs/vision/02-cognitive-kernel-and-boundaries.md)
3. 具身协议、扩展契约与 Owner 控制台原则。[03 协议与控制台](docs/vision/03-protocol-and-webui-console.md)
4. 设计盲点、优先级和最小验证切片。[04 盲点与 MVP](docs/vision/04-blindspots-priorities-and-mvp-slice.md)
5. Tier 0 安全底线、反情感操控与 SB 243 约束。[05 伦理与安全](docs/vision/05-ethics-safety-and-sb243-compliance.md)

### 工程规格与交付

1. 三级派生、九包拓扑与依赖允许清单。[01 系统总体架构](docs/architecture/01-system-overview-and-monorepo.md)
2. 宿主与角色存档、SQLite Schema、记忆血缘和真遗忘。[02 存储与灵魂存档](docs/architecture/02-storage-and-soul-archive-schema.md)
3. 五域状态协调、认知黑板与 W1～W4 循环。[03 运行时协调与能动性循环](docs/architecture/03-runtime-coordinator-and-agency-loop.md)
4. Protocol v0、双平面网关、受限令牌、表达回执与就绪门控。[04 协议与网关规格](docs/architecture/04-protocol-v0-and-gateway-spec.md)
5. 多切面扩展接口、五类载体与统一权限边界。[05 多切面扩展规范](docs/architecture/05-eight-dimension-extension-system.md)
6. 零预设上线向导、紧凑 MD3、管理接口与回放观测。[06 控制台与可观测性](docs/architecture/06-webui-console-and-observability-arch.md)
7. Clean-Slate V1 架构决断记录与先行项目实证。[07 ADR 与先行实证](docs/architecture/07-implementation-adrs-and-deviation-ledger.md)
8. 渐进证伪、空卷上线验收与交付门槛。[08 产品验证与交付计划](docs/architecture/08-product-validation-and-delivery-plan.md)
