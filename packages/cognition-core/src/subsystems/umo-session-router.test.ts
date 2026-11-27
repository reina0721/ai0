import { describe, expect, it } from "vitest";
import { SoulProfileAndCapabilitiesConfigSchema } from "@ai0/protocol";
import { matchesUmoPattern, resolveSessionProfile } from "./umo-session-router.js";

const SAMPLE_CONFIG = SoulProfileAndCapabilitiesConfigSchema.parse({
  defaultProfileId: "prof_private",
  profiles: [
    {
      id: "prof_private",
      name: "私密默认",
      primaryChat: { providerId: "prov_deepseek", modelId: "deepseek-flash" },
      socialMaskEnabled: false,
      socialMaskDampingPct: 0,
      maxContextTokens: 2200
    },
    {
      id: "prof_work",
      name: "代码协作",
      primaryChat: { providerId: "prov_claude", modelId: "claude-3-7-sonnet-latest" },
      socialMaskEnabled: true,
      socialMaskDampingPct: 50,
      maxContextTokens: 3400
    },
    {
      id: "prof_public",
      name: "公开隔离",
      primaryChat: { providerId: "prov_ollama", modelId: "qwen2.5:7b-instruct" },
      socialMaskEnabled: true,
      socialMaskDampingPct: 70,
      maxContextTokens: 1600
    }
  ],
  routingRules: [
    {
      id: "rule_pub",
      priority: 10,
      label: "直播间公开路由",
      umoPattern: "*:public_livestream:*",
      audienceScope: "public_all",
      profileId: "prof_public",
      enabled: true
    },
    {
      id: "rule_work",
      priority: 20,
      label: "群聊协作路由",
      umoPattern: "builtin.webchat:group_chat:*",
      audienceScope: "only_owner",
      profileId: "prof_work",
      enabled: true
    },
    {
      id: "rule_overprivileged",
      priority: 5,
      label: "错误提权测试规则",
      umoPattern: "discord.bot:*:guest_*",
      audienceScope: "only_owner",
      profileId: "prof_private",
      enabled: true
    }
  ]
});

describe("UMO session router", () => {
  it("matches UMO patterns with wildcards and :: shorthand", () => {
    expect(matchesUmoPattern("*:*:*", "builtin.webchat:private_1on1:owner:local")).toBe(true);
    expect(matchesUmoPattern("::", "qq:group_chat:123456")).toBe(true);
    expect(matchesUmoPattern("*:public_livestream:*", "obs.live:public_livestream:room_1")).toBe(true);
    expect(matchesUmoPattern("builtin.webchat:group_chat:*", "builtin.webchat:private_1on1:owner")).toBe(false);
  });

  it("resolves matching profiles and falls back to default profile when unmatched", () => {
    const work = resolveSessionProfile({
      channelId: "builtin.webchat",
      venueType: "group_chat",
      sessionKey: "owner:local",
      maxAudienceCeiling: "only_owner",
      config: SAMPLE_CONFIG
    });
    expect(work.route.matchedRuleId).toBe("rule_work");
    expect(work.route.profileId).toBe("prof_work");
    expect(work.route.primaryChat.modelId).toBe("claude-3-7-sonnet-latest");

    const fallback = resolveSessionProfile({
      channelId: "builtin.webchat",
      venueType: "private_1on1",
      sessionKey: "owner:local",
      maxAudienceCeiling: "only_owner",
      config: SAMPLE_CONFIG
    });
    expect(fallback.route.matchedRuleId).toBeNull();
    expect(fallback.route.profileId).toBe("prof_private");
    expect(fallback.route.socialMaskActive).toBe(false);
  });

  it("enforces fail-closed audience ceiling downgrade even when a rule requests only_owner", () => {
    const clamped = resolveSessionProfile({
      channelId: "discord.bot",
      venueType: "group_chat",
      sessionKey: "guest_42",
      maxAudienceCeiling: "public_all",
      config: SAMPLE_CONFIG
    });
    expect(clamped.route.matchedRuleId).toBe("rule_overprivileged");
    expect(clamped.route.effectiveAudienceScope).toBe("public_all");
    expect(clamped.route.audienceDowngradedByCeiling).toBe(true);
    expect(clamped.route.socialMaskActive).toBe(true);
    expect(clamped.route.socialMaskDampingPct).toBe(70);
  });
});
