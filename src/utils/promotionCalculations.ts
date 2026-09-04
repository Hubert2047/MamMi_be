import {
  calculateOrderItemTotal,
  type OrderCalculationItem,
} from "./orderCalculations.js";

export type PromotionMode = "automatic" | "manual";
export type PromotionTarget = "order" | "product" | "addon" | "line";
export type Reward = { type: "percent" | "value"; amount: number };
export type PromotionRule = {
  target: PromotionTarget;
  productIds?: string[];
  addonIds?: string[];
  reward: Reward;
};
export type PricePromotion = {
  id: string;
  name: string;
  version: number;
  mode: PromotionMode;
  minSubtotal?: number;
  priority: number;
  combinable: boolean;
  exclusiveGroup?: string;
  rules: PromotionRule[];
};
export type PromotionOrderItem = Omit<OrderCalculationItem, "addons"> & {
  id: string;
  addons: (OrderCalculationItem["addons"][number] & { id: string })[];
};
export type AppliedPromotion = {
  promotionId: string;
  promotionVersion: number;
  name: string;
  mode: PromotionMode;
  /** Targets covered by this promotion, used by clients to avoid presenting order discounts as line discounts. */
  targets?: PromotionTarget[];
  discountAmount: number;
  allocations: {
    itemId: string;
    productDiscountAmount: number;
    addonDiscounts: { addonId: string; discountAmount: number }[];
  }[];
};
export type PromotionPricing = {
  total: number;
  appliedPromotions: AppliedPromotion[];
};
export type ExpectedPromotionPricing = Pick<
  PromotionPricing,
  "total" | "appliedPromotions"
>;

export const matchesExpectedPromotionPricing = (
  expected: ExpectedPromotionPricing | undefined,
  actual: PromotionPricing,
): boolean => {
  if (
    !expected ||
    !Number.isFinite(expected.total) ||
    Math.abs(expected.total - actual.total) > 0.0001
  )
    return false;
  const expectedPromotions = [...expected.appliedPromotions].sort((a, b) =>
    a.promotionId.localeCompare(b.promotionId),
  );
  const actualPromotions = [...actual.appliedPromotions].sort((a, b) =>
    a.promotionId.localeCompare(b.promotionId),
  );
  return (
    expectedPromotions.length === actualPromotions.length &&
    expectedPromotions.every((promotion, index) => {
      const other = actualPromotions[index];
      return (
        other &&
        promotion.promotionId === other.promotionId &&
        promotion.promotionVersion === other.promotionVersion &&
        Math.abs(promotion.discountAmount - other.discountAmount) <= 0.0001
      );
    })
  );
};

export const isPromotionAvailableAt = (
  promotion: {
    status: string;
    startsAt?: Date | string | null;
    endsAt?: Date | string | null;
  },
  now = new Date(),
): boolean => {
  if (promotion.status !== "active") return false;
  const startsAt = promotion.startsAt ? new Date(promotion.startsAt) : null;
  const endsAt = promotion.endsAt ? new Date(promotion.endsAt) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
};

const discountFor = (subtotal: number, reward: Reward) =>
  Math.max(
    0,
    Math.min(
      subtotal,
      reward.type === "percent"
        ? (subtotal * reward.amount) / 100
        : reward.amount,
    ),
  );

const roundTwd = (amount: number) => Math.floor(amount + 0.5 + Number.EPSILON);

const finalizePromotionPricing = (
  grossSubtotal: number,
  exactTotal: number,
  appliedPromotions: AppliedPromotion[],
): PromotionPricing => {
  const total = roundTwd(exactTotal);
  const targetDiscount = roundTwd(grossSubtotal) - total;
  const entries: {
    amount: number;
    index: number;
    set(amount: number): void;
  }[] = [];

  appliedPromotions.forEach((promotion) =>
    promotion.allocations.forEach((allocation) => {
      if (allocation.productDiscountAmount > 0)
        entries.push({
          amount: allocation.productDiscountAmount,
          index: entries.length,
          set: (amount) => {
            allocation.productDiscountAmount = amount;
          },
        });
      allocation.addonDiscounts.forEach((addonDiscount) => {
        if (addonDiscount.discountAmount > 0)
          entries.push({
            amount: addonDiscount.discountAmount,
            index: entries.length,
            set: (amount) => {
              addonDiscount.discountAmount = amount;
            },
          });
      });
    }),
  );

  const roundedEntries = entries.map((entry) => ({
    ...entry,
    amount: Math.floor(entry.amount + Number.EPSILON),
    fraction: entry.amount - Math.floor(entry.amount + Number.EPSILON),
  }));
  let remainingUnits =
    targetDiscount -
    roundedEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const byLargestFraction = [...roundedEntries].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  );
  for (
    let index = 0;
    remainingUnits > 0 && byLargestFraction.length;
    index += 1, remainingUnits -= 1
  )
    byLargestFraction[index % byLargestFraction.length]!.amount += 1;
  for (const entry of roundedEntries) entry.set(entry.amount);

  return {
    total,
    appliedPromotions: appliedPromotions
      .map((promotion) => ({
        ...promotion,
        discountAmount: promotion.allocations.reduce(
          (sum, allocation) =>
            sum +
            allocation.productDiscountAmount +
            allocation.addonDiscounts.reduce(
              (addonSum, addon) => addonSum + addon.discountAmount,
              0,
            ),
          0,
        ),
      }))
      .filter((promotion) => promotion.discountAmount > 0),
  };
};

