import type { Request, Response } from "express";
import Revenue from "../models/revenue.js";
import DailyClosing from "../models/daily-closing.js";
import Store from "../models/store.js";
import { getFromDayUntilNow } from "../utils/index.js";
import {
  assertFinancialPeriodOpen,
  FinancialPeriodClosedError,
} from "../services/financialPeriodLock.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { emitStoreEvent } from "../realtime.js";
export const createRevenue = async (req: Request, res: Response) => {
  try {
    const { name, price, note, paymentMethod = "cash" } = req.body;
    const revenue = new Revenue({
      storeId: (req as AuthRequest).user.storeId,
      name,
      price,
      note,
      paymentMethod,
    });
    await revenue.save();
    emitStoreEvent(String(revenue.storeId), "revenue.created", {
      revenueId: String(revenue._id),
    });
    res.status(201).json({ success: true, data: revenue });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Error creating Revenue", error });
  }
};

export const getRevenues = async (req: Request, res: Response) => {
  try {
    const { days, from, to } = req.query;
    const storeId = (req as AuthRequest).user.storeId;
    const filter: any = { storeId };
    if (from || to) {
      const fromDate = from ? new Date(String(from)) : undefined;
      const toDate = to ? new Date(String(to)) : new Date();
      if (
        (fromDate && Number.isNaN(fromDate.getTime())) ||
        Number.isNaN(toDate.getTime())
      )
        return res
          .status(400)
          .json({ success: false, message: "Invalid revenue date range" });
      filter.createdAt = {
        ...(fromDate ? { $gte: fromDate } : {}),
        $lte: toDate,
      };
    } else if (days) {
      const daysNumber = Number(days);
      const { start } = getFromDayUntilNow(daysNumber);
      filter.createdAt = { $gte: start };
    } else {
      const [latestClosing, store] = await Promise.all([
        DailyClosing.findOne({ storeId, status: { $ne: "voided" } })
          .sort({ periodEnd: -1, createdAt: -1 })
          .select({ periodEnd: 1 })
          .lean(),
        Store.findById(storeId).select({ createdAt: 1 }).lean(),
      ]);
      filter.createdAt = latestClosing
        ? { $gt: latestClosing.periodEnd, $lte: new Date() }
        : {
            $gte: store?.createdAt ?? getFromDayUntilNow(0).start,
            $lte: new Date(),
          };
    }
    const revenues = await Revenue.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: revenues });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Error fetching Revenue", error });
  }
};
export const deleteRevenue = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const storeId = (req as AuthRequest).user.storeId;
    const revenue = await Revenue.findOne({ _id: id, storeId })
      .select({ createdAt: 1 })
      .lean();
    if (!revenue)
      return res
        .status(404)
        .json({ success: false, message: "Revenue not found" });
    await assertFinancialPeriodOpen(storeId, revenue.createdAt);

    const deletedRevenue = await Revenue.findOneAndDelete({ _id: id, storeId });

    if (!deletedRevenue) {
      return res.status(404).json({
        success: false,
        message: "Revenue not found",
      });
    }

    emitStoreEvent(storeId, "revenue.deleted", {
      revenueId: String(deletedRevenue._id),
    });

    res.json({
      success: true,
      message: "Revenue deleted successfully",
      data: deletedRevenue,
    });
  } catch (error) {
    if (error instanceof FinancialPeriodClosedError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }

    res.status(500).json({
      success: false,
      message: "Error deleting Revenue",
      error,
    });
  }
};

export const updateRevenue = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const storeId = (req as AuthRequest).user.storeId;
    const data = req.body;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Thiếu id",
      });
    }
    const revenue = await Revenue.findOne({ _id: id, storeId })
      .select({ createdAt: 1 })
      .lean();
    if (!revenue)
      return res
        .status(404)
        .json({ success: false, message: "Revenue not found" });
    await assertFinancialPeriodOpen(storeId, revenue.createdAt);

    const updated = await Revenue.findOneAndUpdate(
      { _id: id, storeId },
      {
        ...data,
        price: Number(data.price),
      },
      {
        returnDocument: "after",
        runValidators: true,
      },
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy Revenue",
      });
    }

    emitStoreEvent(storeId, "revenue.updated", {
      revenueId: String(updated._id),
    });

    return res.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (error instanceof FinancialPeriodClosedError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }

    return res.status(500).json({
      success: false,
      message: "Error updating Revenue",
      error,
    });
  }
};
