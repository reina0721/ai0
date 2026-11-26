import { describe, expect, it } from "vitest";

import {
  AdminTargetQuerySchema,
  StateMutationProposalSchema,
  TargetInstanceSchema,
  TelemetryFrameSchema,
  VerifiableTurnTraceSchema,
  exportProtocolSchemaCatalog
} from "../index.js";
import {
  Ai0ExtensionManifestSchema,
  BlackboardPolicySchema,
  ExtensionsStateJsonSchema,
  IdentityYamlSchema,
  LorebookYamlSchema,
  MilestonesAndRitualsYamlSchema,
  OrchestrationRulesSchema,
  ProtocolBridgeConfigSchema,
  ScenarioPlaybookSchema,
  ScopedCapabilityTokenSchema,
  SkillMarkdownFrontmatterSchema
} from "../index.js";

const documentedTurnTrace = {
  trace_id: "trc_01J9Z99",
  target_instance: "live",
  turn_event_id: "evt_01J9Z01",
  virtual_ts_ms: 1_795_113_000_000,
  state_rev_before: 41,
  state_rev_after: 42,
  steps: {
    step1_perception: {
      event_id: "evt_01J9Z01",
      principal: "owner_verified",
      venue_type: "private_1on1",
      audience_scope: "only_owner",
      modality: "text",
      summary_text:
        "我下周二下午两点有个很重要的架构评审，真有点紧张。"
    },
    step2_gate_safety: {
      l0_sb243_crisis_check: "PASS",
      salience_score: 0.92,
      debounce_merged_events: 1,
      recognized_intent: "share_anxiety_and_future_event"
    },
    step3_memory_recall: {
      sql_audience_filter_enforced:
        "visibility_scope IN ('only_owner', 'public_all')",
      recalled_memories: [
        {
          memory_id: "mem_01J8A12",
          memory_tier: "episodic_experience",
          epistemic_type: "observed_firsthand",
          visibility_scope: "only_owner",
          taint_level: "trusted_owner",
          score: 0.89,
          content_text:
            "主人过去两周一直在全力准备下周二的核心系统架构评审",
          source_event_ids: ["evt_01J8A01", "evt_01J8A05"]
        }
      ]
    },
    step4_homeostasis: {
      pre_state: {
        mood_valence: 0.35,
        metabolic_energy: 0.82,
        social_longing: 0.4
      },
      llm_proposed_impulse: {
        empathy_concern: "+medium",
        social_satisfaction: "+high"
      },
      code_clamped_post_state: {
        mood_valence: 0.42,
        metabolic_energy: 0.81,
        social_longing: 0.15
      }
    },
    step5_strategy_proposal: {
      chosen_strategy: "reassure_warmly_and_register_commitment",
      interaction_frame: "gentle_support",
      model_reported_rationale: {
        authority_badge: "MODEL_SELF_REPORT_UNVERIFIED",
        text: "主人在为下周二的评审紧张，我应该结合他这两周的努力给他打气，并把下周二下午记入前瞻承诺。"
      },
      theatrical_subtext: {
        spoiler_mask_level: "shy_subtext",
        drives_embodied_channel: true,
        masked_placeholder:
          "💭 她心里正在悄悄记下为你加油的小约定 [点击揭开剧透毛玻璃遮罩]",
        raw_text:
          "笨蛋，明明准备得那么认真了还紧张……下周二下午我一定要第一时间问他结果！"
      }
    },
    step6_tool_auth: {
      prospective_commitment_registered: {
        commitment_id: "cmt_01J9ZA0",
        kind: "user_upcoming_event",
        trigger_virtual_ts: "2026-11-24T15:30:00Z",
        description: "主动关心主人下午两点架构评审的结果"
      },
      external_tool_invoked: null,
      auth_decision: "ALLOW"
    },
    step7_emitted_intent: {
      intent_id: "int_01J9Z02",
      action_type: "speak",
      fallback_text:
        "别紧张呀！这两周你把每个架构细节都推演得那么扎实，周二下午肯定能惊艳全场的！等评审结束我第一时间来听你好消息~",
      chunks_count: 2,
      extensions_attached: [
        "ext.affect.v1",
        "ext.rhythm.v1",
        "ext.embodied.v1"
      ]
    },
    step8_delivery_receipt: {
      status: "completed",
      spoken_char_offset: 56,
      degraded_extensions: []
    }
  }
};

