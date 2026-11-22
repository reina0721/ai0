import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const verifierPath = fileURLToPath(
  new URL("../../../scripts/verify-architecture-boundaries.mjs", import.meta.url)
);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("architecture boundaries", () => {
  it("accepts the repository topology and dependency boundaries", () => {
    expect(() =>
      execFileSync(process.execPath, [verifierPath], {
        cwd: repositoryRoot,
        stdio: "pipe"
      })
    ).not.toThrow();
  });
});
