import { describe, expect, it } from "vitest";
import { isApmEnrichmentEligible } from "./apmEnrichmentEligibility";

describe("isApmEnrichmentEligible", () => {
  it("accepts Rust files (the feature-flags service is Rust)", () => {
    expect(
      isApmEnrichmentEligible("rust/feature-flags/src/flags/flag_matching.rs"),
    ).toBe(true);
  });

  it.each(["a/b/handler.go", "svc/main.py", "src/index.ts", "app/Foo.java"])(
    "accepts source file %s",
    (path) => {
      expect(isApmEnrichmentEligible(path)).toBe(true);
    },
  );

  it.each(["README.md", "config.json", "styles.css", "image.png"])(
    "rejects non-source file %s",
    (path) => {
      expect(isApmEnrichmentEligible(path)).toBe(false);
    },
  );
});
