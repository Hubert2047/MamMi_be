import type { Request, Response } from "express";
import Unit from "../models/unit.js";
import { expenseUnits } from "../config/units.js";
import { Role } from "../middlewares/auth.js";
import type { AuthRequest } from "../middlewares/auth.js";
import { emitCatalogEventToStores } from "../realtime.js";

export const ensureDefaultUnits = async () => {
  await Unit.bulkWrite(
    expenseUnits.map((unit) => ({
      updateOne: {
        filter: { code: unit.code },
        update: { $setOnInsert: { ...unit, active: true } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
};

export const getUnits = async (_req: Request, res: Response) => {
  const authUser = (_req as AuthRequest).user;
  const units = await Unit.find(
    authUser?.role === Role.SuperAdmin && _req.query.all === "true"
      ? {}
      : { active: true },
  )
    .sort({ category: 1, code: 1 })
    .lean();
  res.json({ success: true, data: units });
};

export const createUnit = async (req: Request, res: Response) => {
  try {
    const { code, names, category } = req.body;
    const unit = await Unit.create({ code, names, category, active: true });
    await emitCatalogEventToStores("inventory.unit.updated", {
      unitId: String(unit._id),
      changedFields: ["created"],
    });
    return res.status(201).json({ success: true, data: unit });
  } catch (error: any) {
    return res
      .status(error?.code === 11000 ? 409 : 400)
      .json({
        success: false,
        message:
          error?.code === 11000 ? "Unit code already exists" : "Invalid unit",
      });
  }
};

export const updateUnit = async (req: Request, res: Response) => {
  try {
    const { code, names, category, active } = req.body;
    const unit = await Unit.findByIdAndUpdate(
      req.params.id,
      { $set: { code, names, category, active } },
      { new: true, runValidators: true },
    );
    if (!unit)
      return res
        .status(404)
        .json({ success: false, message: "Unit not found" });
    await emitCatalogEventToStores("inventory.unit.updated", {
      unitId: String(unit._id),
      changedFields: ["updated"],
    });
    return res.json({ success: true, data: unit });
  } catch (error: any) {
    return res
      .status(error?.code === 11000 ? 409 : 400)
      .json({
        success: false,
        message:
          error?.code === 11000 ? "Unit code already exists" : "Invalid unit",
      });
  }
};
