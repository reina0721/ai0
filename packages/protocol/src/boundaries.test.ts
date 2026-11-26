import { describe, expect, it } from "vitest";

describe("architecture boundaries", () => {
  it("accepts the repository topology and dependency boundaries", async () => {
    const verifier = new URL("../../../scripts/verify-architecture-boundaries.mjs", import.meta.url);
    const { verifyArchitectureBoundaries } = await import(/* @vite-ignore */ verifier.href);
    expect(await verifyArchitectureBoundaries()).toEqual([]);
  }, 30_000);
});
