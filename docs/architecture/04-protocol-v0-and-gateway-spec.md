# 04. Clean-Slate V1：Protocol v0 原语与双向网关规范

> **项目阶段**：架构研究与工程规格设计阶段（解法域工程规格）
>
> 本文档定义 `@ai0/protocol` 与 `@ai0/gateway` 的工程契约。它给出了 **Clean-Slate V1 的 Protocol v0 五原语 TypeScript 契约**、官方标准扩展命名空间契约、`Scoped Capability Token` 防伪验签机制，以及上行输入防抖聚合与下行流式打断回执状态机。

---

## 一、Protocol v0 最小冻结核心：五原语完整 Schema 定义

传输层统一采用 **WebSocket 上的 JSON-RPC 2.0 双向消息帧**（端点：`ws://host:port/protocol/v0/shell`）。核心协议严格锁定为以下 **5 个原子原语（The 5 Atomic Primitives）**：

```typescript
// packages/protocol/src/core-v0/primitives.ts
import type { AttentionTarget } from "../extensions/standard-v1";

export type ProtocolVersion = "0.1.0";
export type VenueType = "private_1on1" | "group_chat" | "public_livestream" | "local_ambient";
export type AudienceScope = "only_owner" | `group:${string}` | "public_all";

/**
 * 开放能力类型约定：知名核心枚举 + 带命名空间的开放扩展字符串
 * 确保社区作者新增自定义躯壳类型或新型传感器时，无需修改协议核心即可合法握手，由网关按未知能力降级规则透传。
 */
export type WellKnownShellKind = "webchat" | "desktop_avatar" | "im_bridge" | "game_embodied" | "hardware_iot" | "cli";
export type ShellKind = WellKnownShellKind | `custom.${string}`;

export type WellKnownSensorModality =
  | "text"
  | "audio_transcript"
  | "vad_activity"
  | "typing_activity"
  | "visual_cue"
  | "contact_interaction"
  | "state_telemetry"
  | "ambient_presence";
export type SensorModality = WellKnownSensorModality | `custom.${string}` | (string & {});
/**
 * 原语 1：HandshakeManifest (连接建立后由 Shell 发送给 Gateway 的能力与场合声明)
 */
export interface HandshakeManifest {
  protocol_version: ProtocolVersion;
  shell_id: string;                          // 如 "builtin.webchat.default" 或 "community.live2d.desktop"
  shell_kind: ShellKind;
  display_name: string;
  venue_type: VenueType;
  current_audience: {
    scope: AudienceScope;
    member_count: number;
    description?: string;                    // 如 "B站直播间 (当前在线 320 人)"
  };
  latency_budget_ms: number;                 // 实时语音 ~600ms，桌面聊天 ~1500ms，异步IM ~5000ms
  capabilities: {
    /** 平面 1：端侧可采集并上报的感知模态 (支持 WellKnownSensorModality 及 custom.* 开放扩展) */
    sensors: SensorModality[];
    /** 平面 2：支持解析渲染的下行扩展命名空间与动态具身表现力词典 */
    supports_card_assets?: boolean;
    embodiment_anchors?: string[];
    supported_extensions: string[];          // 如 ["ext.affect.v1", "ext.rhythm.v1", "ext.embodied.v1"]
    /**
     * 可选：动态具身表现力词典协商 (Dynamic Embodied Expression Vocabulary)
     * 允许 Live2D/VRM/桌宠 Shell 或关联的情感 TTS 管线在握手及 capabilities_updated 时动态注册当前可用表情、动作意图与声线情绪标签，
     * 由认知黑板按情境注入 System 1，既保持核心协议极简，又彻底释放高阶躯壳的演出可玩性。
     */
    expression_vocabulary?: {
      expression_tags?: string[];
      semantic_actions?: string[];
      voice_emotion_tags?: string[];         // 如 ["shy_whisper", "tsundere_retort", "sleepy_yawn", "warm_comfort"]
    };
    /** 平面 3：端侧暴露的具身执行器契约 (供大脑 8 步行动认知环调用，支持运行期通过 capabilities_updated 动态热增删) */
    actuators: Array<{
      actuator_id: string;                   // 如 "desktop.take_authorized_snapshot" | "game.move_to"
      description: string;
      parameters_json_schema: Record<string, unknown>;
      requires_local_user_consent: boolean;
    }>;
  };
  auth_token: string;                        // 控制台签发的 Scoped Capability Token
}

/**
 * 原语 2：PerceptionEnvelope (Shell -> Gateway 上行标准化语义感知信封)
 */
export interface UniversalObservationFrame {
  channel: { modality: SensorModality; source_key: string; lifecycle: PerceptionEnvelope["lifecycle"] };
  attribution: { actor: PerceptionEnvelope["actor"]; principal_id?: string };
  contextFrame: { shell_id: string; venue_type: VenueType; audience_scope: AudienceScope };
  provenance: { event_id: string; persistence_hint: PerceptionEnvelope["persistence_hint"]; extensions: Record<string, unknown> };
  interpretation: { summary_text: string; confidence: number };
  chronology: { timestamp: string; sustained_ms?: number };
}

export interface PerceptionEnvelope {
  frame: UniversalObservationFrame;
  event_id: string;                          // ULID
  timestamp: string;                         // ISO-8601 UTC
  actor: {
    platform_uid: string;                    // 平台侧原始用户 ID (网关将结合身份绑定表映射为内核 Principal)
    display_name: string;
  };
  /** 话轮生命周期：活动信号(防抖/闪避) | 流式增量草稿 | 正式提交 | 撤回(欲言又止) */
  lifecycle: "activity" | "interim" | "commit" | "retract";
  /** 开放感知模态：统一复用 SensorModality (支持 WellKnownSensorModality 及 custom.* 社区自定义模态) */
  modality: SensorModality;
  summary_text: string;                      // 与 frame.interpretation 一致的语义摘要
  confidence: number;                        // [0.0, 1.0] 边缘模型识别置信度 (文本输入恒为 1.0)
  sustained_ms?: number;                     // 持续时长 (用于过滤瞬时视觉抖动误报)
  persistence_hint: "permanent" | "ephemeral_blackboard"; // 连续生物特征默认仅进短期黑板，不落永久日志
  extensions: Record<string, unknown>;       // 命名空间扩展字典 (如 ext.perception.v1)
}

/**
 * 原语 3：ExpressionEnvelope (Gateway -> Shell 下行表达意图与具身动作调用信封)
 */
export interface CommunicativeIntentEnvelope {
  intent_id: string;
  correlation_event_id: string;
  action_type: "speak" | "explicit_silence" | "invoke_actuator" | "request_observation";
  attention_target?: AttentionTarget;
  expressive_stance?: string;
  delivery_constraints: {
    audience_scope: AudienceScope;
    require_non_verbal_quiet?: boolean;
    max_latency_ms?: number;
  };
  fallback_text: string;
  observation_request?: { modality: SensorModality; source_key?: string };
  silence_reason?: "listening_wait_for_more" | "not_addressed_in_group" | "respecting_user_focus" | "emotional_pause";
  actuator_invocation?: {
    actuator_id: string;
    arguments: Record<string, unknown>;
  };
}

export interface ExpressionEnvelope extends CommunicativeIntentEnvelope {
  chunk_seq: number;
  is_final: boolean;
  extensions: Record<string, unknown>;
}

/**
 * 原语 4：DeliveryReceipt (Shell -> Gateway 上行播放、打断与具身动作执行回执)
 */
export interface DeliveryReceipt {
  intent_id: string;
  chunk_seq: number;
  status: "rendered" | "playing" | "completed" | "interrupted" | "degraded" | "failed";
  /** 被打断时以字符起音为界的播放偏移（Unicode 码点） */
  spoken_char_offset?: number;
  played_audio_ms?: number;
  interruption_boundary?: "silenced" | "done";
  interrupted_by_event_id?: string;
  degraded_extensions?: string[];            // 躯壳因能力限制优雅降级忽略的扩展名列表
  actuator_outcome?: {
    success: boolean;
    result_summary: string;
    data?: Record<string, unknown>;
    error_code?: string;
  };
}

/**
 * 原语 5：ControlSignal (Bidirectional 双向流控、动态能力热更新、注意力焦点与系统合规信号)
 */
export interface ControlSignal {
  signal_type:
    | "barge_in_cancel"                      // 通知对方立即中止当前流式输出或音频播放
    | "audience_changed"                     // Shell 动态上报在场受众变更 (如有人加入房间)
    | "capabilities_updated"                 // Shell 运行期随场景变化动态热注册/注销 actuators 或 sensors
    | "focus_shifted"                        // Gateway 通知各 Shell 当前前台注意力焦点已切换至哪个 Shell
    | "sb243_break_reminder"                 // Gateway 下发连续交互满 3 小时休息提醒
    | "crisis_intervention_card";            // Gateway L0 危机拦截器下发的强制危机援助热线卡片
  target_intent_id?: string;
  active_focus_shell_id?: string;
  payload?: Record<string, unknown>;
}
```

