import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";

const QUOTE_TTL_SECONDS = 60;

const quoteSecret = () => {
  const secret = process.env.PUBLIC_ORDER_REALTIME_PRIVATE_KEY;
  if (!secret)
    throw new Error("PUBLIC_ORDER_REALTIME_PRIVATE_KEY is not configured");
  return secret;
};

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("base64url");

export const quoteCartHash = (storeId: string, lines: any[]) =>
  hash({
    storeId,
    lines: lines.map((line) => ({
      itemId: String(line.itemId),
      quantity: Number(line.quantity),
      variant: String(line.variant || ""),
      optionSelections: Array.isArray(line.optionSelections)
        ? line.optionSelections.map((selection: any) => ({
            groupId: String(selection.groupId),
            optionId: String(selection.optionId),
          }))
        : [],
      noteOptions: Array.isArray(line.noteOptions)
        ? line.noteOptions.map(String)
        : [],
      addonIds: Array.isArray(line.addonIds) ? line.addonIds.map(String) : [],
      note: String(line.note || ""),
      componentSelections: Array.isArray(line.componentSelections)
        ? line.componentSelections
        : [],
    })),
  });

export const quotePricingHash = (pricing: {
  total: number;
  appliedPromotions: any[];
}) =>
  hash({
    total: pricing.total,
    appliedPromotions: pricing.appliedPromotions.map((promotion) => ({
      promotionId: String(promotion.promotionId),
      promotionVersion: Number(promotion.promotionVersion),
      discountAmount: Number(promotion.discountAmount),
    })),
  });

export const createPublicOrderQuote = (
  cartToken: string,
  storeId: string,
  lines: any[],
  pricing: { total: number; appliedPromotions: any[] },
) => ({
  quoteToken: jwt.sign(
    {
      scope: "public-order-quote",
      cartToken,
      cartHash: quoteCartHash(storeId, lines),
      pricingHash: quotePricingHash(pricing),
    },
    quoteSecret(),
    { expiresIn: QUOTE_TTL_SECONDS },
  ),
  expiresAt: new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString(),
});

export const matchesPublicOrderQuote = (
  quoteToken: unknown,
  cartToken: string,
  storeId: string,
  lines: any[],
  pricing: { total: number; appliedPromotions: any[] },
) => {
  if (typeof quoteToken !== "string" || !quoteToken) return false;
  try {
    const quote = jwt.verify(quoteToken, quoteSecret()) as {
      scope?: string;
      cartToken?: string;
      cartHash?: string;
      pricingHash?: string;
    };
    return (
      quote.scope === "public-order-quote" &&
      quote.cartToken === cartToken &&
      quote.cartHash === quoteCartHash(storeId, lines) &&
      quote.pricingHash === quotePricingHash(pricing)
    );
  } catch {
    return false;
  }
};
