import DailyClosing from "../models/daily-closing.js";
import Order from "../models/order.js";
import OrderCounter from "../models/order-counter.js";

export const getCurrentOrderPeriodId = async (
  storeId: string,
): Promise<string> => {
  const latestClosing = await DailyClosing.findOne({
    storeId,
    status: { $ne: "voided" },
  })
    .sort({ periodEnd: -1, createdAt: -1 })
    .select({ _id: 1 })
    .lean();

  return latestClosing ? String(latestClosing._id) : "open";
};

export const getNextOrderSequence = async (
  storeId: string,
  periodId: string,
): Promise<number> => {
  const counter = await OrderCounter.findOne({ storeId, periodId })
    .select({ sequence: 1 })
    .lean();
  if (counter) return counter.sequence + 1;

  // Only the pre-closing "open" period falls back to legacy global numbers.
  // A new closing period must start its own sequence at 1.
  const legacyOrder =
    periodId === "open"
      ? await Order.findOne({ storeId })
          .sort({ number: -1 })
          .select({ number: 1 })
          .lean()
      : null;
  return (legacyOrder?.number ?? 0) + 1;
};

export const allocateOrderSequence = async (
  storeId: string,
  periodId: string,
): Promise<number> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const existingCounter = await OrderCounter.findOne({ storeId, periodId })
        .select({ sequence: 1 })
        .lean();
      if (existingCounter) {
        const counter = await OrderCounter.findOneAndUpdate(
          { storeId, periodId },
          { $inc: { sequence: 1 } },
          { returnDocument: "after" },
        );
        if (!counter) throw new Error("Order counter was not returned");
        return counter.sequence;
      }

      const legacyOrder =
        periodId === "open"
          ? await Order.findOne({ storeId })
              .sort({ number: -1 })
              .select({ number: 1 })
              .lean()
          : null;
      const counter = await OrderCounter.create({
        storeId,
        periodId,
        sequence: (legacyOrder?.number ?? 0) + 1,
      });
      return counter.sequence;
    } catch (error: any) {
      if (error?.code !== 11000 || attempt === 2) throw error;
    }
  }

  throw new Error("Failed to allocate order sequence");
};
