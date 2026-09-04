import type { Request, Response } from "express";
import InventoryItem from "../models/inventory-item.js";
import InventoryStocktake from "../models/inventory-stocktake.js";
import type { AuthRequest } from "../middlewares/auth.js";

export const getInventoryStock = async (req: Request, res: Response) => {
  const storeId = (req as AuthRequest).user.storeId;
  const items = await InventoryItem.find({
    storeId,
    active: true,
    inventoryStatus: { $ne: "pending" },
  })
    .sort({ name: 1 })
    .lean();
  res.json({ success: true, data: items });
};

export const getInventoryStocktakes = async (req: Request, res: Response) => {
  const storeId = (req as AuthRequest).user.storeId;
  const stocktakes = await InventoryStocktake.find({ storeId })
    .sort({ checkedAt: -1 })
    .populate("lines.inventoryItemId", "name")
    .lean();
  res.json({ success: true, data: stocktakes });
};

export const createInventoryStocktake = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    const { checkedAt, lines } = req.body;
    if (!Array.isArray(lines) || !lines.length)
      return res
        .status(400)
        .json({
          success: false,
          message: "At least one stocktake line is required",
        });
    const stocktakeDate = checkedAt ? new Date(checkedAt) : new Date();
    if (Number.isNaN(stocktakeDate.getTime()))
      return res
        .status(400)
        .json({ success: false, message: "Invalid stocktake date" });
    const items = await InventoryItem.find({
      _id: { $in: lines.map((line: any) => line.inventoryItemId) },
      storeId,
      active: true,
      inventoryStatus: { $ne: "pending" },
    }).lean();
    const itemMap = new Map(items.map((item) => [String(item._id), item]));
    const normalized = lines.map((line: any) => {
      const item = itemMap.get(String(line.inventoryItemId));
      const actualQuantity = Number(line.actualQuantity);
      if (!item || !Number.isFinite(actualQuantity) || actualQuantity < 0)
        throw new Error("Invalid stocktake line");
      const systemQuantity = item.currentQuantity || 0;
      return {
        inventoryItemId: item._id,
        stockUnitCode: item.stockUnitCode,
        systemQuantity,
        actualQuantity,
        difference: actualQuantity - systemQuantity,
        reason: line.reason || "",
      };
    });
    const stocktake = await InventoryStocktake.create({
      storeId,
      checkedAt: stocktakeDate,
      lines: normalized,
    });
    await Promise.all(
      normalized.map((line) =>
        InventoryItem.updateOne(
          { _id: line.inventoryItemId, storeId },
          {
            $set: {
              currentQuantity: line.actualQuantity,
              lastStocktakeAt: stocktakeDate,
            },
          },
        ),
      ),
    );
    return res.status(201).json({ success: true, data: stocktake });
  } catch (error: any) {
    return res
      .status(400)
      .json({
        success: false,
        message: error?.message || "Error creating stocktake",
      });
  }
};
