import type { Request, Response } from "express";
import Order from "../models/order.js";
import StoreAddon from "../models/store-addon.js";
import StoreItem from "../models/store-item.js";
import Item from "../models/item.js";
import mongoose from "mongoose";
import { getFromDayUntilNow, getFullDay } from "../utils/index.js";
import { calculateTotal } from "../utils/orderCalculations.js";
import Promotion from "../models/promotion.js";
import StorePromotion from "../models/store-promotion.js";
import {
  calculatePromotionPricing,
  isPromotionAvailableAt,
  matchesExpectedPromotionPricing,
  type PricePromotion,
  type PromotionOrderItem,
} from "../utils/promotionCalculations.js";
import {
  getPaidAt,
  isCashReceivedSufficient,
} from "../utils/orderPaymentCalculations.js";
import { buildPaidOrderFilter } from "../utils/paidOrderFilters.js";
import {
  assertFinancialPeriodOpen,
  FinancialPeriodClosedError,
} from "../services/financialPeriodLock.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { emitStoreEvent } from "../realtime.js";
import DailyClosing from "../models/daily-closing.js";
import Store from "../models/store.js";
import {
  allocateOrderSequence,
  getCurrentOrderPeriodId,
  getNextOrderSequence,
} from "../services/orderNumber.js";
import { createKitchenPrintJobs } from "../services/printJobs.js";
import { expireEndedPromotions } from "../services/promotionPricing.js";
import { normalizeOrderItemsForPricing } from "../services/orderPricing.js";

const MAX_NOTE_LENGTH = 40;
const orderInputErrorMessages: Record<string, string> = {
  ITEM_NOT_AVAILABLE: "One or more selected products are no longer available",
  ITEM_STORE_CONFIG_NOT_FOUND:
    "This product is not configured for the current store",
  ITEM_CATALOG_NOT_FOUND: "This product no longer exists in the catalog",
  ITEM_PRICE_NOT_CONFIGURED:
    "This product has no valid base price for the selected order type",
  ADDON_NOT_AVAILABLE: "One or more selected add-ons are no longer available",
  ITEM_QUANTITY_INVALID: "One or more product quantities are invalid",
  ADDON_QUANTITY_INVALID: "An add-on can only be selected once per item",
  INVALID_OPTION: "One or more selected options are no longer valid",
};

const calculatePromotionsForOrder = async (
  storeId: string,
  items: PromotionOrderItem[],
  selectedPromotionIds: string[] = [],
) => {
  const now = new Date();
  await expireEndedPromotions(now);
  const configs = await StorePromotion.find({ storeId, enabled: true })
    .populate("promotionId")
    .lean();
  const promotions: PricePromotion[] = configs.flatMap((config: any) => {
    const promotion = config.promotionId as any;
    if (!promotion || !isPromotionAvailableAt(promotion, now)) return [];
    return [
      {
        id: String(promotion._id),
        name:
          promotion.names.vi || promotion.names.en || promotion.names["zh-TW"],
        version: promotion.version,
        mode: promotion.mode,
        minSubtotal: promotion.minSubtotal,
        priority: promotion.priority,
        combinable: promotion.combinable,
        exclusiveGroup: promotion.exclusiveGroup,
        rules: promotion.rules.map((rule: any) => ({
          target: rule.target,
          productIds: rule.productIds.map(String),
          addonIds: rule.addonIds.map(String),
          reward: rule.reward,
        })),
      },
    ];
  });
  return calculatePromotionPricing(items, promotions, selectedPromotionIds);
};

export const getNextOrderNumber = async (req: Request, res: Response) => {
  try {
    const nextNumber = await getNextNumber((req as AuthRequest).user.storeId);
    res.json({ success: true, nextNumber });
  } catch (err) {
    res
      .status(500)
      .json({
        success: false,
        message: "Failed to get next number",
        error: err,
      });
  }
};

