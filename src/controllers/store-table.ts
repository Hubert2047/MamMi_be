import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import type { AuthRequest } from "../middlewares/auth.js";
import StoreTable from "../models/store-table.js";
import TableSession from "../models/table-session.js";
import {
  TABLE_SESSION_DURATION_MS,
  tableSessionExpiry,
} from "../utils/tableSession.js";

const expireSessions = (storeId: string) =>
  TableSession.updateMany(
    { storeId, status: "active", expiresAt: { $lte: new Date() } },
    { $set: { status: "expired" } },
  );
const serializeSession = (session: any) =>
  session
    ? {
        _id: String(session._id),
        status: session.status,
        openedAt: session.openedAt,
        expiresAt: session.expiresAt,
        lastExtendedAt: session.lastExtendedAt,
        closedAt: session.closedAt,
      }
    : null;

export const getStoreTables = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    await expireSessions(storeId);
    const tables = await StoreTable.find({ storeId })
      .select({ code: 1, name: 1, active: 1, qrToken: 1 })
      .lean();
    tables.sort((left, right) => {
      const leftCode = Number(String(left.code).trim());
      const rightCode = Number(String(right.code).trim());
      if (Number.isFinite(leftCode) && Number.isFinite(rightCode))
        return leftCode - rightCode;
      return String(left.code).localeCompare(String(right.code), undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    const sessions = await TableSession.find({
      storeId,
      tableId: { $in: tables.map((table) => table._id) },
      status: "active",
    }).lean();
    const sessionsByTable = new Map(
      sessions.map((session) => [String(session.tableId), session]),
    );
    res.json({
      success: true,
      data: tables.map((table) => ({
        ...table,
        session: serializeSession(
          sessionsByTable.get(String(table._id)) ?? null,
        ),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Unable to fetch tables" });
  }
};

export const openStoreTableSession = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    await expireSessions(storeId);
    const table = await StoreTable.findOne({
      _id: String(req.params.id),
      storeId,
      active: true,
    })
      .select({ _id: 1 })
      .lean();
    if (!table)
      return res
        .status(404)
        .json({
          success: false,
          code: "TABLE_NOT_FOUND",
          message: "Table not found",
        });
    const existing = await TableSession.findOne({
      storeId,
      tableId: table._id,
      status: "active",
    }).lean();
    if (existing)
      return res.json({ success: true, data: serializeSession(existing) });
    const now = new Date();
    const session = await TableSession.create({
      storeId,
      tableId: table._id,
      status: "active",
      openedAt: now,
      expiresAt: tableSessionExpiry(now),
    });
    res.status(201).json({ success: true, data: serializeSession(session) });
  } catch (error: any) {
    if (error?.code === 11000) {
      const session = await TableSession.findOne({
        storeId: (req as AuthRequest).user.storeId,
        tableId: String(req.params.id),
        status: "active",
      }).lean();
      if (session)
        return res.json({ success: true, data: serializeSession(session) });
    }
    res
      .status(400)
      .json({ success: false, message: "Unable to open table session" });
  }
};

export const extendStoreTableSession = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    await expireSessions(storeId);
    const session = await TableSession.findOne({
      storeId,
      tableId: String(req.params.id),
      status: "active",
    });
    if (!session)
      return res
        .status(409)
        .json({
          success: false,
          code: "SESSION_NOT_ACTIVE",
          message: "Table session is not active",
        });
    const now = new Date();
    const base = Math.max(session.expiresAt.getTime(), now.getTime());
    session.expiresAt = new Date(base + TABLE_SESSION_DURATION_MS);
    session.lastExtendedAt = now;
    await session.save();
    res.json({ success: true, data: serializeSession(session) });
  } catch {
    res
      .status(400)
      .json({ success: false, message: "Unable to extend table session" });
  }
};

export const closeStoreTableSession = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    await expireSessions(storeId);
    const session = await TableSession.findOneAndUpdate(
      { storeId, tableId: String(req.params.id), status: "active" },
      { $set: { status: "closed", closedAt: new Date() } },
      { new: true },
    ).lean();
    if (!session)
      return res
        .status(409)
        .json({
          success: false,
          code: "SESSION_NOT_ACTIVE",
          message: "Table session is not active",
        });
    res.json({ success: true, data: serializeSession(session) });
  } catch {
    res
      .status(400)
      .json({ success: false, message: "Unable to close table session" });
  }
};

