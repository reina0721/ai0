import { expect, it, vi } from "vitest";
import { ExtensionCoreHost, type FacetPoint } from "@ai0/extension-core";
import type { AgentToolDefinition, PreparedAgentRequest } from "@ai0/protocol";
import {
  AgentCoreRuntime, agentContextContributorFacet, agentModelAdapterFacet,
  agentToolDefinitionFacet, runAgentTurn, singleStepDriver
} from "./index.js";

function mount<T>(host: ExtensionCoreHost, id: string, point: FacetPoint<T>, value: T) {
  const mounted = host.mountPackage({
    manifest: {
      manifest_version: "2.0.0", extension_id: id, display_name: id, version: "1", author: "test",
      carrier_kind: "native_code_plugin", facets: [point.id], permissions: {
        read_blackboard_domains: [], propose_mutation_domains: [], max_audience_scope: "public_all", network_access: false
      }
    },
    activate(scope) { scope.contributeFacet(point, value); }
  });
  expect(mounted.status).toBe("active");
}
const signal = new AbortController().signal;
const inputs = [{ role: "user" as const, content: "What is the length?" }];
const stringValue = {
  jsonSchema: { type: "string" },
  parse(input: unknown) {
    if (typeof input !== "string") throw new Error("Expected string");
    return input;
  }
};
function tool(): AgentToolDefinition {
  return {
    name: "measure", description: "Measure text", inputSchema: stringValue, resultSchema: stringValue,
    execute: () => ({ status: "verified", value: "private payload" }), project: value => String(value).length
  };
}
it("runs a single-step agent with only a registered model and user message, then replaces the model", async () => {
  const host = new ExtensionCoreHost();
  for (const id of ["test.model.a", "test.model.b"]) {
    mount(host, id, agentModelAdapterFacet, { async *model(request) {
      expect(request.messages).toEqual(inputs);
      expect(request.tools).toEqual([]);
      expect(request.output).toBeUndefined();
      yield { kind: "delta", text: id };
      yield { kind: "finish" };
    } });
    const report = await runAgentTurn({ inputs, signal, driver: singleStepDriver, bindings: { host, modelPackageId: id } });
    expect(report.rounds[0]?.text).toBe(id);
    expect(report.steps[0]?.model).toMatchObject({ id });
  }
});
it("binds tools and context anew at each step and exposes only the projected receipt to the model", async () => {
  const host = new ExtensionCoreHost();
  const requests: PreparedAgentRequest[] = [];
  mount(host, "test.context", agentContextContributorFacet, { contribute: ({ step }) => [
    { id: "doc", version: "1", content: "obsolete" }, { id: "doc", version: "2", content: `step ${step}`, maxChars: 6 },
    { id: "private", version: "1", content: "owner only", audience: "only_owner" }
  ] });
  mount(host, "test.tools", agentToolDefinitionFacet, { tools: [tool()] });
  const report = await runAgentTurn({
    inputs, signal, bindings: { host, audience: "public_all", allowsTool: () => true },
    goalRequiresVerification: true,
    async *model(request) {
      requests.push(request);
      if (request.step === 0) yield { kind: "tool", id: "c1", name: "measure", input: "abc" };
      else yield { kind: "delta", text: "ok" };
    }
  });
  expect(report.goalVerification).toBe("unverified");
  expect(report.rounds[0]?.receipts[0]?.result).toEqual({ status: "verified", value: "private payload" });
  expect(requests[0]?.tools).toEqual([{ name: "measure", description: "Measure text", inputSchema: { type: "string" } }]);
  const second = requests[1]!;
  expect(second.prompt.observations).toEqual([{ content: "step 1" }]);
  expect(second.manifest.fragments.map(fragment => fragment.reason)).toEqual(["included", "replaced", "included", "audience"]);
  expect(JSON.stringify(second)).not.toContain("private payload");
  expect(second.messages.at(-1)).toEqual({ role: "tool", name: "measure", callId: "c1", result: { status: "verified", value: 15 } });
  expect(report.steps[0]?.stepId).not.toBe(report.steps[1]?.stepId);
});
it.each(["revocation", "hot replacement", "invalid argument", "hallucinated name"])("refuses dispatch after %s", async scenario => {
  const host = new ExtensionCoreHost();
  const definition = tool();
  const execute = vi.fn(definition.execute);
  mount(host, "test.tools", agentToolDefinitionFacet, { tools: [{ ...definition, execute }] });
  let granted = true;
  const result = await runAgentTurn({
    inputs, signal, bindings: { host, allowsTool: () => granted },
    async *model({ step }) {
      if (step) return;
      if (scenario === "revocation") granted = false;
      if (scenario === "hot replacement") host.configurePackage("test.tools", {}, 0);
      yield { kind: "tool", id: "c", name: scenario === "hallucinated name" ? "undeclared" : "measure",
        input: scenario === "invalid argument" ? 42 : "ok" };
    }
  });
  expect(execute).not.toHaveBeenCalled();
  expect(result.rounds[0]?.receipts[0]?.result.status).toBe("failed");
});
it("keeps a shared slot within granted authority and records budget exclusions", async () => {
  const host = new ExtensionCoreHost();
  for (const id of ["test.a", "test.b"]) mount(host, id, agentContextContributorFacet, {
    contribute: () => [{ id: "policy", version: "v1", content: id }, { id: "extra", version: "v1", content: "extras" }]
  });
  await runAgentTurn({ inputs: [], signal, contextBudgetChars: 4,
    bindings: { host, contextRole: () => "developer_frame", contextSlot: (_id, key) => key },
    async *model({ prompt, manifest }) {
      expect(prompt.developer).toEqual(["test"]);
      expect(manifest.fragments.map(part => part.reason)).toEqual(["replaced", "replaced", "trimmed", "budget"]);
      yield { kind: "finish" };
    }
  });
});
it("cancels a model that has yet to emit an event", async () => {
  const handle = new AgentCoreRuntime().startTurn({ inputs, async *model() { await new Promise(() => undefined); } });
  handle.cancel();
  await expect(handle.result).rejects.toMatchObject({ name: "AbortError" });
});