export const getSalesByPaymentMethod = async (req: Request, res: Response) => {
  try {
    const { start, end } = getFullDay(0);
    const result = await Order.aggregate([
      {
        $match: {
          ...buildPaidOrderFilter(start, end),
          storeId: (req as AuthRequest).user.storeId,
        },
      },
      {
        $group: {
          _id: "$paymentMethod",
          totalSales: { $sum: "$totalPrice" },
          count: { $sum: 1 },
        },
      },
    ]);

    const salesByMethod: Record<string, { totalSales: number; count: number }> =
      {};
    result.forEach((r) => {
      salesByMethod[r._id] = { totalSales: r.totalSales, count: r.count };
    });

    res.json({
      success: true,
      data: salesByMethod,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error fetching sales by payment method",
      error,
    });
  }
};

export const getNextNumber = async (storeId: string) => {
  const periodId = await getCurrentOrderPeriodId(storeId);
  return getNextOrderSequence(storeId, periodId);
};

export const createOrder = async (req: Request, res: Response) => {
  try {
    const order = req.body;
    const storeId = (req as AuthRequest).user.storeId;

    if (!order.items || order.items.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Items is required" });
    }
    const noteValues = order.items.flatMap((item: any) => [
      item.note,
      ...(Array.isArray(item.componentSelections)
        ? item.componentSelections.map((component: any) => component.note)
        : []),
    ]);
    if (
      noteValues.some(
        (note: any) =>
          typeof note === "string" && note.length > MAX_NOTE_LENGTH,
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,
          code: "NOTE_TOO_LONG",
          message: `Notes cannot exceed ${MAX_NOTE_LENGTH} characters`,
        });
    }
    if (order.type === "dine_in" && !String(order.table || "").trim()) {
      return res
        .status(400)
        .json({
          success: false,
          code: "TABLE_REQUIRED",
          message: "A table is required for dine-in orders",
        });
    }

    const itemIds: string[] = [
      ...new Set<string>(order.items.map((item: any) => String(item.id))),
    ];
    const validItemIds = itemIds.filter((id) => mongoose.isValidObjectId(id));
    if (validItemIds.length !== itemIds.length)
      return res
        .status(400)
        .json({
          success: false,
          code: "ITEM_NOT_AVAILABLE",
          message: "One or more selected products are no longer available",
        });
    await StoreItem.updateMany(
      {
        storeId,
        temporarilyUnavailable: true,
        temporarilyUnavailableUntil: { $lte: new Date() },
      },
      {
        $set: { temporarilyUnavailable: false },
        $unset: { temporarilyUnavailableUntil: 1 },
      },
    );
    const availableItems = await StoreItem.countDocuments({
      storeId,
      itemId: { $in: validItemIds },
      permanentlyActive: { $ne: false },
      temporarilyUnavailable: false,
      "visibility.pos": { $ne: false },
    });
    if (availableItems !== validItemIds.length)
      return res
        .status(400)
        .json({
          success: false,
          code: "ITEM_NOT_AVAILABLE",
          message: "One or more selected products are no longer available",
        });

    if (order.checkoutPending && order._id) {
      const existing = await Order.findOne({
        _id: order._id,
        storeId,
        status: "pending",
        version: order.version,
      }).lean();
      if (!existing)
        return res
          .status(409)
          .json({
            success: false,
            code: "ORDER_VERSION_CONFLICT",
            message: "Order was changed or is no longer pending",
          });
      const normalizedItems = await normalizeOrderItemsForPricing(
        storeId,
        order.type,
        order.items,
      );
      const selectedPromotionIds = Array.isArray(order.selectedPromotionIds)
        ? order.selectedPromotionIds.map(String)
        : [];
      const pricing = await calculatePromotionsForOrder(
        storeId,
        normalizedItems,
        selectedPromotionIds,
      );
      if (!matchesExpectedPromotionPricing(order.expectedPricing, pricing))
        return res
          .status(409)
          .json({
            success: false,
            code: "ORDER_PRICING_CHANGED",
            message: "Order pricing changed",
            data: {
              items: normalizedItems,
              pricing,
              reason: "CURRENT_PRICING_CHANGED",
            },
          });
      if (
        order.status === "paid" &&
        order.paymentMethod === "cash" &&
        !isCashReceivedSufficient(order.cashReceived, pricing.total)
      )
        return res
          .status(400)
          .json({
            success: false,
            code: "INSUFFICIENT_CASH",
            message: "Cash received is less than the order total",
          });
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, storeId, status: "pending", version: order.version },
        {
          $set: {
            status: "paid",
            paymentMethod: order.paymentMethod,
            paidAt: getPaidAt("paid"),
            items: normalizedItems,
            totalPrice: pricing.total,
            appliedPromotions: pricing.appliedPromotions,
            ...(order.paymentMethod === "cash"
              ? { cashReceived: order.cashReceived }
              : {}),
          },
          $inc: { version: 1 },
        },
        { returnDocument: "after" },
      );
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }
      emitStoreEvent(storeId, "order.payment.updated", {
        orderId: String(updated._id),
        changedFields: ["status", "paymentMethod"],
      });
      const nextNumber = await getNextNumber(storeId);
      return res.status(200).json({ success: true, data: nextNumber });
    }

    const addonIds: string[] = [
      ...new Set<string>(
        order.items.flatMap((item: any) =>
          Array.isArray(item.addons)
            ? item.addons.map((addon: any) => String(addon.id))
            : [],
        ),
      ),
    ];
    const validAddonIds = addonIds.filter((id) => mongoose.isValidObjectId(id));
    if (validAddonIds.length !== addonIds.length)
      return res
        .status(400)
        .json({
          success: false,
          code: "ADDON_NOT_AVAILABLE",
          message: "One or more selected add-ons are no longer available",
        });
    if (validAddonIds.length) {
      await StoreAddon.updateMany(
        {
          storeId,
          temporarilyUnavailable: true,
          temporarilyUnavailableUntil: { $lte: new Date() },
        },
        {
          $set: { temporarilyUnavailable: false },
          $unset: { temporarilyUnavailableUntil: 1 },
        },
      );
      const availableAddons = await StoreAddon.countDocuments({
        storeId,
        addonId: { $in: validAddonIds },
        permanentlyActive: { $ne: false },
        temporarilyUnavailable: false,
      });
      if (availableAddons !== validAddonIds.length)
        return res
          .status(400)
          .json({
            success: false,
            code: "ADDON_NOT_AVAILABLE",
            message: "One or more selected add-ons are no longer available",
          });
    }
    if (
      order.items.some((item: any) => {
        const ids = (item.addons || []).map((addon: any) => String(addon.id));
        return new Set(ids).size !== ids.length;
      })
    ) {
      return res
        .status(400)
        .json({
          success: false,
          code: "ADDON_QUANTITY_INVALID",
          message: "An add-on can only be selected once per item",
        });
    }

    const normalizedItems = await normalizeOrderItemsForPricing(
      storeId,
      order.type,
      order.items,
    );

    const selectedPromotionIds = Array.isArray(order.selectedPromotionIds)
      ? order.selectedPromotionIds.map(String)
      : [];
    if (selectedPromotionIds.length > 1)
      return res
        .status(400)
        .json({
          success: false,
          code: "MANUAL_PROMOTION_LIMIT",
          message: "Only one manual promotion may be selected",
        });
    const pricing = await calculatePromotionsForOrder(
      storeId,
      normalizedItems,
      selectedPromotionIds,
    );
    if (!matchesExpectedPromotionPricing(order.expectedPricing, pricing))
      return res
        .status(409)
        .json({
          success: false,
          code: "ORDER_PRICING_CHANGED",
          message: "Order pricing changed",
          data: {
            items: normalizedItems,
            pricing,
            reason: "CURRENT_PRICING_CHANGED",
          },
        });
    if (
      order.status === "paid" &&
      order.paymentMethod === "cash" &&
      !isCashReceivedSufficient(order.cashReceived, pricing.total)
    )
      return res
        .status(400)
        .json({
          success: false,
          code: "INSUFFICIENT_CASH",
          message: "Cash received is less than the order total",
        });
    const totalPrice = pricing.total;
    const periodId = await getCurrentOrderPeriodId(storeId);
    const sequence = await allocateOrderSequence(storeId, periodId);

    const newOrder = new Order({
      number: sequence,
      periodId,
      sequence,
      storeId,
      items: normalizedItems,
      totalPrice,
      ...(order.status === "paid" && order.paymentMethod === "cash"
        ? { cashReceived: order.cashReceived }
        : {}),
      ...(order.pickupAt ? { pickupAt: new Date(order.pickupAt) } : {}),
      status: order.status,
      type: order.type,
      paymentMethod: order.paymentMethod,
      appliedPromotions: pricing.appliedPromotions,
      customer: order.customer,
      ...(order.type === "dine_in"
        ? { table: String(order.table).trim() }
        : {}),
      source: order.source || "pos",
      ...(order.externalOrderId
        ? { externalOrderId: order.externalOrderId }
        : {}),
      paidAt: getPaidAt(order.status),
    });

    await newOrder.save();
    if (order.printOnConfirm !== false) {
      try {
        await createKitchenPrintJobs(newOrder);
      } catch (printError) {
        console.error("Failed to queue kitchen print jobs:", printError);
      }
    }
    emitStoreEvent(storeId, "order.created", {
      orderId: String(newOrder._id),
      source: newOrder.source,
    });

    const nextNumber = await getNextNumber(storeId);
    return res.status(201).json({ success: true, data: nextNumber });
  } catch (error) {
    const code = error instanceof Error ? error.message : undefined;
    if (code && orderInputErrorMessages[code]) {
      return res
        .status(400)
        .json({ success: false, code, message: orderInputErrorMessages[code] });
    }
    console.error("Error creating order:", error);
    res
      .status(500)
      .json({ success: false, message: "Error creating order", error });
  }
};
export const cancelOrder = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const storeId = (req as AuthRequest).user.storeId;
    const order = await Order.findOne({ _id: id, storeId });

    if (!order) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "Order not found",
      });
    }

    if (order.status === "cancelled") {
      return res.status(400).json({
        success: false,
        code: "ORDER_ALREADY_CANCELLED",
        message: "Order is already cancelled",
      });
    }

    if (order.paidAt) await assertFinancialPeriodOpen(storeId, order.paidAt);

    const updated = await Order.findOneAndUpdate(
      { _id: id, storeId, version: req.body.version },
      { $set: { status: "cancelled" }, $inc: { version: 1 } },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!updated)
      return res
        .status(409)
        .json({
          success: false,
          code: "ORDER_VERSION_CONFLICT",
          message: "Order was changed by another device",
        });

    emitStoreEvent(storeId, "order.cancelled", {
      orderId: String(updated._id),
      changedFields: ["status"],
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (error instanceof FinancialPeriodClosedError) {
      return res
        .status(error.statusCode)
        .json({
          success: false,
          code: error.code,
          message:
            "Order belongs to a confirmed closing period and cannot be changed",
        });
    }
    res.status(500).json({
      success: false,
      message: "Error cancelling order",
      error,
    });
  }
};

