import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import { DeliveryReceiptSchema } from "@ai0/protocol";
import type { Ai0DaemonRuntime } from "./index.js";

export function registerChannelActions(app: Hono, runtime: Ai0DaemonRuntime, isOwner: (c: Context) => boolean) {
  app.post("/api/studio/channel-actions", async c => {
    if (!isOwner(c)) return c.json({ error: "UNAUTHORIZED" }, 401);
    const body = await c.req.json();
    const mode = body.mode === "sandbox" ? "sandbox" : "live";
    const session = runtime.channelGateway.listConnections(mode).find(item => item.session_id === body.sessionId);
    const actuator = session?.capabilities.actuators.find(item => item.actuator_id === body.actuatorId);
    if (!actuator || !session) return c.json({ error: "ACTUATOR_UNAVAILABLE" }, 409);
    const store = mode === "live" ? runtime.storage : runtime.sandboxStorage;
    const id = randomUUID();
    store.sqlite.prepare("INSERT INTO channel_action_intents VALUES (?,?,?,?,?,NULL)").run(
      id, session.session_id, actuator.actuator_id, Number(actuator.requires_local_user_consent), JSON.stringify(body.arguments ?? {}));
    return c.json({ intent_id: id, status: "pending" }, 201);
  });

  const base = "/protocol/v0/channel/connections/:id/actions";
  app.on(["GET", "POST"], base, async c => {
    const sessionId = c.req.param("id")!;
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer /i, "");
    const session = runtime.channelGateway.connectionForGrant(sessionId, token);
    if (!session) return c.json({ error: "SESSION_UNAVAILABLE" }, 403);
    const live = session.target === "live";
    const storage = live ? runtime.storage : runtime.sandboxStorage;
    if (c.req.method === "GET") {
      const pending = storage.sqlite.prepare("SELECT * FROM channel_action_intents WHERE session_id=? AND evidence_id IS NULL ORDER BY rowid").all(sessionId);
      return c.json({ actions: pending.filter(row => session.actuators.some(action => action.actuator_id === row.actuator_id))
        .map(row => ({ intent_id: row.intent_id, chunk_seq: 0, actuator_id: row.actuator_id,
          arguments: JSON.parse(String(row.arguments_json)), requires_local_user_consent: Boolean(row.requires_consent) })) });
    }
    const parsed = DeliveryReceiptSchema.safeParse(await c.req.json());
    if (!parsed.success || !parsed.data.actuator_outcome || parsed.data.chunk_seq !== 0 ||
        !["failed", "completed"].includes(parsed.data.status)) return c.json({ error: "INVALID_ACTION_RECEIPT" }, 400);
    const receipt = parsed.data;
    const row = storage.sqlite.prepare("SELECT * FROM channel_action_intents WHERE session_id=? AND intent_id=?").get(sessionId, receipt.intent_id);
    if (!row) return c.json({ error: "UNKNOWN_ACTION" }, 404);
    const evidenceId = "evt_action_" + receipt.intent_id;
    if (!row.evidence_id) storage.runInTransaction(() => {
      const snapshot = live ? runtime.coordinator.getSnapshot() : runtime.sandboxCoordinator.getSnapshot();
      storage.appendEvent({ event_id: evidenceId, wall_ts_ms: Date.now(),
        virtual_ts_ms: (live ? runtime.virtualClock : runtime.sandboxClock).nowMs(), source_channel_id: session.channel,
        principal_id: session.principal, principal_trust: "tool_output", venue_type: "local_ambient",
        audience_scope: session.audience, event_category: "action_episode_completed", modality: "text",
        summary_text: receipt.actuator_outcome!.result_summary,
        payload_json: JSON.stringify({ actuator_id: row.actuator_id, receipt }), state_rev_after: snapshot.state_rev,
        active_modules_mask: 31 });
      storage.sqlite.prepare("UPDATE channel_action_intents SET evidence_id=?, arguments_json=NULL WHERE intent_id=?").run(evidenceId, receipt.intent_id);
    });
    return c.json({ evidenceId });
  });
}