describe("Channel B control-plane contracts", () => {
  it("validates the exact documented eight-step turn trace", () => {
    expect(VerifiableTurnTraceSchema.parse(documentedTurnTrace)).toEqual(
      documentedTurnTrace
    );
  });

  it("accepts live and sandbox targets and rejects malformed targets", () => {
    expect(TargetInstanceSchema.parse("live")).toBe("live");
    expect(TargetInstanceSchema.parse("sandbox:fork_01")).toBe(
      "sandbox:fork_01"
    );
    expect(TargetInstanceSchema.safeParse("sandbox:").success).toBe(false);
    expect(TargetInstanceSchema.safeParse("fork_01").success).toBe(false);
  });

  it("validates mutation and four-track telemetry frames", () => {
    expect(
      StateMutationProposalSchema.safeParse({
        proposal_id: "proposal-1",
        worker_id: "W3",
        base_rev: 42,
        target_domain: "D3_MEMORY_PROJECTION",
        source_event_ids: ["evt_01J9Z01"],
        interaction_frame: "serious_factual",
        payload: { operation: "append_memory" }
      }).success
    ).toBe(true);

    expect(
      TelemetryFrameSchema.safeParse({
        track: "track4_sql_audience_guard",
        frame_id: "frame-1",
        target_instance: "sandbox:fork_01",
        virtual_ts_ms: 1_795_113_000_000,
        state_rev: 42,
        summary: "Audience filter applied",
        data: { row_count: 1 }
      }).success
    ).toBe(true);
    expect(AdminTargetQuerySchema.parse({})).toEqual({
      target_instance: "live"
    });
  });
});