export const getOrders = async (req: Request, res: Response) => {
  try {
    const { days, from, to } = req.query;
    const storeId = (req as AuthRequest).user.storeId;
    const filter: any = { storeId };
    let paidAtFilter: { $gte?: Date; $gt?: Date; $lte: Date };
    if (from || to) {
      const fromDate = from ? new Date(String(from)) : undefined;
      const toDate = to ? new Date(String(to)) : new Date();
      if (
        (fromDate && Number.isNaN(fromDate.getTime())) ||
        Number.isNaN(toDate.getTime())
      )
        return res
          .status(400)
          .json({ success: false, message: "Invalid order date range" });
      paidAtFilter = { ...(fromDate ? { $gte: fromDate } : {}), $lte: toDate };
    } else if (days) {
      const daysNumber = Number(days);
      const { start } = getFromDayUntilNow(daysNumber);
      paidAtFilter = { $gte: start, $lte: new Date() };
    } else {
      const [latestClosing, store] = await Promise.all([
        DailyClosing.findOne({ storeId, status: { $ne: "voided" } })
          .sort({ periodEnd: -1, createdAt: -1 })
          .select({ periodEnd: 1 })
          .lean(),
        Store.findById(storeId).select({ createdAt: 1 }).lean(),
      ]);
      paidAtFilter = latestClosing
        ? { $gt: latestClosing.periodEnd, $lte: new Date() }
        : {
            $gte: store?.createdAt ?? getFromDayUntilNow(0).start,
            $lte: new Date(),
          };
    }
    filter.$or = [
      { status: "pending" },
      { status: { $in: ["paid", "cancelled"] }, paidAt: paidAtFilter },
    ];
    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching orders", error });
  }
};