---

### 1.1 观测元语言与结构保真

每个 `PerceptionEnvelope` 携带一个 `UniversalObservationFrame`。六维一一映射：`channel` 对应模态、来源键与生命周期，`attribution` 对应说话者与经验证的主体，`contextFrame` 对应会话的 Shell、场合与有效受众，`provenance` 对应事件 ID、持久化提示与扩展，`interpretation` 对应摘要与置信度，`chronology` 对应时间戳与持续时长。顶层同名字段是镜像，校验时拒绝冲突。会话来源、有效受众及主体由网关依连接和令牌验证，端侧自报身份不能授予权限。

`@ai0/gateway` 在验签、路由、防抖与交付 `@ai0/perception-core` 的全链路保留结构化帧。`PendingTurnBatch` 保存有序帧集合，禁止将观测扁平化为纯字符串。`custom.*` 与插件声明的开放模态字符串可保留原始扩展字段。

### 1.2 表达与私密交付协商

`@ai0/expression-core` 的 `RealizerVocabularyNegotiator` 校验有效受众、非语言静默约束、延迟预算及词典。无在线合规私密 Shell 时，将私密意图置为 `held_pending_compliant_shell`，内容及回退文本不得外发。受众或能力变化时重新校验，过期意图不下发。`explicit_silence` 不启动语音播放，`require_non_verbal_quiet` 约束非语言输出，`request_observation` 仍须经过感知授权。