const estimatedDiscount = (
  items: PromotionOrderItem[],
  promotion: PricePromotion,
): number => {
  const gross = items.reduce(
    (sum, item) => sum + calculateOrderItemTotal(item),
    0,
  );
  return promotion.rules.reduce((sum, rule) => {
    if (rule.target === "order") return sum + discountFor(gross, rule.reward);
    return (
      sum +
      items.reduce((itemSum, item) => {
        if (rule.productIds?.length && !rule.productIds.includes(item.id))
          return itemSum;
        if (rule.target === "product")
          return (
            itemSum +
            discountFor(item.basePrice * item.quantity, {
              ...rule.reward,
              amount:
                rule.reward.type === "value"
                  ? rule.reward.amount * item.quantity
                  : rule.reward.amount,
            })
          );
        if (rule.target === "addon")
          return (
            itemSum +
            item.addons
              .filter(
                (addon) =>
                  !rule.addonIds?.length || rule.addonIds.includes(addon.id),
              )
              .reduce(
                (addonSum, addon) =>
                  addonSum +
                  discountFor(addon.amount * addon.priceExtra * item.quantity, {
                    ...rule.reward,
                    amount:
                      rule.reward.type === "value"
                        ? rule.reward.amount * addon.amount * item.quantity
                        : rule.reward.amount,
                  }),
                0,
              )
          );
        return (
          itemSum +
          discountFor(calculateOrderItemTotal(item), {
            ...rule.reward,
            amount:
              rule.reward.type === "value"
                ? rule.reward.amount * item.quantity
                : rule.reward.amount,
          })
        );
      }, 0)
    );
  }, 0);
};

