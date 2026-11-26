import { describe, expect, it, vi } from "vitest";
import { ModelRequestJournal, requestFingerprint, traceStructuredRequest } from "./model-request-trace.js";

describe("serialized model request provenance", () => {
  it("records retries in order, separates request fields from transport secrets, and expires body diagnostics", async () => {
    vi.useFakeTimers();
    try {
      const journal = new ModelRequestJournal({ captureBodies: true, ttlMs: 100 });
      const lease = journal.lease();
      const payload = { model: "test", messages: [{ role: "user", content: "line 1" }], apiKey: "secret" };
      const post = traceStructuredRequest(lease, "http-test", "test", { system: "", observation: "line 1",
        trace: { stepId: "step", fragments: [{ id: "source", field: "observation", authority: "data", version: "1", text: "line 1" }] }
      }, async () => new Response(null, {status: 204}))!;
      for (const space of [0, 2]) await post("http://localhost", { method: "POST", headers: { authorization: "secret" },
        body: JSON.stringify(payload, null, space) });
      const attempts = journal.read("step")!.attempts;
      expect(attempts.map(item => item.number)).toEqual([1, 2]);
      expect(attempts[0]!.serializedFingerprint).toEqual(requestFingerprint(JSON.stringify(payload)));
      expect(attempts[1]!.serializedFingerprint).not.toEqual(attempts[0]!.serializedFingerprint);
      expect(attempts[0]!.fields.find(field => field.pointer === "/messages/0/content")?.sourceIds).toContain("source");
      expect(attempts[0]!.modelFields?.messages).toEqual(payload.messages);
      expect(JSON.stringify(attempts)).not.toContain("secret");
      vi.advanceTimersByTime(101);
      expect(journal.read("step")).toBeUndefined();
      journal.clear();
      traceStructuredRequest(lease, "http-test", "test", { system: "", observation: "", trace: { stepId: "late" } });
      expect(journal.has("late")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
