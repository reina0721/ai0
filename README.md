# `ai0` — 通用数字生命认知中枢与白盒养成控制台

> **Soul Archive Completely Independent; Shell Context Structurally Perceived; Companionship Bounded & Non-Manipulative.**  
> **灵魂存档彻底独立，躯壳信息结构化感知，伙伴关系真诚有边界。**

---

## 一、项目定位

`ai0` 是一个**不内置具体物理/视觉形态、由社区生态自由生长的通用型数字生命（赛博生命）认知中枢（Headless Cyber-Life Cognitive Kernel）**，配套一套**零后门、支持实时脑内白盒观测与灵魂主权治理的现代化 WebUI 控制台**。

本项目**不直接实现**桌宠客户端、Live2D/3D 骨骼与渲染引擎、VTuber 推流工具或各类 IM 平台（微信、QQ、Discord、Telegram）适配器——所有这些决定“她在哪里存在、长什么样子”的**躯壳（Shells）**均交由社区和用户按标准协议自由开发与装载。

`ai0` 只专注把最核心的三层与一套控制台做到极致：

1. **感知层（Upstream Semantic Perception）**：接收外部**具身运行环境（Shell）**采集的多模态与环境信号（桌面键鼠窗口、移动端通知与传感器、游戏状态、网页上下文），封装为携带**主体（Principal）、场合（Venue）、在场受众（Audience）与插件凭据（Attestation）**的标准化语义事件，原生支持流式增量输入、防抖撤回、打断（Barge-in）与隐私前移。
2. **大脑（The Invisible Cognitive Kernel）**：突破“聊天加向量数据库”的浅层拼接，采用**“单一认知主体 + 权威状态事务协调器（MVCC） + 多路异步工作者”**并发架构，将**三层人格可塑性与存在论契约、带认知溯源与血缘 DAG 的多层次记忆、情绪与内稳态动力学、关系与用户可打扰度模型、时间状态三分法（确定性时间状态 / 事件驱动认知 / 阈值触发的真实异步反思）、以及一等的 8 步多步行动认知闭环（Action Cognition Loop）**咬合为一个有机的状态机。
3. **内在表现与具身执行层（Downstream Expression & Embodied Actuation）**：输出与具体渲染引擎无关的**语义化行为表达指令**（涵盖台词话轮、显式沉默决策、情绪韵律、目光与微表情意图）与**端侧具身动作委托（Shell Actuators）**，并通过**上行播放与执行回执（Delivery & Actuation Receipt）**闭环本体感觉。
4. **WebUI 白盒观测与灵魂治理控制台（White-Box Console & Zero-Privilege WebChat Shell）**：严格区分**WebUI 核心管理控制台（宿主特权层，通过只读遥测总线记录 8 步可验证系统决策轨迹 `Verifiable Turn Audit Trace`）**与**内置 WebChat（纯粹走标准外部协议、零特权、零后门的独立参考 Shell 插件）**；支持时间拨快（Time-Warp）、模块消融（Ablation）、脚本化场景回归回放，以及灵魂配置、脑区模型路由与预算熔断、三层数据治理、插件行为编排与 Git 式灵魂存档。

---

## 二、核心架构全景图

