import { afterEach, describe, expect, it } from "vitest";
import {
  createPublicOrderQuote,
  matchesPublicOrderQuote,
} from "./publicOrderQuote.js";

const lines = [
  {
    itemId: "tea",
    quantity: 2,
    variant: "",
    noteOptions: [],
    addonIds: ["boba"],
    note: "",
  },
];
const pricing = {
  total: 240,
  appliedPromotions: [
    { promotionId: "promo-1", promotionVersion: 1, discountAmount: 20 },
  ],
};

describe("public order quotes", () => {
  afterEach(() => {
    delete process.env.PUBLIC_ORDER_REALTIME_PRIVATE_KEY;
  });

  it("matches only the quoted cart and authoritative pricing", () => {
    process.env.PUBLIC_ORDER_REALTIME_PRIVATE_KEY = "test-quote-secret";
    const quote = createPublicOrderQuote("cart-1", "store-1", lines, pricing);
    expect(
      matchesPublicOrderQuote(
        quote.quoteToken,
        "cart-1",
        "store-1",
        lines,
        pricing,
      ),
    ).toBe(true);
    expect(
      matchesPublicOrderQuote(quote.quoteToken, "cart-1", "store-1", lines, {
        ...pricing,
        total: 241,
      }),
    ).toBe(false);
    expect(
      matchesPublicOrderQuote(
        quote.quoteToken,
        "cart-1",
        "store-1",
        [{ ...lines[0], quantity: 1 }],
        pricing,
      ),
    ).toBe(false);
  });
});
