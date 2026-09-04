import { describe, expect, it, vi } from "vitest";
import Promotion from "../models/promotion.js";
import {
  applyPublicMenuPromotionDisplays,
  expireEndedPromotions,
} from "./promotionPricing.js";

describe("expireEndedPromotions", () => {
  it("persists active promotions as expired only after the inclusive end instant", async () => {
    const update = vi
      .spyOn(Promotion, "updateMany")
      .mockResolvedValue({ acknowledged: true } as any);
    const now = new Date("2026-08-26T10:00:00.001Z");
    await expireEndedPromotions(now);
    expect(update).toHaveBeenCalledWith(
      { status: "active", endsAt: { $lt: now } },
      { $set: { status: "expired" } },
    );
    update.mockRestore();
  });
});

describe("applyPublicMenuPromotionDisplays", () => {
  it("projects only unconditional automatic product and add-on rewards for a public menu", () => {
    const [item] = applyPublicMenuPromotionDisplays(
      [
        {
          id: "tea",
          price: 100,
          addons: [
            { id: "boba", priceExtra: 20 },
            { id: "pudding", priceExtra: 30 },
          ],
        },
      ],
      [
        {
          id: "automatic",
          priority: 1,
          combinable: true,
          exclusiveGroup: "",
          rules: [
            {
              target: "product",
              productIds: ["tea"],
              addonIds: [],
              reward: { type: "percent", amount: 10 },
            },
            {
              target: "addon",
              productIds: ["tea"],
              addonIds: ["boba"],
              reward: { type: "value", amount: 5 },
            },
            {
              target: "line",
              productIds: ["tea"],
              addonIds: [],
              reward: { type: "value", amount: 50 },
            },
          ],
        },
        {
          id: "minimum-order",
          minSubtotal: 100,
          priority: 2,
          combinable: true,
          exclusiveGroup: "",
          rules: [
            {
              target: "product",
              productIds: ["tea"],
              addonIds: [],
              reward: { type: "value", amount: 50 },
            },
          ],
        },
      ],
    );
    expect(item.displayPrice).toBe(90);
    expect(item.addons).toEqual([
      { id: "boba", priceExtra: 20, displayPrice: 15 },
      { id: "pudding", priceExtra: 30, displayPrice: 30 },
    ]);
  });
});
