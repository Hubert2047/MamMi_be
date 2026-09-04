export const isNonNegativeTwd = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isValidPriceMap = (
  value: unknown,
): value is Record<string, number> =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.entries(value as Record<string, unknown>).every(
    ([key, amount]) =>
      ["base", "uber", "foodpanda"].includes(key) && isNonNegativeTwd(amount),
  );

export const isValidPromotionAmount = (
  type: unknown,
  amount: unknown,
): boolean =>
  type === "percent"
    ? typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount >= 0 &&
      amount <= 100
    : isNonNegativeTwd(amount);