`embodiment_anchors` 支持握手声明与 `capabilities_updated` 热更新。`supports_card_assets` 为真时与卡片资产锚点合并去重。`anchor:<id>` 与 `target_anchor` 指向协商后的锚点。

---

## 二、官方标准扩展命名空间契约（Standard Extension Namespaces）

所有高阶感官覆盖与多模态表现力均装载于 `PerceptionEnvelope.extensions` 与 `ExpressionEnvelope.extensions` 中，内核与躯壳按 `supported_extensions` 消费或优雅忽略：

```typescript
// packages/protocol/src/extensions/standard-v1.ts

/** 0. 上行视神经感官覆盖桶与预测编码假设扩展 (ext.perception.v1) */
export interface ExtPerceptionV1 {
  /** 按 (shell_id, modality, source_key) 原地刷新的环境上下文桶标识 */
  source_key: string;                        // 如 "camera.main" | "desktop.active_window" | "game.combat_hud"
  /** 感官覆盖与授权状态 */
  coverage: "live_foveal" | "ambient_peripheral" | "on_demand" | "blind" | "stale" | "disconnected";
  /** 观测时间跨度毫秒数 (静态单张图片恒为 0，物理禁止推断连续动作次数!) */
  frame_span_ms: number;
  /** 新鲜度 TTL：超过该毫秒数未收到新帧，黑板自动将该桶降级为 stale */
  freshness_ttl_ms: number;
  /** 预测编码：当边缘识别存在歧义时附带竞争感知假设，供后续特写/语境到来时触发微时间改口 */
  competing_hypotheses?: Array<{
    summary_text: string;
    confidence: number;
  }>;
}

/** 1. 情感与连续维度扩展 (ext.affect.v1) */
export interface ExtAffectV1 {
  label: string;                             // 如 "shy_affectionate", "sleepy", "teasing", "concerned"
  vad: {
    valence: number;                         // 愉悦度 [-1.0, 1.0]
    arousal: number;                         // 激活度 [0.0, 1.0]
    dominance: number;                       // 支配度 [0.0, 1.0]
  };
}

/** 2. 话轮节律与语音韵律扩展 (ext.rhythm.v1) */
export interface ExtRhythmV1 {
  pre_delay_ms: number;                      // 开口前思考停顿毫秒数
  typing_indicator_ms: number;               // 模拟“正在输入...”持续时长
  pause_after_ms: number;                    // 本分段说完后与下一分段之间的停顿间隔
  prosody?: {
    speed_rate: number;                      // 语速倍率 [0.5, 2.0]，默认 1.0 (犯困时如 0.85)
    pitch_shift: number;                     // 音高微调 [-1.0, 1.0]
    vocal_effort: "whisper" | "soft" | "normal" | "energetic";
  };
}

/** 3. 领域中立的具身关键帧 (ext.embodied.v1) */
export type AttentionTarget =
  | "interlocutor" | "referenced_subject" | "ambient_environment"
  | "inward_withdrawn" | `anchor:${string}`;

export interface EmbodiedKeyframe {
  sync_anchor: "pre_speech" | "on_utterance_start" | `on_substring:${string}` | "on_utterance_end";
  attention?: {
    target: AttentionTarget;
    behavior: "locked" | "glancing" | "ambient_scan";
  };
  expression?: {
    tag: string;
    intensity: number; // [0.0, 1.0]
    fallback_tag?: string;
  };
  actuation_cue?: {
    semantic_action: string;
    target_anchor?: string;
    intensity?: "subtle" | "moderate" | "strong";
    fallback_action?: string;
  };
  linger_ms?: number;
}

export interface ExtEmbodiedV1 extends EmbodiedKeyframe {
  keyframes?: EmbodiedKeyframe[]; // 最多 3 帧，按相对同步锚点调度
}

/**
 * 4. 网关侧媒体管线流式合成音频、口型同步帧与字符时间戳对齐伴生扩展 (ext.media.sideband.v1)
 * 当轻量 Shell 委托网关侧 ext.media_pipeline (如 GPT-SoVITS / FishAudio) 代工合成语音时，随 ExpressionEnvelope 下发：
 */
export interface ExtMediaSidebandV1 {
  /** 流式音频伴生通道标识或二进制帧引用 URI */
  audio_stream_id: string;
  audio_format: "pcm_s16le_24k" | "opus_webm" | "mp3";
  total_duration_ms: number;
  /**
   * 字符级音频起始毫秒时间戳对齐表 (长度与 fallback_text 的 Unicode 字符长度严格一致)
   * char_offset_timestamps_ms[k] 表示第 k 个字符在音频流中开始发声的毫秒偏移量，供语音中途打断时精确反算 spoken_char_offset!
   */
  char_offset_timestamps_ms: number[];
  /** 口型同步序列 (Visemes)，供 Live2D/3D 躯壳驱动嘴部骨骼 */
  viseme_frames?: Array<{
    offset_ms: number;
    viseme: "sil" | "aa" | "E" | "I" | "O" | "U" | "PP" | "FF" | "TH" | "DD" | "kk" | "CH" | "SS" | "nn" | "RR";
    weight: number;
  }>;
}
```

