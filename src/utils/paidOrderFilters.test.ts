import { describe, expect, it } from "vitest";
import { buildPaidOrderFilter } from "./paidOrderFilters.js";

describe("paid order filters", () => {
  it("filters sales by payment time and paid status", () => {
    const start = new Date("2026-08-22T00:00:00.000Z");
    const end = new Date("2026-08-22T23:59:59.999Z");

    expect(buildPaidOrderFilter(start, end)).toEqual({
      paidAt: { $gte: start, $lte: end },
      status: "paid",
    });
  });
});