export const calculatePromotionPricing = (
  items: PromotionOrderItem[],
  promotions: PricePromotion[],
  selectedPromotionIds: string[] = [],
): PromotionPricing => {
  const grossSubtotal = items.reduce(
    (total, item) => total + calculateOrderItemTotal(item),
    0,
  );
  const eligible = promotions.filter(
    (promotion) =>
      (promotion.mode === "automatic" ||
        selectedPromotionIds.includes(promotion.id)) &&
      (!promotion.minSubtotal || grossSubtotal >= promotion.minSubtotal),
  );
  const sorted = [...eligible].sort(
    (a, b) =>
      b.priority - a.priority ||
      estimatedDiscount(items, b) - estimatedDiscount(items, a) ||
      a.id.localeCompare(b.id),
  );
  const accepted: PricePromotion[] = [];
  const usedGroups = new Set<string>();
  for (const promotion of sorted) {
    const group =
      promotion.exclusiveGroup ||
      (promotion.mode === "automatic" &&
      promotion.rules.some((rule) => rule.target === "order")
        ? "automatic-order"
        : promotion.combinable
          ? ""
          : "default");
    if (group && usedGroups.has(group)) continue;
    accepted.push(promotion);
    if (group) usedGroups.add(group);
  }

  const remainingProduct = items.map((item) => item.basePrice * item.quantity);
  const remainingAddon = items.map((item) =>
    item.addons.map((addon) => addon.amount * addon.priceExtra * item.quantity),
  );
  const allocationsByPromotion = new Map(
    accepted.map((promotion) => [
      promotion.id,
      items.map((item) => ({
        itemId: item.id,
        productDiscountAmount: 0,
        addonDiscounts: [] as { addonId: string; discountAmount: number }[],
      })),
    ]),
  );

  // Rule stages are global, rather than per-promotion: an order reward must never
  // see a subtotal before another accepted product/add-on/line reward is applied.
  for (const target of ["product", "addon", "line"] as const) {
    for (const promotion of accepted) {
      const allocations = allocationsByPromotion.get(promotion.id)!;
      for (const rule of promotion.rules.filter(
        (candidate) => candidate.target === target,
      )) {
        items.forEach((item, itemIndex) => {
          const matchesProduct =
            !rule.productIds?.length || rule.productIds.includes(item.id);
          if (!matchesProduct) return;
          if (rule.target === "product") {
            const discountAmount = discountFor(remainingProduct[itemIndex]!, {
              ...rule.reward,
              amount:
                rule.reward.type === "value"
                  ? rule.reward.amount * item.quantity
                  : rule.reward.amount,
            });
            remainingProduct[itemIndex]! -= discountAmount;
            allocations[itemIndex]!.productDiscountAmount += discountAmount;
          }
          if (rule.target === "line") {
            const available =
              remainingProduct[itemIndex]! +
              remainingAddon[itemIndex]!.reduce(
                (sum, amount) => sum + amount,
                0,
              );
            const discountAmount = discountFor(available, {
              ...rule.reward,
              amount:
                rule.reward.type === "value"
                  ? rule.reward.amount * item.quantity
                  : rule.reward.amount,
            });
            const productDiscountAmount = Math.min(
              remainingProduct[itemIndex]!,
              discountAmount,
            );
            remainingProduct[itemIndex]! -= productDiscountAmount;
            allocations[itemIndex]!.productDiscountAmount +=
              productDiscountAmount;
            let remainingLineDiscount = discountAmount - productDiscountAmount;
            item.addons.forEach((addon, addonIndex) => {
              const addonDiscount = Math.min(
                remainingAddon[itemIndex]![addonIndex]!,
                remainingLineDiscount,
              );
              remainingAddon[itemIndex]![addonIndex]! -= addonDiscount;
              remainingLineDiscount -= addonDiscount;
              if (addonDiscount)
                allocations[itemIndex]!.addonDiscounts.push({
                  addonId: addon.id,
                  discountAmount: addonDiscount,
                });
            });
          }
          if (rule.target === "addon")
            item.addons.forEach((addon, addonIndex) => {
              if (rule.addonIds?.length && !rule.addonIds.includes(addon.id))
                return;
              const discountAmount = discountFor(
                remainingAddon[itemIndex]![addonIndex]!,
                {
                  ...rule.reward,
                  amount:
                    rule.reward.type === "value"
                      ? rule.reward.amount * item.quantity * addon.amount
                      : rule.reward.amount,
                },
              );
              remainingAddon[itemIndex]![addonIndex]! -= discountAmount;
              if (discountAmount)
                allocations[itemIndex]!.addonDiscounts.push({
                  addonId: addon.id,
                  discountAmount,
                });
            });
        });
      }
    }
  }

  for (const promotion of accepted) {
    const allocations = allocationsByPromotion.get(promotion.id)!;
    const rule = promotion.rules.find(
      (candidate) => candidate.target === "order",
    );
    if (rule) {
      const subtotal =
        remainingProduct.reduce((sum, amount) => sum + amount, 0) +
        remainingAddon.reduce(
          (sum, addons) =>
            sum + addons.reduce((addonSum, amount) => addonSum + amount, 0),
          0,
        );
      let remainingDiscount = discountFor(subtotal, rule.reward);
      items.forEach((item, itemIndex) => {
        const productDiscount = Math.min(
          remainingProduct[itemIndex]!,
          remainingDiscount,
        );
        remainingProduct[itemIndex]! -= productDiscount;
        remainingDiscount -= productDiscount;
        allocations[itemIndex]!.productDiscountAmount += productDiscount;
        item.addons.forEach((addon, addonIndex) => {
          const addonDiscount = Math.min(
            remainingAddon[itemIndex]![addonIndex]!,
            remainingDiscount,
          );
          remainingAddon[itemIndex]![addonIndex]! -= addonDiscount;
          remainingDiscount -= addonDiscount;
          if (addonDiscount)
            allocations[itemIndex]!.addonDiscounts.push({
              addonId: addon.id,
              discountAmount: addonDiscount,
            });
        });
      });
    }
  }

  const appliedPromotions: AppliedPromotion[] = [];
  for (const promotion of accepted) {
    const allocations = allocationsByPromotion.get(promotion.id)!;
    const discountAmount = allocations.reduce(
      (sum, allocation) =>
        sum +
        allocation.productDiscountAmount +
        allocation.addonDiscounts.reduce(
          (addonSum, addon) => addonSum + addon.discountAmount,
          0,
        ),
      0,
    );
    if (discountAmount)
      appliedPromotions.push({
        promotionId: promotion.id,
        promotionVersion: promotion.version,
        name: promotion.name,
        mode: promotion.mode,
        targets: [...new Set(promotion.rules.map((rule) => rule.target))],
        discountAmount,
        allocations,
      });
  }
  const total =
    remainingProduct.reduce((sum, amount) => sum + amount, 0) +
    remainingAddon.reduce(
      (sum, addons) =>
        sum + addons.reduce((addonSum, amount) => addonSum + amount, 0),
      0,
    );
  return finalizePromotionPricing(grossSubtotal, total, appliedPromotions);
};
