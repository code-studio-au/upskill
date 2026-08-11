import { describe, expect, it } from "vitest";
import { createFriendlySlug } from "./friendly-slug";

describe("friendly URL generation", () => {
  it("creates readable lowercase slugs", () => {
    expect(createFriendlySlug("  Café Safety & Support  ")).toBe(
      "cafe-safety-support",
    );
  });

  it("keeps generated slugs within the persisted limit", () => {
    expect(createFriendlySlug("A".repeat(140))).toHaveLength(100);
  });
});
