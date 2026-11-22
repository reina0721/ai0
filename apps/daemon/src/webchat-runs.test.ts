import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { createDefaultDaemonRuntime, createUnifiedDaemonHttpServer } from "./index.js";

it("streams a persisted WebChat turn and scopes replay, delivery receipts, and history to the owner and target", async () => {
  const root = mkdtempSync(join(tmpdir(), "ai0-webchat-"));
  const ownerToken = "webchat-test-owner";
  const runtime = createDefaultDaemonRuntime({
    soulDir: join(root, "test.soul"),
    ownerMasterToken: ownerToken,
    seedIfEmpty: true
  });
  const server = createUnifiedDaemonHttpServer(runtime);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/studio/webchat`;
  const headers = { "x-ai0-owner-token": ownerToken, "content-type": "application/json" };
  const requestId = "6f3d4cde-0773-48a0-884d-ea2b547e99b4";
  const eventId = `evt_webchat_${requestId}`;
  const text = "深夜写代码有些累。请提醒我喝杯水，并告诉我你还记得我常喝什么。";
  const post = (path: string, body: object) => fetch(url + path, {
    method: "POST", headers, body: JSON.stringify(body)
  });

  try {
    expect((await fetch(url + "/history")).status).toBe(401);
    expect((await post("/runs", { requestId, mode: "wrong", text })).status).toBe(400);
    const response = await post("/runs", { requestId, mode: "live", text });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const raw = await response.text();
    const events = raw.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)));
    const stages = events.filter((frame) => frame.type === "data-turn-stage").map((frame) => frame.data.stage);
    expect(stages).toEqual(["accepted", "gate", "recall", "blackboard", "generating", "committed", "delivering"]);
    const deltas = events.filter((frame) => frame.type === "text-delta");
    expect(deltas.length).toBeGreaterThan(1);
    const generated = deltas.map((frame) => frame.delta).join("");
    expect(generated.length).toBeGreaterThan(18);
    expect(raw).not.toContain("theatrical_subtext");
    expect(raw).not.toContain("compiled_prompt_text");
    expect(raw).toContain("data: [DONE]");

    const trace = runtime.storage.getDecisionTraceByEvent(eventId);
    expect(trace?.steps.step7_emitted_intent.fallback_text).toBe(generated);
    expect(trace?.steps.step8_delivery_receipt).toBeNull();
    expect((await fetch(url + `/runs/${requestId}?mode=sandbox`, { headers })).status).toBe(404);
    const status = await fetch(url + `/runs/${requestId}?mode=live`, { headers });
    expect(await status.json()).toMatchObject({ requestId, status: "delivering", deliveryFinished: true, text: generated });
    expect((await fetch(url + `/runs/${requestId}/trace?mode=live`)).status).toBe(401);
    const traceResponse = await fetch(url + `/runs/${requestId}/trace?mode=live`, { headers });
    expect(await traceResponse.json()).toMatchObject({ trace: { trace_id: trace?.trace_id } });

    expect((await post(`/runs/${requestId}/receipt`, { mode: "live", spokenCharOffset: 0 })).status).toBe(400);
    const receipt = await post(`/runs/${requestId}/receipt`, { mode: "live", spokenCharOffset: Array.from(generated).length });
    expect(await receipt.json()).toMatchObject({ status: "completed", receipt: { status: "completed" } });
    const eventCount = runtime.storage.listEvents().length;
    const traceCount = runtime.storage.listDecisionTraces().length;
    const replay = await post("/runs", { requestId, mode: "live", text });
    expect(await replay.text()).toContain(`"traceId":"${trace?.trace_id}"`);
    expect(runtime.storage.listEvents()).toHaveLength(eventCount);
    expect(runtime.storage.listDecisionTraces()).toHaveLength(traceCount);
    expect((await post("/runs", { requestId, mode: "live", text: "不同内容" })).status).toBe(409);

    const sandbox = await post("/runs", { requestId, mode: "sandbox", text });
    expect(sandbox.status).toBe(200);
    await sandbox.text();
    const stop = await post(`/runs/${requestId}/stop`, { mode: "sandbox", spokenCharOffset: 0 });
    expect(await stop.json()).toMatchObject({
      status: "interrupted", text: "", receipt: { status: "interrupted", spokenCharOffset: 0 }
    });
    const repeated = await post(`/runs/${requestId}/stop`, { mode: "sandbox", spokenCharOffset: 2 });
    expect(await repeated.json()).toMatchObject({ receipt: { spokenCharOffset: 0 } });
    const history = await fetch(url + "/history?mode=sandbox", { headers });
    expect(await history.json()).toMatchObject({
      turns: expect.arrayContaining([expect.objectContaining({
        requestId, assistantText: "", targetInstance: "sandbox:console"
      })])
    });
    await post("/clear", { mode: "live" });
    expect(runtime.storage.listDecisionTraces()).toHaveLength(traceCount);

    const publicTurn = await runtime.handleWebChatTurn({
      text: "直播间公开演示，和观众打个招呼。",
      audience_scope: "public_all",
      venue_type: "public_livestream"
    });
    const privateHistory = await fetch(url + "/history?mode=live", { headers });
    expect((await privateHistory.json()).turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventId: publicTurn.event_id })
    ]));

    const streamingId = "25adfcc0-0445-4f53-9001-e578fe9beec4";
    const originalGeneration = runtime.workers.w1.runTurnAsync.bind(runtime.workers.w1);
    const longReply = "风停了，我们继续。".repeat(250);
    const longGeneration = vi.spyOn(runtime.workers.w1, "runTurnAsync").mockImplementationOnce(async (...args) => {
      const turn = await originalGeneration(...args);
      turn.expression.fallback_text = longReply;
      turn.trace.steps.step7_emitted_intent.fallback_text = longReply;
      return turn;
    });
    const delivering = await post("/runs", { requestId: streamingId, mode: "live", text });
    const deliveryReader = delivering.body!.getReader();
    const decoder = new TextDecoder();
    let delivered = "";
    while (!delivered.includes('"type":"text-delta"')) {
      const part = await deliveryReader.read();
      if (part.done) break;
      delivered += decoder.decode(part.value, { stream: true });
    }
    expect(delivered).toContain('"type":"text-delta"');
    const activeHistory = await fetch(url + "/history?mode=live", { headers });
    expect((await activeHistory.json()).turns).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: streamingId })
    ]));
    const activeTrace = await fetch(url + `/runs/${streamingId}/trace?mode=live`, { headers });
    expect(activeTrace.status).toBe(409);
    await deliveryReader.cancel();
    await vi.waitFor(async () => {
      const archivedHistory = await fetch(url + "/history?mode=live", { headers });
      expect((await archivedHistory.json()).turns).toEqual(expect.arrayContaining([
        expect.objectContaining({ requestId: streamingId, assistantText: longReply })
      ]));
    });
    longGeneration.mockRestore();

    const pendingId = "91d7b2bf-783a-4c56-b2c3-8ff6a3a1553d";
    const generation = vi.spyOn(runtime.workers.w1, "runTurnAsync").mockImplementation(
      async (_input, options) => {
        options?.onStage?.("generating");
        return new Promise((_, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      }
    );
    const pending = await post("/runs", { requestId: pendingId, mode: "live", text });
    const pendingBody = pending.text();
    expect((await post("/runs", { requestId: pendingId, mode: "live", text })).status).toBe(409);
    const cancel = await post(`/runs/${pendingId}/stop`, { mode: "live", spokenCharOffset: 0 });
    expect(await cancel.json()).toMatchObject({ status: "cancelled" });
    const cancelledStream = await pendingBody;
    expect(cancelledStream).toContain('"status":"cancelled"');
    expect(cancelledStream).not.toContain('"type":"text-delta"');
    const cancelled = await fetch(url + `/runs/${pendingId}?mode=live`, { headers });
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });
    expect(runtime.storage.getDecisionTraceByEvent(`evt_webchat_${pendingId}`)).toBeUndefined();

    const disconnectedId = "7d5a2e97-0337-4feb-9687-2eb50aa40d21";
    const disconnected = await post("/runs", { requestId: disconnectedId, mode: "live", text });
    await disconnected.body?.cancel();
    await vi.waitFor(async () => {
      const state = await fetch(url + `/runs/${disconnectedId}?mode=live`, { headers });
      expect(await state.json()).toMatchObject({ status: "cancelled" });
    });
    generation.mockRestore();
  } finally {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closed;
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);