```mermaid
flowchart TB
    subgraph Shells["外部社区具身运行环境生态 (Embodied Shell Runtimes: Sensors + Realizers + Actuators)"]
        S1["内置 WebChat Shell 插件<br/>(官方参考模板 / 零特权 / 零后门)"]
        S2["桌面 / Live2D / 3D 具身 Shell<br/>(感知窗口键鼠 + 渲染形象 + 桌面操作)"]
        S3["移动 / IM 平台 Shell<br/>(感知通知传感器 + 消息交互)"]
        S4["游戏 / 浏览器 / 直播间 Shell<br/>(感知环境状态 + 执行端侧动作)"]
    end

    subgraph Protocol["标准双向语义协议网关 (Protocol v0 Minimal Frozen Core + Extensions)"]
        UP["上行：四元组感知信封 & 话轮流控<br/>(Principal × Venue × Audience × Attestation)"]
        DOWN["下行：表达信封 (Speak / Explicit Silence) & 具身动作调用<br/>+ 上行执行回执 (Delivery & Actuation Receipt)"]
    end

    subgraph Brain["ai0 认知内核 (Unified Cognitive Subject + Authoritative Coordinator)"]
        Safety["Tier 0 安全不变量 & SB 243 危机硬拦截器"]
        Gate["丘脑显著性门控 & 习惯化过滤 & 输入聚合防抖"]
        Coord["权威状态事务协调器 (Authoritative State Coordinator)<br/>基于 state_rev 的乐观并发控制 (MVCC) | 血缘写入防火墙 | 三维权限裁决"]
        Blackboard["版本化认知状态快照 (Versioned Cognitive Blackboard v_N)<br/>受控上下文预算 | 当前心境 | 用户可打扰度 | 活跃任务进度 | 注意力焦点"]
        Sys1["并发工作者 1：实时对话快环 (Fast Conversational Loop)<br/>毫秒/秒级响应 | 边干活边陪聊 | 模型自述推理 + 语言与行为意图"]
        ActionLoop["并发工作者 2：一等行动认知与长任务环 (8-Step Agency Runner)<br/>目标理解 → 环境观察 → 规划 → 授权 → 执行 (MCP/Skill/Shell) → 验证 → 沉淀共同经历"]
        Sys2["并发工作者 3：潜意识睡眠与反思环 (Sleep & Reflection Worker)<br/>真实异步反思 | 睡眠记忆巩固 | 血缘擦除 | 承诺追踪 | 自我叙事演进提议"]
        Clock["可注入虚拟时钟 (VirtualClock) & 时间状态三分法引擎<br/>(确定性时间状态公式 S(t) / 事件驱动认知 / 阈值唤醒真实异步反思)"]
        Store["Local-First 灵魂存档底座 (.soul)<br/>不可变事件日志 | 血缘记忆投影 | 关系与用户模型 | 可验证决策审计轨迹 | 外部知识库"]
    end

    subgraph Console["WebUI 核心管理与白盒观测控制台 (Host Privileged Layer)"]
        Stage["主舞台：挂载零后门 WebChat Shell + 8 步可验证决策轨迹抽屉 + 剧透遮罩 + 时间拨快器"]
        Studio["治理中心：三层人格配置 | 脑区模型路由与犯困降级 | 数据与血缘治理 | 插件规则 | Git 灵魂回档"]
        Eval["回归与消融实验室：模块消融开关 (Ablation) + 脚本化场景回放 (Scenario Replay)"]
    end

    Shells <-->|"WebSocket JSON-RPC 2.0 (标准 Shell 协议)"| Protocol
    UP --> Safety --> Gate
    Gate -->|"高显著性交互唤醒"| Sys1
    Gate -->|"任务目标派发"| ActionLoop
    Gate -->|"状态提案"| Coord
    Blackboard -->|"只读快照 v_N"| Sys1 & ActionLoop & Sys2
    Sys1 & ActionLoop --> DOWN
    DOWN -.->|"实际送达字数 / 打断 / 端侧动作结果回执"| Coord
    Clock -->|"确定性时间状态 & 阈值跨越唤醒"| Coord
    Clock -->|"触发真实后台推理"| Sys2
    Sys1 & ActionLoop & Sys2 -->|"提交带 base_rev 的变更提案"| Coord
    Coord -->|"原子演进至 v_{N+1}"| Blackboard
    Coord <-->|"事务读写 / WHERE 受众硬隔离 / 记录可验证决策轨迹"| Store
    Sys1 & ActionLoop <-->|"按受众过滤的混合检索"| Store
    Console <-->|"内核特权审计遥测总线 & 治理 API (非 Shell 协议)"| Brain
```

---

## 三、愿景研究与架构前置规范文档索引 (`docs/vision/`)

