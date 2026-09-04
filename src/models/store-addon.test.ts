import { describe, expect, it } from "vitest";
import StoreAddon from "./store-addon.js";

describe("StoreAddon", () => {
  it("has unique and availability lookup indexes", () => {
    const indexes = StoreAddon.schema
      .indexes()
      .map(([keys, options]) => ({ keys, options }));
    expect(indexes).toContainEqual({
      keys: { storeId: 1, addonId: 1 },
      options: { unique: true },
    });
    expect(indexes).toContainEqual({
      keys: { storeId: 1, permanentlyActive: 1, temporarilyUnavailable: 1 },
      options: {},
    });
    expect(indexes).toContainEqual({
      keys: {
        storeId: 1,
        temporarilyUnavailable: 1,
        temporarilyUnavailableUntil: 1,
      },
      options: {},
    });
  });

  it("rejects decimal and negative add-on prices", async () => {
    await expect(
      new StoreAddon({
        storeId: "507f1f77bcf86cd799439011",
        addonId: "507f1f77bcf86cd799439012",
        priceExtra: 10.5,
      }).validate(),
    ).rejects.toThrow();
    await expect(
      new StoreAddon({
        storeId: "507f1f77bcf86cd799439011",
        addonId: "507f1f77bcf86cd799439012",
        priceExtra: -1,
      }).validate(),
    ).rejects.toThrow();
  });
});