---

### 2.1 感官覆盖与 `blind` 锁

`live_foveal` 表示当前焦点实时覆盖，`ambient_peripheral` 表示外围背景覆盖，`on_demand` 表示仅按授权请求采集，`stale` 表示帧超出 TTL，`disconnected` 表示连接中断。Shell 已连接但未授权传感器（如摄像头权限拒绝或撤销）时，`@ai0/perception-core` 的 `EmbodimentAffordanceRegistry` 与 `ScopedContextRegistry` 按 `(shell_id, modality, source_key)` 锁定为 `blind`，遮蔽旧载荷并向认知发出 `sensor_unavailable`。只有重新获准且收到新鲜授权帧才解除锁定。缓存及推断不得冒充该来源的当前感知。

### 2.2 具身词典

`RealizerVocabularyNegotiator` 动态匹配 `HandshakeManifest.capabilities.expression_vocabulary`。`expression.tag` 和 `fallback_tag` 匹配 `expression_tags`，`actuation_cue.semantic_action` 和 `fallback_action` 匹配 `semantic_actions`。候选与回退均不可用时省略该提示并回报降级。同步锚点与 `linger_ms` 描述呈现时序，动作提示本身不构成执行证据。

---

## 三、连接发起方向与未知能力降级规范（Connection Topology & Unknown Capability Degradation）

