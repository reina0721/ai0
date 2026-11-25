import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeploymentReadinessReportSchema, type DeploymentStage } from "@ai0/protocol";
import { expect, type TestContext } from "vitest";
import { createDefaultDaemonRuntime, createUnifiedDaemonHttpApp } from "../index.js";

export function lifecycleFixture(ctx: TestContext, prepare?: (soulsRoot: string) => void) {
  const tempRoot = mkdtempSync(join(tmpdir(), "ai0-lifecycle-"));
  const soulsRoot = join(tempRoot, "souls");
  const ownerMasterToken = randomUUID();
  let runtime: ReturnType<typeof createDefaultDaemonRuntime> | undefined;
  ctx.onTestFinished(() => {
    try {
      runtime?.close();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
  mkdirSync(soulsRoot);
  prepare?.(soulsRoot);
  runtime = createDefaultDaemonRuntime({ soulsRoot, ownerMasterToken, allowDeterministicSandbox: false });
  const app = createUnifiedDaemonHttpApp(runtime);

  async function request<T = unknown>(
    path: string, method = "GET", body?: unknown, status = 200, shellToken?: string
  ): Promise<T> {
    const response = await app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(shellToken ? { authorization: "Bearer " + shellToken } : { "x-ai0-owner-token": ownerMasterToken })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    expect(response.status, method + " " + path).toBe(status);
    return response.json() as Promise<T>;
  }

  async function readiness(stage: DeploymentStage) {
    const ready = stage === "L5_LIVE_READY";
    const report = DeploymentReadinessReportSchema.parse(await request("/readyz", "GET", undefined, ready ? 200 : 503));
    expect(report).toMatchObject({ ready, stage });
    return report;
  }

  async function connectShell() {
    const shellId = "lifecycle.terminal";
    const { token } = await request<{ token: string }>("/api/studio/shell-grants", "POST", {
      shellId, audience: "only_owner", principalId: "owner:local", externalUserId: "lifecycle-user"
    });
    const { session_id: sessionId } = await request<{ session_id: string }>("/protocol/v0/shell/connections", "POST", {
      protocol_version: "0.1.0", shell_id: shellId, shell_kind: "im_bridge", display_name: "Lifecycle terminal",
      venue_type: "private_1on1", current_audience: { scope: "only_owner", member_count: 1 }, latency_budget_ms: 300,
      capabilities: { sensors: ["text"], actuators: [], supported_extensions: [] }
    }, 200, token);
    expect(sessionId).toEqual(expect.any(String));
    return { shellId, sessionId, token };
  }

  return { soulsRoot, runtime, request, readiness, connectShell };
}