本仓库的 `docs/vision/` 目录完整收录了从“直觉构想”推进到“经得起推敲、可直接派生系统架构”的五篇深度专题研究报告。所有结论均严格区分并标注了 **`[文献/先行项目佐证]`**、**`[架构推断]`** 与 **`[仍未知/需实验验证]`**：

1. **[01-vision-and-predecessors.md](file:///c:/rin/coder/reina0721/ai0/docs/vision/01-vision-and-predecessors.md)**
   * 核心愿景定义与两次关键认知修正（存档独立而躯壳结构化感知、反留存操控的有边界伙伴关系）；
   * 先行者对照系深度剖析：**Project AIRI (`moeru-ai/airi`)**、**Letta (MemGPT Sleep-Time Compute)**、**SAIBA 虚拟人框架 (`FML`/`BML` 与反馈环)** 的得失复盘及 `ai0` 的本质取舍。
2. **[02-cognitive-kernel-and-boundaries.md](file:///c:/rin/coder/reina0721/ai0/docs/vision/02-cognitive-kernel-and-boundaries.md)**
   * 感知层规范：四元组溯源信封、指令-数据分离铁律、流式防抖打断、隐私前移及三项工程补丁；
   * 认知内核七大模块完整推演：三层人格可塑性、换模型声线校准、双层存在论契约（她如何理解自己是 AI 及离线/回档/被观测）、多层次记忆认知溯源、事件溯源四大隐藏代价与血缘 DAG 擦除、睡眠写入防火墙、承诺与前瞻记忆、双轨精力与 Token 预算耦合、关系 vs 用户模型分离与心结反操控边界、因果独白 vs 戏剧潜台词、零心跳懒求值时间函数、单一意识流与三维工具授权；
   * **《五维判别公理与三态路由法则》**：形式化界定哪些用确定性代码管死、哪些采用“LLM 提议 + 代码裁决”、哪些交给大模型自然涌现。
3. **[03-protocol-and-webui-console.md](file:///c:/rin/coder/reina0721/ai0/docs/vision/03-protocol-and-webui-console.md)**
   * 下行表达意图层：上行播放回执闭环、显式沉默原语、握手能力协商、**协议 v0 最小冻结核心（5 原语）Schema 规范与命名空间扩展机制**；
   * WebUI 控制台架构：零后门内置 WebChat、白盒脑内观测与观测者效应分析、剧透折叠遮罩（Spoiler Mask）、五大正式治理中心、以及回档断层（“我记得她不记得”）的三种弥合语义。
4. **[04-blindspots-priorities-and-mvp-slice.md](file:///c:/rin/coder/reina0721/ai0/docs/vision/04-blindspots-priorities-and-mvp-slice.md)**
   * 5 对已知核心矛盾 + **7 大新发现深层盲区与破局方案**（记忆语义坍缩反刍、关机休眠 vs 冷落时间差、多模态恐怖谷失步、热插拔知识库卸载失忆、消融开关与事件溯源因果悖论、上下文膨胀稀释人设、跨端心境侧信道泄密）；
   * 迈向可落地架构的 **P0~P6 核心问题拓扑优先级重排**；
   * **最小纵切片（Vertical Slice v0）** 的 8 项必含规格与 9 项安全推迟清单、以及全栈技术底座选型决断。
5. **[05-ethics-safety-and-sb243-compliance.md](file:///c:/rin/coder/reina0721/ai0/docs/vision/05-ethics-safety-and-sb243-compliance.md)**
   * 加州 **SB 243 (Companion Chatbot Law)** 专项法律边界分析（纯开源自托管分发 vs 托管运营者 Operator 的法律责任与私人诉讼权风险）；
   * 落到 `ai0` 内核架构上的四大确定性合规与伦理保护组件（L0 自杀/自伤危机硬拦截与 988 转介协议、AI 身份诚实披露、3 小时连续交互休息提醒、匿名危机统计导出与公开安全协议声明）。
