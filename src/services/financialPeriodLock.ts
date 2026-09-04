import DailyClosing from "../models/daily-closing.js";

export class FinancialPeriodClosedError extends Error {
  code = "FINANCIAL_PERIOD_CLOSED";
  statusCode = 409;

  constructor() {
    super("Financial data belongs to a confirmed closing period");
    this.name = "FinancialPeriodClosedError";
  }
}

export async function isFinancialPeriodClosed(
  storeId: string,
  timestamp: Date,
): Promise<boolean> {
  const closing = await DailyClosing.findOne({
    storeId,
    status: "confirmed",
    periodStart: { $lt: timestamp },
    periodEnd: { $gte: timestamp },
  })
    .select({ _id: 1 })
    .lean();

  return Boolean(closing);
}

export async function assertFinancialPeriodOpen(
  storeId: string,
  timestamp: Date,
): Promise<void> {
  if (await isFinancialPeriodClosed(storeId, timestamp))
    throw new FinancialPeriodClosedError();
}