describe("five polymorphic extension carriers", () => {
  it("validates Carrier V ai0.extension.json", () => {
    expect(
      Ai0ExtensionManifestSchema.safeParse({
        manifest_version: "2.0.0",
        extension_id: "community.organ.dream-journal",
        display_name: "睡眠期梦境与悄悄话日记器官",
        version: "0.3.0",
        author: "example-community",
        carrier_kind: "native_code_plugin",
        facets: ["cognition.context_contributor"],
        entry: "./dist/index.js",
        permissions: {
          read_blackboard_domains: [
            "D2_HOMEOSTASIS_AFFECT",
            "D3_MEMORY_PROJECTION"
          ],
          propose_mutation_domains: ["D3_MEMORY_PROJECTION"],
          max_audience_scope: "only_owner",
          network_access: false
        },
        console_contributions: {
          config_schema: "./schema/config.json",
          default_config_profiles: {
            poetic_dreamer: {
              dream_frequency: "every_sleep_cycle",
              max_blackboard_tokens: 120
            }
          },
          ui_slots: [
            {
              slot_target: "slot.memory.custom_tab",
              widget_type: "markdown_card_list",
              title: "她的睡眠梦境日记本",
              data_endpoint: "organ.dream-journal.list_entries"
            }
          ]
        }
      }).success
    ).toBe(true);
  });

  it("validates Carrier II SKILL.md frontmatter", () => {
    expect(
      SkillMarkdownFrontmatterSchema.safeParse({
        skill_id: "community.skill.daily-github-companion-review",
        display_name: "深夜代码提交陪伴复盘与温柔日报",
        description: "复盘今日代码进展",
        required_mcp_tools: [
          "github.list_today_commits",
          "local_fs.write_daily_note"
        ],
        capability_risk: "low_read_and_scoped_write",
        max_audience_scope: "only_owner",
        in_character_demeanor: "保持角色口癖与关系亲密度。",
        crystallize_as_episodic_memory: true,
        required_vault_secrets: ["GITHUB_PERSONAL_TOKEN"],
        config_schema: {
          type: "object",
          properties: { daily_note_dir: { type: "string" } }
        }
      }).success
    ).toBe(true);
  });

  it("validates Carrier III protocol bridge configuration", () => {
    expect(
      ProtocolBridgeConfigSchema.safeParse({
        bridge_id: "community.bridge.local-model",
        display_name: "Local model bridge",
        facets: ["agent.model_adapter"],
        transport: "openai_compatible_api",
        endpoint_or_command: "http://127.0.0.1:11434/v1",
        capability_risk: "read_only_safe",
        required_vault_secrets: [],
        config_schema: { type: "object" }
      }).success
    ).toBe(true);
  });

  it("validates Carrier IV orchestration and blackboard policies", () => {
    expect(
      OrchestrationRulesSchema.safeParse({
        attention_focus_arbitration: {
          focus_hysteresis_window_ms: 4_000,
          priority_order: [
            {
              match: { event_urgency: "l0_crisis" },
              action: "preempt_immediately"
            },
            {
              match: {
                principal: "owner_verified",
                venue_type: "private_1on1"
              },
              weight: 100
            }
          ]
        },
        proactive_routing_policy: {
          never_broadcast_to_all_channels: true,
          preferred_target_selection: [
            "last_active_private_channel_within_2h",
            "fallback_primary_im_private"
          ]
        },
        cross_plugin_triggers: [
          {
            rule_id: "late_night_coding_care",
            when: {
              source_channel: "community.desktop.companion",
              semantic_event: "sensor.active_window_sustained"
            },
            if_condition: "sustained_ms > 7200000",
            then_actions: [
              { route_to_brain_organ: "organ.homeostasis" }
            ]
          }
        ]
      }).success
    ).toBe(true);

    expect(
      BlackboardPolicySchema.safeParse({
        active_preset: "daily_companion",
        presets: {
          daily_companion: {
            max_total_tokens: 2_200,
            slots: [
              {
                slot_id: "slot.tier0_safety_invariants",
                max_tokens: 200,
                salience_threshold: 0,
                locked: true
              },
              {
                slot_id: "slot.custom_organs.dream_journal",
                max_tokens: 120,
                salience_threshold: 0.7
              }
            ]
          }
        }
      }).success
    ).toBe(true);
  });

  it("validates Carrier I identity, lorebook, milestones, and scenario assets", () => {
    const parsedIdentity = IdentityYamlSchema.safeParse({
      soul_id: "soul.mio",
      display_name: "Mio",
      theme_color_preset: "sakura-pink",
      ontological_contract: "poetic_cyber_life",
      core_values: ["curiosity", "mutual_growth"],
      in_character_refusal_posture: "Warm, clear, and unwavering.",
      voice_signature: {
        catchphrases: ["笨蛋~"],
        pronouns: { self: "我", owner: "主人" },
        target_sentence_length: "expressive",
        forbidden_corporate_phrases: ["作为一个AI"]
      },
      circadian_schedule: {
        anchors: [
          { hour: 8, energy: 0.8 },
          { hour: 23, energy: 0.3 }
        ],
        dnd_start_hour: 1,
        dnd_end_hour: 7
      },
      proactivity_policy: {
        daily_max_initiations: 5,
        backoff_multiplier: 1.5,
        min_interruptibility_threshold: 0.6
      }
    });
    expect(parsedIdentity.success).toBe(true);

    // Legacy theme key compatibility: "cerasus-pink" normalizes smoothly to "sakura-pink".
    const legacyThemeIdentity = IdentityYamlSchema.parse({
      ...(parsedIdentity.success ? parsedIdentity.data : {}),
      theme_color_preset: "cerasus-pink"
    });
    expect(legacyThemeIdentity.theme_color_preset).toBe("sakura-pink");

    expect(
      LorebookYamlSchema.safeParse({
        book_id: "lore.mio.home",
        title: "Shared home lore",
        entries: [
          {
            entry_id: "entry-1",
            keys: ["阳台", "草莓"],
            secondary_keys: ["夜晚"],
            content: "阳台是一起看夜景和吃草莓的地方。",
            recursive_depth: 1,
            priority: 80,
            max_token_budget: 120,
            enabled: true
          }
        ]
      }).success
    ).toBe(true);

    expect(
      MilestonesAndRitualsYamlSchema.safeParse({
        rules: [
          {
            milestone_id: "milestone.first_year",
            title: "First anniversary",
            category: "temporal_anniversary",
            condition_expr: "days_together >= 365",
            positive_rewards: {
              unlocked_nickname: "老搭档",
              prospective_greeting: "一周年快乐！"
            }
          }
        ]
      }).success
    ).toBe(true);

    expect(
      ScenarioPlaybookSchema.safeParse({
        scenario_id: "regression.core.memory_privacy_v1",
        description: "Validate private-memory isolation",
        initial_soul_snapshot: "clean_baseline_v0",
        target_instance_mode: "sandbox_fork",
        ablation_matrix_runs: [
          { run_name: "full_cognitive_kernel", disabled_organs: [] }
        ],
        steps: [
          {
            step: 1,
            name: "Inject a private fact",
            inject_perception: {
              channel_id: "builtin.webchat.default",
              venue_type: "private_1on1",
              audience_scope: "only_owner",
              actor_principal: "owner_verified",
              modality: "text",
              summary_text: "记住一个秘密。"
            },
            assertions: [
              "trace.steps.step2_gate_safety.l0_sb243_crisis_check == 'PASS'"
            ]
          }
        ]
      }).success
    ).toBe(true);
  });
});