为了确保社区插件作者只看本规范（及导出的 `@ai0/protocol` JSON Schema）就能在任何网络拓扑下接入，协议明确将**“底层传输连接发起方向（Connection Initiation Direction）”**与**“应用层五原语消息流向（Message Flow Direction）”**解耦：

1. **双向对等连接发起拓扑（Inbound & Outbound Connection Initiation）**：
   * **拓扑 A：Shell 主动连入 Gateway（Inbound WebSocket — 默认模式）**
     Shell 作为 WebSocket Client 连接 `ws://gateway-host:port/protocol/v0/shell`。连接建立后，Shell 立即发送第一帧 `HandshakeManifest`，Gateway 校验 `auth_token` 后返回 `HandshakeAck`，会话正式建立。
   * **拓扑 B：Gateway 主动拨号连出至远端 Shell（Outbound WebSocket — 反向桥接/云端 Webhook 躯壳模式）**
     当 Shell 运行在公网/远端守护进程且不便向本地内网 Gateway 发起入站连接时，使用者在控制台登记远端 Shell 的 `endpoint_url` 与 `Scoped Capability Token`。由 `@ai0/gateway` 作为 WebSocket Client 主动拨号连接远端 Shell 并出示令牌挑战帧，远端 Shell 响应 `HandshakeManifest` 后，双工会话建立。
   * **消息流向恒等性**：无论底层连接是由哪一方发起建立的，一旦握手完成，**五原语的消息流向 100% 恒定**（`PerceptionEnvelope` 与 `DeliveryReceipt` 永远由 Shell 发往 Gateway；`ExpressionEnvelope` 永远由 Gateway 发往 Shell；`ControlSignal` 双向对等发送）。

2. **未知能力与未知扩展的优雅降级规则（Graceful Degradation Contract）**：
   * **Gateway 遇到未知的 `shell_kind` 或 `custom.*` 传感器模态**：网关绝不报错或断开连接，而是保留完整的 `UniversalObservationFrame` 与命名空间扩展。订阅该模态的认知器官可消费结构化帧，通用展示可读取帧内摘要。
   * **Shell 遇到不认识的 `ExpressionEnvelope.extensions` 键**：Shell 直接忽略不认识的扩展命名空间，仅渲染自己声明支持的扩展层及核心 `fallback_text`，并在 `DeliveryReceipt.degraded_extensions` 中如实上报被忽略的扩展名列表。

---

## 四、网关层安全验签与话轮流控状态机（`@ai0/gateway`）

### 4.1 `Scoped Capability Token` 防伪造验签机制

为了防止恶意或存在漏洞的第三方 Shell 插件伪造主人身份或谎报私密场合，`@ai0/gateway` 在握手时强制校验由控制台签发的 HMAC-SHA256 / Ed25519 令牌载荷：
```json
{
  "token_id": "tok_01J9Z...",
  "allowed_shell_id_prefix": "community.bilibili.live",
  "enforced_venue_type": "public_livestream",
  "max_audience_privacy_ceiling": "public_all",
  "can_authenticate_owner_principal": false,
  "allowed_actuators": []
}
```
* **网关强制降级铁律**：若上述直播间令牌连接的插件企图在 `HandshakeManifest` 中声称 `venue_type: "private_1on1"` 或将某条弹幕标为主人私密指令，网关层直接按令牌的 `max_audience_privacy_ceiling` **强制覆写为 `public_all`**，从物理入口封死插件伪造特权通道的可能。

