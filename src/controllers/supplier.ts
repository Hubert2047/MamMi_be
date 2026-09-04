import type { Request, Response } from "express";
import Supplier from "../models/supplier.js";
import LineGroup from "../models/line-group.js";
import mongoose from "mongoose";
import type { AuthRequest } from "../middlewares/auth.js";

const storeIdFor = (req: Request) => (req as AuthRequest).user.storeId;

const claimLineGroup = async (lineGroupId: unknown, storeId: unknown) => {
  if (!lineGroupId) return null;
  if (!mongoose.isValidObjectId(String(lineGroupId)))
    throw Object.assign(new Error("Invalid LINE group"), {
      code: "INVALID_LINE_GROUP",
    });
  const result = await LineGroup.updateOne(
    {
      _id: String(lineGroupId),
      storeId: String(storeId),
      usageStatus: "available",
    },
    { $set: { usageStatus: "assigned" } },
  );
  if (result.modifiedCount !== 1)
    throw Object.assign(new Error("LINE group is unavailable"), {
      code: "LINE_GROUP_IN_USE",
    });
  return new mongoose.Types.ObjectId(String(lineGroupId));
};

const releaseLineGroup = async (lineGroupId: unknown) => {
  if (lineGroupId)
    await LineGroup.updateOne(
      { _id: lineGroupId },
      { $set: { usageStatus: "available" } },
    );
};

export const getSuppliers = async (req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      data: await Supplier.find({ storeId: storeIdFor(req) })
        .sort({ active: -1, name: 1 })
        .lean(),
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching suppliers" });
  }
};

export const createSupplier = async (req: Request, res: Response) => {
  let claimedLineGroupId: mongoose.Types.ObjectId | null = null;
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "Supplier name is required" });
    claimedLineGroupId = await claimLineGroup(
      req.body.lineGroupId,
      storeIdFor(req),
    );
    const supplierData = {
      storeId: storeIdFor(req),
      name,
      contactPerson: req.body.contactPerson?.trim(),
      phone: req.body.phone?.trim(),
      address: req.body.address?.trim(),
      note: req.body.note?.trim(),
      active: req.body.active !== false,
      ...(claimedLineGroupId ? { lineGroupId: claimedLineGroupId } : {}),
    };
    const supplier = await Supplier.create(supplierData);
    return res.status(201).json({ success: true, data: supplier });
  } catch (error: any) {
    await releaseLineGroup(claimedLineGroupId);
    if (error?.code === "INVALID_LINE_GROUP")
      return res
        .status(400)
        .json({ success: false, code: error.code, message: error.message });
    if (error?.code === "LINE_GROUP_IN_USE")
      return res
        .status(409)
        .json({ success: false, code: error.code, message: error.message });
    if (error?.code === 11000)
      return res
        .status(409)
        .json({ success: false, message: "Supplier already exists" });
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Error creating supplier" });
  }
};

export const updateSupplier = async (req: Request, res: Response) => {
  let claimedLineGroupId: mongoose.Types.ObjectId | null = null;
  try {
    const id = String(req.params.id);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "Supplier name is required" });
    const previous = await Supplier.findOne({
      _id: id,
      storeId: storeIdFor(req),
    });
    if (!previous)
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found" });
    const requestedLineGroupId = req.body.lineGroupId || undefined;
    const sameLineGroup =
      String(previous.lineGroupId || "") === String(requestedLineGroupId || "");
    if (!sameLineGroup)
      claimedLineGroupId = await claimLineGroup(
        requestedLineGroupId,
        storeIdFor(req),
      );
    const update: Record<string, unknown> = {
      name,
      contactPerson: req.body.contactPerson?.trim(),
      phone: req.body.phone?.trim(),
      address: req.body.address?.trim(),
      note: req.body.note?.trim(),
      active: req.body.active !== false,
    };
    const updateOperation: Record<string, unknown> = { $set: update };
    if (claimedLineGroupId) update.lineGroupId = claimedLineGroupId;
    else if (!requestedLineGroupId) updateOperation.$unset = { lineGroupId: 1 };
    const supplier = await Supplier.findOneAndUpdate(
      { _id: id, storeId: storeIdFor(req) },
      updateOperation,
      { new: true, runValidators: true },
    );
    if (!supplier)
      return res
        .status(404)
        .json({ success: false, message: "Supplier not found" });
    if (!sameLineGroup) await releaseLineGroup(previous.lineGroupId);
    return res.json({ success: true, data: supplier });
  } catch (error: any) {
    await releaseLineGroup(claimedLineGroupId);
    if (error?.code === "INVALID_LINE_GROUP")
      return res
        .status(400)
        .json({ success: false, code: error.code, message: error.message });
    if (error?.code === "LINE_GROUP_IN_USE")
      return res
        .status(409)
        .json({ success: false, code: error.code, message: error.message });
    if (error?.code === 11000)
      return res
        .status(409)
        .json({ success: false, message: "Supplier already exists" });
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating supplier" });
  }
};

export const deleteSupplier = async (req: Request, res: Response) => {
  const supplier = await Supplier.findOneAndDelete({
    _id: String(req.params.id),
    storeId: storeIdFor(req),
  });
  if (!supplier)
    return res
      .status(404)
      .json({ success: false, message: "Supplier not found" });
  await releaseLineGroup(supplier.lineGroupId);
  return res.json({ success: true });
};
