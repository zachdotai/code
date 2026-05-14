import { describe, expect, it } from "vitest";
import { computeStarMap } from "./computeStarMap";

describe("computeStarMap", () => {
  it("returns zero scores for an empty input", () => {
    const result = computeStarMap([]);
    expect(result.total).toBe(0);
    expect(result.max).toBe(0);
    expect(result.founder).toBe(0);
    for (const axis of Object.values(result.axes)) {
      expect(axis).toBe(0);
    }
  });

  it("scores a single marketing skill via keyword + growth tag", () => {
    const result = computeStarMap([
      {
        title: "Marketing campaign digest",
        description: "Summarizes channel performance every Monday",
        tags: ["growth"],
      },
    ]);
    expect(result.axes.marketing).toBe(2);
    expect(result.axes.operations).toBe(0);
    expect(result.max).toBe(2);
    expect(result.total).toBe(2);
  });

  it("attributes a skill to multiple axes when keywords overlap", () => {
    const result = computeStarMap([
      {
        title: "Hiring & onboarding budget review",
        description: "Tracks recruit pipeline and finance forecasts",
        tags: [],
      },
    ]);
    expect(result.axes.hr).toBeGreaterThan(0);
    expect(result.axes.finance).toBeGreaterThan(0);
  });

  it("blends finance + leadership signals into the founder score", () => {
    const result = computeStarMap([
      {
        title: "Investor update",
        description: "Drafts the monthly fundraise note for the board",
        tags: [],
      },
    ]);
    expect(result.founder).toBeGreaterThan(0);
  });

  it("max reflects the highest single-axis tally", () => {
    const result = computeStarMap([
      { title: "Design system", description: "Visual tokens", tags: [] },
      { title: "Design review", description: "UX critique", tags: [] },
      { title: "Marketing brief", description: "Audience plan", tags: [] },
    ]);
    expect(result.axes.design).toBe(2);
    expect(result.axes.marketing).toBe(1);
    expect(result.max).toBe(2);
  });

  it("applies sales tag bonus to marketing and finance", () => {
    const result = computeStarMap([
      {
        title: "Deal cycle dashboard",
        description: "Reads conversion through the funnel",
        tags: ["sales"],
      },
    ]);
    expect(result.axes.marketing).toBeGreaterThan(0);
    expect(result.axes.finance).toBeGreaterThan(0);
  });
});