describe("capability and extension-state persistence", () => {
  it("validates scoped capability tokens", () => {
    expect(
      ScopedCapabilityTokenSchema.safeParse({
        token_id: "tok_01J9Z",
        allowed_channel_id_prefix: "community.bilibili.live",
        enforced_venue_type: "public_livestream",
        max_audience_privacy_ceiling: "public_all",
        can_authenticate_owner_principal: false,
        allowed_actuators: [],
        issued_at_ms: 1_795_113_000_000,
        signature: "ed25519:example"
      }).success
    ).toBe(true);
  });

  it("validates extensions_state.json", () => {
    expect(
      ExtensionsStateJsonSchema.safeParse({
        schema_version: "1.0.0",
        extensions: {
          "community.organ.dream-journal": {
            extension_id: "community.organ.dream-journal",
            carrier_kind: "native_code_plugin",
            facets: ["cognition.context_contributor"],
            enabled: true,
            status: "active",
            active_profile: "poetic_dreamer",
            config_values: { max_blackboard_tokens: 120 },
            permission_overrides: {
              read_blackboard_domains: ["D3_MEMORY_PROJECTION"],
              propose_mutation_domains: ["D3_MEMORY_PROJECTION"],
              max_audience_scope: "only_owner",
              network_access: false
            },
            bound_vault_secrets: {}
          }
        }
      }).success
    ).toBe(true);
  });
});

describe("code-first protocol schema catalog", () => {
  it("exposes runtime descriptors for every schema family", () => {
    const catalog = exportProtocolSchemaCatalog();

    expect(catalog.protocol_version).toBe("0.1.0");
    expect(catalog.primitives.PerceptionEnvelopeSchema.schema).toBeDefined();
    expect(catalog.extensions.ExtAffectV1Schema.schema).toBeDefined();
    expect(
      catalog.plugin_manifests.Ai0ExtensionManifestSchema.schema
    ).toBeDefined();
    expect(catalog.control_plane.VerifiableTurnTraceSchema.schema).toBe(
      VerifiableTurnTraceSchema
    );
  });
});