export const createStoreTable = async (req: Request, res: Response) => {
  try {
    const code = String(req.body.code || "").trim();
    const name = String(req.body.name || code).trim();
    if (!code || !name)
      return res
        .status(400)
        .json({ success: false, message: "Table code is required" });
    const storeId = (req as AuthRequest).user.storeId;
    const inactiveTable = await StoreTable.findOne({
      storeId,
      code,
      active: false,
    });
    if (inactiveTable) {
      inactiveTable.name = name;
      inactiveTable.active = true;
      inactiveTable.qrToken = randomBytes(24).toString("base64url");
      await inactiveTable.save();
      return res.status(201).json({ success: true, data: inactiveTable });
    }
    const table = await StoreTable.create({ storeId, code, name });
    res.status(201).json({ success: true, data: table });
  } catch (error: any) {
    if (error?.code === 11000)
      return res
        .status(409)
        .json({ success: false, message: "This table code already exists" });
    res.status(400).json({ success: false, message: "Unable to create table" });
  }
};

export const updateStoreTable = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    const table = await StoreTable.findOne({
      _id: String(req.params.id),
      storeId,
    });
    if (!table)
      return res
        .status(404)
        .json({ success: false, message: "Table not found" });
    if (req.body.code !== undefined) {
      const code = String(req.body.code || "").trim();
      if (!code)
        return res
          .status(400)
          .json({ success: false, message: "Table code is required" });
      table.code = code;
    }
    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name)
        return res
          .status(400)
          .json({ success: false, message: "Table name is required" });
      table.name = name;
    }
    if (req.body.active !== undefined) {
      const active = Boolean(req.body.active);
      if (!active) {
        await expireSessions(storeId);
        const activeSession = await TableSession.exists({
          storeId,
          tableId: table._id,
          status: "active",
        });
        if (activeSession)
          return res
            .status(409)
            .json({
              success: false,
              code: "TABLE_SESSION_ACTIVE",
              message:
                "Close the active table session before deactivating the table",
            });
      }
      table.active = active;
    }
    await table.save();
    res.json({ success: true, data: table });
  } catch (error: any) {
    if (error?.code === 11000)
      return res
        .status(409)
        .json({ success: false, message: "This table code already exists" });
    res.status(400).json({ success: false, message: "Unable to update table" });
  }
};

export const regenerateStoreTableQr = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    const table = await StoreTable.findOneAndUpdate(
      { _id: String(req.params.id), storeId, active: true },
      { $set: { qrToken: randomBytes(24).toString("base64url") } },
      { new: true, runValidators: true },
    ).lean();
    if (!table)
      return res
        .status(404)
        .json({ success: false, message: "Table not found" });
    res.json({ success: true, data: table });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: "Unable to regenerate QR code" });
  }
};

export const regenerateAllStoreTableQr = async (
  req: Request,
  res: Response,
) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    const tables = await StoreTable.find({ storeId, active: true })
      .select({ _id: 1 })
      .lean();
    if (tables.length > 0) {
      await StoreTable.bulkWrite(
        tables.map((table) => ({
          updateOne: {
            filter: { _id: table._id },
            update: {
              $set: { qrToken: randomBytes(24).toString("base64url") },
            },
          },
        })),
      );
    }
    res.json({ success: true, data: { count: tables.length } });
  } catch (error) {
    res
      .status(400)
      .json({ success: false, message: "Unable to regenerate QR codes" });
  }
};
