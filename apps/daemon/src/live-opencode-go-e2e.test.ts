import { cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { VerifiableTurnTraceSchema, type ExpressionEnvelope, type VerifiableTurnTrace } from "@ai0/protocol";
import { readSoulArchiveConfig } from "@ai0/storage";
import { expect, it } from "vitest";
import { lifecycleFixture } from "./test-support/lifecycle.js";

it("awakens Nagi on a copy of the configured host and persists a real OpenCode Go turn", async ctx => {
  const { runtime, soulsRoot, request, readiness, connectChannel } = lifecycleFixture(ctx, root => {
    cpSync(resolve("souls/host"), join(root, "host"), { recursive: true });
  });
  await readiness("L0_UNCLAIMED");
  await request("/api/admin/v1/host/claim", "POST", {});
  expect((await readiness("L2_PROVIDER_READY_NO_SOUL")).checks).toMatchObject({
    defaultChatModel: "deepseek-v4.1-flash", providerReady: true, soulAwakened: false
  });

  const { cardId } = await request<{ cardId: string }>("/api/admin/v1/cards", "POST", {
    card: { spec: "chara_card_v3", spec_version: "3.0", data: {
      name: "Nagi", description: "你是 Nagi，一位安静的天文台管理员。",
      extensions: { "ai0.soul.v1": { module_overrides: { consciousness: { mode: "Inherit" } } } }
    } }
  }, 201);
  await request("/api/admin/v1/souls/awaken", "POST", { cardId }, 201);
  expect(runtime.soulDir).toBe(join(soulsRoot, "nagi.soul"));
  expect(readSoulArchiveConfig(runtime.soulDir).manifest.module_overrides?.consciousness?.mode).toBe("Inherit");
  expect((await readiness("L4_SOUL_AWAKENED_NO_CHANNEL")).checks.bindingValid).toBe(true);
  const { channelId } = await connectChannel();
  expect((await readiness("L5_LIVE_READY")).missing_prerequisites).toEqual([]);

  const text = "你好，请用一句话简短介绍你自己。";
  const turn = await request<{
    expression: ExpressionEnvelope; trace: VerifiableTurnTrace; provider: { name: string; model: string };
  }>("/protocol/v0/channel/perception", "POST", {
    text, channel_id: channelId, venue_type: "private_1on1", audience_scope: "only_owner"
  });
  expect(turn.provider).toMatchObject({ name: "opencode_go", model: expect.stringContaining("deepseek") });
  expect(turn.expression.fallback_text.trim().length).toBeGreaterThan(0);
  const trace = VerifiableTurnTraceSchema.parse(runtime.storage.getDecisionTraceByEvent(turn.trace.turn_event_id));
  expect(trace).toEqual(turn.trace);
  expect(trace.steps.step1_perception.summary_text).toBe(text);
  expect(trace.steps.step7_emitted_intent.fallback_text).toBe(turn.expression.fallback_text);
}, 60_000);
