import { describe, expect, it } from "vitest";
import {
  isNonNegativeTwd,
  isValidPriceMap,
  isValidPromotionAmount,
} from "./money.js";

describe("money validation", () => {
  it("accepts non-negative integer TWD values only", () => {
    expect(isNonNegativeTwd(0)).toBe(true);
    expect(isNonNegativeTwd(10)).toBe(true);
    expect(isNonNegativeTwd(-1)).toBe(false);
    expect(isNonNegativeTwd(10.5)).toBe(false);
    expect(isNonNegativeTwd(Number.NaN)).toBe(false);
  });

  it("allows decimal percentages but not decimal money", () => {
    expect(isValidPriceMap({ base: 100, uber: 120, foodpanda: 130 })).toBe(
      true,
    );
    expect(isValidPriceMap({ base: 10.5 })).toBe(false);
    expect(isValidPriceMap({ base: -1 })).toBe(false);
    expect(isValidPromotionAmount("value", 10.5)).toBe(false);
    expect(isValidPromotionAmount("percent", 12.5)).toBe(true);
  });
});
