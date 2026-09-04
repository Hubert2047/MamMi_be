export type ClosingCashData = Record<string, number | string>;

export type ClosingPeriodFilter = {
  $gte?: Date;
  $gt?: Date;
  $lte: Date;
};

export function getClosingPeriodFilter(
  lastClosingAt: Date | undefined,
  firstPeriodStart: Date,
  end: Date,
): ClosingPeriodFilter {
  return lastClosingAt
    ? { $gt: lastClosingAt, $lte: end }
    : { $gte: firstPeriodStart, $lte: end };
}

export function canVoidLatestClosing(
  closingId: string,
  latestClosingId: string,
): boolean {
  return closingId === latestClosingId;
}

export function isValidCashData(cash: ClosingCashData): boolean {
  return Object.entries(cash).every(([denomination, count]) => {
    const denominationNumber = Number(denomination);
    const countNumber = Number(count);
    return (
      Number.isFinite(denominationNumber) &&
      denominationNumber > 0 &&
      Number.isInteger(denominationNumber) &&
      Number.isFinite(countNumber) &&
      countNumber >= 0 &&
      Number.isInteger(countNumber)
    );
  });
}

export function calculateActualCash(cash: ClosingCashData): number {
  return Object.entries(cash).reduce(
    (total, [denomination, count]) =>
      total + Number(denomination) * Number(count || 0),
    0,
  );
}

export function requiresClosingReason(
  difference: number,
  reason: unknown,
): boolean {
  return difference !== 0 && (typeof reason !== "string" || !reason.trim());
}

export function calculateSystemAmount(
  previousClosingAmount: number,
  cashSales: number,
  otherRevenues: number,
  expenses: number,
): number {
  return previousClosingAmount + cashSales + otherRevenues - expenses;
}
