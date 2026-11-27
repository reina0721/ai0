import { ExtensionCoreHost, cognitionSleepOrganFacet } from "@ai0/sdk";
import { describe, expect, it, vi } from "vitest";
import { bundlePrivacyScrubbedCreatorAsset } from "./asset-bundler.js";
import {
  AssertionUndefinedPathError,
  evaluateScenarioAssertion,
  GOLDEN_REGRESSION_SCENARIO_V1,
  resolveStrictPropertyPath,
  ScenarioReplayRunner
} from "./scenario-runner.js";

describe("ScenarioReplayRunner & privacy asset scrubber", () => {
  it("scrubs sensitive persistence and secret keys from creator asset bundles", () => {
    const bundle = bundlePrivacyScrubbedCreatorAsset({
      persona_name: "Aoi",
      soul_core: "safe",
      event_log: "should be stripped",
      memories: ["private memory"],
      redaction_ledger: ["secret hash"],
      api_key: "sk-123456"
    });
    expect(bundle.filename).toBe("creator-asset.ai0pack");
    expect(bundle.excluded_keys).toEqual(["api_key", "event_log", "memories", "redaction_ledger"]);
  });

  it("enforces Fail-Closed AssertionUndefinedPathError and passes all 5 steps of GOLDEN_REGRESSION_SCENARIO_V1", async () => {
    expect(() => resolveStrictPropertyPath({ trace: { w1: { ok: true } } }, "trace.w1.non_existent_prop")).toThrow(
      AssertionUndefinedPathError
    );

    const failedAssertion = evaluateScenarioAssertion("trace.non_existent.field == 'none'", { trace: {} });
    expect(failedAssertion.passed).toBe(false);
    expect(failedAssertion.error).toContain("Assertion path");

    const onSleepCycleWakeup = vi.fn(() => []);
    const runner = new ScenarioReplayRunner((runName) => {
      const host = new ExtensionCoreHost();
      host.mountPackage({
        manifest: {
          manifest_version: "2.0.0",
          extension_id: "test.sleep",
          display_name: runName,
          version: "1",
          author: "test",
          carrier_kind: "native_code_plugin",
          facets: [cognitionSleepOrganFacet.id],
          permissions: {
            read_blackboard_domains: [],
            propose_mutation_domains: [],
            max_audience_scope: "only_owner",
            network_access: false
          }
        },
        activate(scope) {
          scope.contributeFacet(cognitionSleepOrganFacet, { onSleepCycleWakeup });
        }
      });
      return host;
    });
    const report = await runner.run(GOLDEN_REGRESSION_SCENARIO_V1);
    expect(report.passed).toBe(true);
    expect(report.runs).toHaveLength(2);
    expect(report.summary.failed_assertions).toBe(0);
    expect(report.summary.pass_rate).toBe(1);
    expect(onSleepCycleWakeup).toHaveBeenCalledTimes(report.runs.length);
  });
});
