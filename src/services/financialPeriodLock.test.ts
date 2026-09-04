import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findOne: vi.fn() }));
vi.mock("../models/daily-closing.js", () => ({
  default: { findOne: mocks.findOne },
}));

import {
  assertFinancialPeriodOpen,
  FinancialPeriodClosedError,
  isFinancialPeriodClosed,
} from "./financialPeriodLock.js";

describe("financial period lock", () => {
  beforeEach(() => {
    mocks.findOne.mockReset();
  });

  it("queries confirmed closings only within the requesting store", async () => {
    mocks.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: "closing-a" }) }),
    });
    const timestamp = new Date("2026-08-22T10:00:00.000Z");

    await expect(isFinancialPeriodClosed("store-a", timestamp)).resolves.toBe(
      true,
    );
    expect(mocks.findOne).toHaveBeenCalledWith({
      storeId: "store-a",
      status: "confirmed",
      periodStart: { $lt: timestamp },
      periodEnd: { $gte: timestamp },
    });
  });

  it("does not lock when no confirmed closing exists in that store", async () => {
    mocks.findOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });
    await expect(
      assertFinancialPeriodOpen("store-b", new Date()),
    ).resolves.toBeUndefined();
  });

  it("rejects updates that fall inside a confirmed period", async () => {
    mocks.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ _id: "closing-b" }) }),
    });
    await expect(
      assertFinancialPeriodOpen("store-b", new Date()),
    ).rejects.toBeInstanceOf(FinancialPeriodClosedError);
  });
});
