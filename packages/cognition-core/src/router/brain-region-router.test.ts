import { expect, it } from "vitest";
import { BrainRegionRouter } from "./brain-region-router.js";

it("expresses budget status independently of voice, physical state or role names", () => {
  const router = new BrainRegionRouter({ summarize: { primary_model_id: "full", fallback_model_id: "small" } });
  expect(router.routeForRegion("summarize")).toMatchObject({budget: "normal", selected_model_id: "full"});
  expect(router.routeForRegion("summarize", {}, "throttled_fallback")).toEqual({
    primary_model_id: "full", fallback_model_id: "small", budget: "throttled_fallback", selected_model_id: "small"
  });
  expect(router.routeForRegion("summarize", {}, "budget_exhausted").selected_model_id).toBeUndefined();
});