export const getOrderById = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    const order = await Order.findOne({
      _id: id,
      storeId: (req as AuthRequest).user.storeId,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error fetching order",
      error,
    });
  }
};

export const printKitchenOrder = async (req: Request, res: Response) => {
  try {
    const order = await Order.findOne({
      _id: String(req.params.id),
      storeId: (req as AuthRequest).user.storeId,
    });
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    await createKitchenPrintJobs(order);
    res
      .status(202)
      .json({ success: true, message: "Kitchen print job queued" });
  } catch (error) {
    console.error("Error queueing kitchen print job:", error);
    res
      .status(500)
      .json({
        success: false,
        message: "Error queueing kitchen print job",
        error,
      });
  }
};

export const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { status, version, expectedPricing, cashReceived } = req.body;
    const storeId = (req as AuthRequest).user.storeId;
    const order = await Order.findOne({ _id: id, storeId })
      .select({
        paidAt: 1,
        status: 1,
        type: 1,
        items: 1,
        appliedPromotions: 1,
        paymentMethod: 1,
      })
      .lean();
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (order.paidAt) await assertFinancialPeriodOpen(storeId, order.paidAt);

    let pricingUpdate: Record<string, unknown> = {};
    if (status === "paid") {
      if (order.status !== "pending")
        return res
          .status(409)
          .json({
            success: false,
            code: "ORDER_VERSION_CONFLICT",
            message: "Only pending orders can be paid",
          });
      const normalizedItems = await normalizeOrderItemsForPricing(
        storeId,
        order.type,
        order.items,
      );
      const selectedPromotionIds = (order.appliedPromotions || [])
        .filter((promotion: any) => promotion.mode === "manual")
        .map((promotion: any) => String(promotion.promotionId));
      const pricing = await calculatePromotionsForOrder(
        storeId,
        normalizedItems,
        selectedPromotionIds,
      );
      if (!matchesExpectedPromotionPricing(expectedPricing, pricing))
        return res
          .status(409)
          .json({
            success: false,
            code: "ORDER_PRICING_CHANGED",
            message: "Order pricing changed",
            data: {
              items: normalizedItems,
              pricing,
              reason: "CURRENT_PRICING_CHANGED",
            },
          });
      if (
        order.paymentMethod === "cash" &&
        !isCashReceivedSufficient(cashReceived, pricing.total)
      )
        return res
          .status(400)
          .json({
            success: false,
            code: "INSUFFICIENT_CASH",
            message: "Cash received is less than the order total",
          });
      pricingUpdate = {
        items: normalizedItems,
        totalPrice: pricing.total,
        appliedPromotions: pricing.appliedPromotions,
        ...(order.paymentMethod === "cash" ? { cashReceived } : {}),
      };
    }

    const updated = await Order.findOneAndUpdate(
      { _id: id, storeId, version },
      {
        $set: {
          status,
          ...pricingUpdate,
          ...(status === "paid" ? { paidAt: getPaidAt("paid") } : {}),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!updated)
      return res
        .status(409)
        .json({
          success: false,
          code: "ORDER_VERSION_CONFLICT",
          message: "Order was changed by another device",
        });

    emitStoreEvent(storeId, "order.updated", {
      orderId: String(updated._id),
      changedFields: ["status"],
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (error instanceof FinancialPeriodClosedError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(400).json({
      success: false,
      message: "Error updating order",
      error,
    });
  }
};
export const updateOrderPayment = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { paymentMethod, version } = req.body;
    const storeId = (req as AuthRequest).user.storeId;
    const order = await Order.findOne({ _id: id, storeId })
      .select({ paidAt: 1, status: 1 })
      .lean();
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    if (order.status !== "paid")
      return res
        .status(400)
        .json({
          success: false,
          code: "ORDER_NOT_PAID",
          message: "Only paid orders can change payment method",
        });
    if (order.paidAt) await assertFinancialPeriodOpen(storeId, order.paidAt);
    const updated = await Order.findOneAndUpdate(
      { _id: id, storeId, version },
      { $set: { paymentMethod }, $inc: { version: 1 } },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!updated)
      return res
        .status(409)
        .json({
          success: false,
          code: "ORDER_VERSION_CONFLICT",
          message: "Order was changed by another device",
        });

    emitStoreEvent(storeId, "order.payment.updated", {
      orderId: String(updated._id),
      changedFields: ["paymentMethod"],
    });

    res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (error instanceof FinancialPeriodClosedError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    res.status(400).json({
      success: false,
      message: "Error updating order",
      error,
    });
  }
};

/** Updates a pending order from the POS while preserving its number and financial period. */
export const updatePendingOrder = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const {
      items,
      type,
      table,
      selectedPromotionIds,
      expectedPricing,
      paymentMethod,
      version,
      pickupAt,
    } = req.body;
    const storeId = (req as AuthRequest).user.storeId;

    if (!Array.isArray(items) || items.length === 0) {
      return res
        .status(400)
        .json({
          success: false,
          code: "ITEMS_REQUIRED",
          message: "Items is required",
        });
    }
    if (type === "dine_in" && !String(table || "").trim()) {
      return res
        .status(400)
        .json({
          success: false,
          code: "TABLE_REQUIRED",
          message: "A table is required for dine-in orders",
        });
    }

    const itemIds = [
      ...new Set<string>(items.map((item: any) => String(item.id))),
    ];
    const validItemIds = itemIds.filter((itemId) =>
      mongoose.isValidObjectId(itemId),
    );
    if (validItemIds.length !== itemIds.length)
      return res
        .status(400)
        .json({
          success: false,
          code: "ITEM_NOT_AVAILABLE",
          message: "One or more selected products are no longer available",
        });
    await StoreItem.updateMany(
      {
        storeId,
        temporarilyUnavailable: true,
        temporarilyUnavailableUntil: { $lte: new Date() },
      },
      {
        $set: { temporarilyUnavailable: false },
        $unset: { temporarilyUnavailableUntil: 1 },
      },
    );
    const availableItems = await StoreItem.countDocuments({
      storeId,
      itemId: { $in: validItemIds },
      permanentlyActive: { $ne: false },
      temporarilyUnavailable: false,
      "visibility.pos": { $ne: false },
    });
    if (availableItems !== validItemIds.length)
      return res
        .status(400)
        .json({
          success: false,
          code: "ITEM_NOT_AVAILABLE",
          message: "One or more selected products are no longer available",
        });

    const addonIds = [
      ...new Set<string>(
        items.flatMap((item: any) =>
          Array.isArray(item.addons)
            ? item.addons.map((addon: any) => String(addon.id))
            : [],
        ),
      ),
    ];
    const validAddonIds = addonIds.filter((addonId) =>
      mongoose.isValidObjectId(addonId),
    );
    if (validAddonIds.length !== addonIds.length)
      return res
        .status(400)
        .json({
          success: false,
          code: "ADDON_NOT_AVAILABLE",
          message: "One or more selected add-ons are no longer available",
        });
    if (validAddonIds.length) {
      await StoreAddon.updateMany(
        {
          storeId,
          temporarilyUnavailable: true,
          temporarilyUnavailableUntil: { $lte: new Date() },
        },
        {
          $set: { temporarilyUnavailable: false },
          $unset: { temporarilyUnavailableUntil: 1 },
        },
      );
      const availableAddons = await StoreAddon.countDocuments({
        storeId,
        addonId: { $in: validAddonIds },
        permanentlyActive: { $ne: false },
        temporarilyUnavailable: false,
      });
      if (availableAddons !== validAddonIds.length)
        return res
          .status(400)
          .json({
            success: false,
            code: "ADDON_NOT_AVAILABLE",
            message: "One or more selected add-ons are no longer available",
          });
    }

    for (const item of items) {
      const selectedAddonIds = (item.addons || []).map((addon: any) =>
        String(addon.id),
      );
      if (new Set(selectedAddonIds).size !== selectedAddonIds.length)
        return res
          .status(400)
          .json({
            success: false,
            code: "ADDON_QUANTITY_INVALID",
            message: "An add-on can only be selected once per item",
          });
    }

    const selectedIds = Array.isArray(selectedPromotionIds)
      ? selectedPromotionIds.map(String)
      : [];
    if (selectedIds.length > 1)
      return res
        .status(400)
        .json({
          success: false,
          code: "MANUAL_PROMOTION_LIMIT",
          message: "Only one manual promotion may be selected",
        });
    const normalizedItems = await normalizeOrderItemsForPricing(
      storeId,
      type,
      items,
    );
    const pricing = await calculatePromotionsForOrder(
      storeId,
      normalizedItems,
      selectedIds,
    );
    if (!matchesExpectedPromotionPricing(expectedPricing, pricing))
      return res
        .status(409)
        .json({
          success: false,
          code: "ORDER_PRICING_CHANGED",
          message: "Order pricing changed",
          data: {
            items: normalizedItems,
            pricing,
            reason: "CURRENT_PRICING_CHANGED",
          },
        });
    const updated = await Order.findOneAndUpdate(
      { _id: id, storeId, status: "pending", version },
      {
        $set: {
          items: normalizedItems,
          type,
          table: type === "dine_in" ? String(table).trim() : "",
          appliedPromotions: pricing.appliedPromotions,
          paymentMethod,
          ...(pickupAt ? { pickupAt: new Date(pickupAt) } : {}),
          totalPrice: pricing.total,
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!updated)
      return res
        .status(409)
        .json({
          success: false,
          code: "ORDER_VERSION_CONFLICT",
          message:
            "Order was changed by another device or is no longer pending",
        });

    emitStoreEvent(storeId, "order.updated", {
      orderId: String(updated._id),
      changedFields: [
        "items",
        "type",
        "table",
        "appliedPromotions",
        "paymentMethod",
        "totalPrice",
      ],
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating pending order:", error);
    res
      .status(400)
      .json({ success: false, message: "Error updating order", error });
  }
};

/** Updates contact metadata only; this never changes pricing or payment state. */
export const updateOrderCustomer = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const storeId = (req as AuthRequest).user.storeId;
    const customer = req.body?.customer;
    if (!customer || typeof customer !== "object")
      return res
        .status(400)
        .json({
          success: false,
          code: "CUSTOMER_REQUIRED",
          message: "Customer details are required",
        });

    const name =
      typeof customer.name === "string"
        ? customer.name.trim().slice(0, 120)
        : "";
    const phone =
      typeof customer.phone === "string"
        ? customer.phone.trim().slice(0, 40)
        : "";
    const pickupAt =
      typeof req.body?.pickupAt === "string" &&
      !Number.isNaN(Date.parse(req.body.pickupAt))
        ? new Date(req.body.pickupAt)
        : undefined;
    const updated = await Order.findOneAndUpdate(
      { _id: id, storeId, customer: { $ne: null } },
      {
        $set: {
          "customer.name": name,
          "customer.phone": phone,
          ...(pickupAt ? { pickupAt } : {}),
        },
        $inc: { version: 1 },
      },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!updated)
      return res
        .status(404)
        .json({
          success: false,
          code: "CUSTOMER_NOT_AVAILABLE",
          message: "Customer details are not available for this order",
        });

    emitStoreEvent(storeId, "order.updated", {
      orderId: String(updated._id),
      changedFields: ["customer", ...(pickupAt ? ["pickupAt"] : [])],
    });
    res.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating order customer:", error);
    res
      .status(400)
      .json({
        success: false,
        message: "Error updating customer details",
        error,
      });
  }
};