### 4.2 输入防抖与双边界打断

`PendingTurnBatch` 在 1200 ms 防抖窗口聚合有序观测帧。活动或连续短句重置计时，`interim` 保留为草稿，`retract` 撤回相应草稿，到期后将已提交帧交给 `W1`。插话时，`barge_in_cancel` 停止旧生成并立即请求端侧停止播放。

`DeliveryReceipt.interruption_boundary` 区分两项确认。`silenced` 确认播放已立即停止并锁存游标，允许新话轮继续。`done` 确认旧流及控制账务已收口，完成取消、清理和回执结算。`GroundingReceiptTracker` 按意图、分段和边界幂等对账，迟到或重复回执不得改变已确认的播放截点。

```mermaid
stateDiagram-v2
    state "Idle (静默等待)" as Idle
    state "Debouncing (结构化帧聚合)" as Debouncing
    state "Streaming (表达播放中)" as Streaming
    state "Stopping (等待播放停止)" as Stopping
    state "Settling (旧流账务结算)" as Settling

    Idle --> Debouncing: 输入活动或提交帧
    Debouncing --> Streaming: 防抖到期并提交帧
    Debouncing --> Idle: 无已提交帧
    Streaming --> Idle: 正常完成
    Streaming --> Stopping: 插话触发取消
    Stopping --> Settling: silenced 确认并锁存游标
    Settling --> [*]: done 完成旧流结算
```

### 4.3 四态真值链与未说出文本恢复

`GroundingReceiptTracker` 按证据推进 `generated_unpresented -> physically_presented -> actuation_verified -> interlocutor_grounded`。生成仅记录候选内容。实际显示或播放的 `DeliveryReceipt` 确认 `physically_presented` 及其范围。`actuation_verified` 需要对应执行结果和验证证据，无需执行器时该阶段不适用。`interlocutor_grounded` 需要可关联的后续用户采纳或确认事件。发送、播放或执行成功均不能充当用户采纳证据。

`silenced` 锁存当前分段实际播放的 `played_audio_ms`。对该段单调的 `char_offset_timestamps_ms` 执行二分上界查询，`spoken_char_offset` 等于起音时间小于或等于游标的 Unicode 码点数，零播放为 0。Shell 可上报该偏移，或由网关换算。跟踪器将确认的前缀记为已呈现，将当前分段从偏移开始的后缀和后续未播放分段存入 `D1_WORKING_TURN.unsaid_remainder`。缺少可靠游标时仅确认已有呈现证据的前缀，`done` 不扩大该范围。

### 4.4 部署至上线状态机与探针

`GET /healthz` 表示进程存活，进程可服务探针时返回 `200 OK`。`GET /readyz` 仅在 `L5_LIVE_READY` 返回 `200 OK`，其他阶段返回 `503 Service Unavailable`。JSON 响应包含 `stage` 与 `missing_prerequisites` 字符串数组。

| 阶段 | 进入下一阶段所需条件 |
| :--- | :--- |
| `L0_UNCLAIMED` | 认领宿主 |
| `L1_CLAIMED_NO_PROVIDER` | 配置并验证可用 Provider |
| `L2_PROVIDER_READY_NO_SOUL` | 唤醒角色 |
| `L3_SOUL_AWAKENED_CONFIG_NEEDED` | 完成角色运行配置 |
| `L4_SOUL_AWAKENED_NO_SHELL` | 至少一个合规 Shell 在线且通过握手验签 |
| `L5_LIVE_READY` | 全部前置条件满足，`missing_prerequisites` 为空 |

阶段由最早未满足条件决定，条件失效时重新计算。`@ai0/gateway` 每次接纳 Channel A 陪伴话轮时执行同一就绪门控，`L5_LIVE_READY` 之前拒绝话轮，并返回阶段与缺项。配置与握手控制流可继续完成上线条件。
