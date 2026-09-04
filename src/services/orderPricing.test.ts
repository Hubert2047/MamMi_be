import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storeItemFind: vi.fn(),
  itemFind: vi.fn(),
  storeAddonFind: vi.fn(),
}));

vi.mock("../models/store-item.js", () => ({
  default: { find: mocks.storeItemFind },
}));
vi.mock("../models/item.js", () => ({ default: { find: mocks.itemFind } }));
vi.mock("../models/store-addon.js", () => ({
  default: { find: mocks.storeAddonFind },
}));

import { normalizeOrderItemsForPricing } from "./orderPricing.js";

const query = (value: unknown) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  lean: async () => value,
});

describe("order pricing normalization", () => {
  it("ignores client prices and uses current store item and addon prices", async () => {
    mocks.storeItemFind.mockReturnValue(
      query([
        { itemId: "item-1", price: { base: 900 }, addonDisplayMode: "named" },
      ]),
    );
    mocks.itemFind.mockReturnValue(
      query([
        {
          _id: "item-1",
          names: { vi: "Tea" },
          variants: [],
          noteOptions: [],
          optionGroups: [],
          addons: [{ _id: "addon-1", names: { vi: "Boba" } }],
          addonConfigs: [],
        },
      ]),
    );
    mocks.storeAddonFind.mockReturnValue(
      query([{ addonId: "addon-1", priceExtra: 300 }]),
    );

    const [item] = await normalizeOrderItemsForPricing("store-1", "dine_in", [
      {
        id: "item-1",
        itemId: "line-1",
        name: "Forged tea",
        basePrice: 9999,
        quantity: 2,
        variant: "",
        noteOptions: [],
        note: "",
        addons: [
          { id: "addon-1", name: "Forged boba", priceExtra: 9999, amount: 1 },
        ],
      },
    ]);

    expect(item?.basePrice).toBe(900);
    expect(item?.addons[0]?.priceExtra).toBe(300);
  });

  it("accepts a zero base price stored as a Mongoose map", async () => {
    mocks.storeItemFind.mockReturnValue(
      query([
        {
          itemId: "item-1",
          price: new Map([["base", 0]]),
          addonDisplayMode: "named",
        },
      ]),
    );
    mocks.itemFind.mockReturnValue(
      query([
        {
          _id: "item-1",
          names: { vi: "Free item" },
          variants: [],
          noteOptions: [],
          optionGroups: [],
          addons: [],
          addonConfigs: [],
        },
      ]),
    );
    mocks.storeAddonFind.mockReturnValue(query([]));

    const [item] = await normalizeOrderItemsForPricing("store-1", "dine_in", [
      {
        id: "item-1",
        itemId: "line-1",
        name: "Free item",
        basePrice: 9999,
        quantity: 1,
        variant: "",
        noteOptions: [],
        note: "",
        addons: [],
      },
    ]);

    expect(item?.basePrice).toBe(0);
  });
});
