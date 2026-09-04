export const buildPaidOrderFilter = (start: Date, end: Date) => ({
  paidAt: { $gte: start, $lte: end },
  status: "paid" as const,
});
