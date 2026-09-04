import { describe, expect, it } from "vitest";
import {
  calculateOrderItemTotal,
  calculateOrderPriceBreakdown,
  calculateOrderSubtotal,
  calculateTotal,
  type OrderCalculationItem,
} from "./orderCalculations.js";

const item = (
  overrides: Partial<OrderCalculationItem> = {},
): OrderCalculationItem => ({
  basePrice: 30000,
  quantity: 1,
  addons: [],
  ...overrides,
});

describe("order calculations", () => {
  it("calculates item total from quantity and addon amounts", () => {
    expect(
      calculateOrderItemTotal(
        item({
          quantity: 2,
          addons: [
            { amount: 2, priceExtra: 5000 },
            { amount: 1, priceExtra: 15000 },
          ],
        }),
      ),
    ).toBe(110000);
  });

  it("calculates subtotal across multiple items", () => {
    expect(
      calculateOrderSubtotal([
        item({ quantity: 2 }),
        item({ basePrice: 45000, addons: [{ amount: 1, priceExtra: 10000 }] }),
      ]),
    ).toBe(115000);
  });

  it("returns subtotal when there is no discount", () => {
    expect(calculateTotal([item({ basePrice: 100000 })], null)).toBe(100000);
  });

  it("applies a percentage discount", () => {
    expect(
      calculateTotal([item({ basePrice: 100000 })], {
        amount: 10,
        type: "percent",
      }),
    ).toBe(90000);
  });

  it("applies a fixed-value discount", () => {
    expect(
      calculateTotal([item({ basePrice: 100000 })], {
        amount: 25000,
        type: "value",
      }),
    ).toBe(75000);
  });

  it("never returns a negative total when discount exceeds subtotal", () => {
    expect(
      calculateTotal([item({ basePrice: 30000 })], {
        amount: 50000,
        type: "value",
      }),
    ).toBe(0);
  });

  it("returns a transparent breakdown for checkout and order snapshots", () => {
    expect(
      calculateOrderPriceBreakdown(
        [
          item({
            basePrice: 60000,
            quantity: 2,
            addons: [{ amount: 1, priceExtra: 10000 }],
          }),
        ],
        { amount: 10, type: "percent" },
      ),
    ).toEqual({
      productSubtotal: 120000,
      addonSubtotal: 20000,
      subtotal: 140000,
      discountAmount: 14000,
      total: 126000,
    });
  });
});
