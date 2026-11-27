import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentCli } from "./agent-cli.js";

describe("standalone pnpm agent CLI (apps/daemon/src/agent-cli.ts)", () => {
  it("auto-discovers builtin toolpacks & SKILL.md manuals headlessly and binds --skill into developer_frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ai0-agent-cli-"));
    try {
      writeFileSync(join(dir, "README.md"), "# Sample Workspace\n", "utf8");
      const outChunks: string[] = [];
      const errChunks: string[] = [];

      const exitCode = await runAgentCli(
        [
          "--workspace",
          dir,
          "--sandbox",
          "--skill",
          "builtin.skill.systematic-code-engineering",
          "--prompt",
          "List files and summarize"
        ],
        {
          writeOut: (t) => outChunks.push(t),
          writeErr: (t) => errChunks.push(t)
        }
      );

      expect(exitCode).toBe(0);
      expect(errChunks).toEqual([]);
      const output = outChunks.join("");
      expect(output).toContain("README.md");
      expect(output).toContain("SkillManualBound=true");
      expect(output).toContain("List files and summarize");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
