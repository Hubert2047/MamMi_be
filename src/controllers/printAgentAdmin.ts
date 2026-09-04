import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import PrintAgent from "../models/print-agent.js";
import Printer from "../models/printer.js";
import PrintRouting from "../models/print-routing.js";
import PrintJob from "../models/print-job.js";
import type { AuthRequest } from "../middlewares/auth.js";
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
const storeId = (req: Request) => (req as AuthRequest).user.storeId;
const normalizeHex = (value: unknown) => {
  const hex = String(value ?? "").trim();
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex))
    throw new Error("Print command must be an even-length hexadecimal string");
  return hex.toUpperCase();
};
const receiptCutSettings = (input: any, profile: string, current: any = {}) => {
  if (profile !== "receipt-escpos" || input?.cutEnabled !== true)
    return { cutEnabled: false };
  return {
    cutEnabled: true,
    cutFeedHex: normalizeHex(input.cutFeedHex ?? current.cutFeedHex),
    cutCommandHex: normalizeHex(input.cutCommandHex ?? current.cutCommandHex),
  };
};
const agentPublic = (a: any, printers: any[] = []) => ({
  _id: a._id,
  name: a.name,
  agentId: a.agentId,
  tokenPrefix: a.tokenPrefix,
  active: a.active,
  lastSeenAt: a.lastSeenAt,
  printers,
});
export const listPrintAgents = async (req: Request, res: Response) => {
  const sid = storeId(req);
  const [agents, printers, routing] = await Promise.all([
    PrintAgent.find({ storeId: sid }).lean(),
    Printer.find({ storeId: sid }).lean(),
    PrintRouting.findOne({ storeId: sid }).lean(),
  ]);
  res.json({
    success: true,
    data: {
      agents: agents.map((a) =>
        agentPublic(
          a,
          printers.filter((p) => String(p.agentId) === String(a._id)),
        ),
      ),
      routing: routing || {},
    },
  });
};
export const createPrintAgent = async (req: Request, res: Response) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ message: "Agent name is required" });
  if (await PrintAgent.exists({ storeId: storeId(req) }))
    return res
      .status(409)
      .json({ message: "This store already has a print agent" });
  const token = randomBytes(32).toString("base64url");
  const agent = await PrintAgent.create({
    storeId: storeId(req),
    name,
    agentId: `agent_${randomBytes(8).toString("hex")}`,
    tokenHash: hash(token),
    tokenPrefix: token.slice(0, 8),
  });
  res
    .status(201)
    .json({ success: true, data: { ...agentPublic(agent.toObject()), token } });
};
export const createPrinter = async (req: Request, res: Response) => {
  const sid = storeId(req);
  const agent = await PrintAgent.findOne({
    _id: String(req.params.id),
    storeId: sid,
  });
  if (!agent) return res.status(404).json({ message: "Agent not found" });
  const {
    name,
    windowsPrinterName,
    profile = "kitchen-label-tspl",
    printerDpi = 203,
    labelWidthMm = 58,
    labelHeightMm = 40,
    labelGapMm = 2,
  } = req.body || {};
  if (!name || !windowsPrinterName)
    return res.status(400).json({ message: "Printer name is required" });
  try {
    const labelSettings =
      profile === "receipt-escpos" ? {} : { labelHeightMm, labelGapMm };
    const printer = await Printer.create({
      storeId: sid,
      agentId: agent._id,
      name,
      windowsPrinterName,
      profile,
      printerDpi,
      labelWidthMm,
      ...labelSettings,
      ...receiptCutSettings(req.body, profile),
    });
    return res.status(201).json({ success: true, data: printer });
  } catch (error) {
    return res
      .status(400)
      .json({
        message:
          error instanceof Error ? error.message : "Invalid printer settings",
      });
  }
};
export const updatePrintAgent = async (req: Request, res: Response) => {
  const agent = await PrintAgent.findOneAndUpdate(
    { _id: String(req.params.id), storeId: storeId(req) },
    {
      $set: {
        ...(req.body?.name !== undefined
          ? { name: String(req.body.name).trim() }
          : {}),
        ...(req.body?.active !== undefined
          ? { active: Boolean(req.body.active) }
          : {}),
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!agent) return res.status(404).json({ message: "Agent not found" });
  res.json({ success: true, data: agentPublic(agent) });
};
export const updatePrinter = async (req: Request, res: Response) => {
  const printer = await Printer.findOne({
    _id: String(req.params.printerId),
    storeId: storeId(req),
    agentId: String(req.params.id),
  });
  if (!printer) return res.status(404).json({ message: "Printer not found" });
  const allowed = [
    "name",
    "windowsPrinterName",
    "profile",
    "printerDpi",
    "labelWidthMm",
    "labelHeightMm",
    "labelGapMm",
    "cutEnabled",
    "cutFeedHex",
    "cutCommandHex",
    "active",
  ];
  for (const key of allowed)
    if (req.body?.[key] !== undefined) (printer as any)[key] = req.body[key];
  try {
    if (printer.profile === "receipt-escpos") {
      printer.set("labelHeightMm", undefined);
      printer.set("labelGapMm", undefined);
    }
    const cutSettings = receiptCutSettings(
      req.body?.cutEnabled === undefined
        ? { ...req.body, cutEnabled: printer.cutEnabled }
        : req.body,
      printer.profile,
      printer,
    );
    Object.assign(printer, cutSettings);
    if (!cutSettings.cutEnabled) {
      printer.set("cutFeedHex", undefined);
      printer.set("cutCommandHex", undefined);
    }
    await printer.save();
    return res.json({ success: true, data: printer });
  } catch (error) {
    return res
      .status(400)
      .json({
        message:
          error instanceof Error ? error.message : "Invalid printer settings",
      });
  }
};
export const createPrinterTestJob = async (req: Request, res: Response) => {
  const sid = storeId(req);
  const printer = await Printer.findOne({
    _id: String(req.params.printerId),
    storeId: sid,
    agentId: String(req.params.id),
    active: true,
  });
  if (!printer)
    return res.status(404).json({ message: "Active printer not found" });
  const agent = await PrintAgent.findOne({
    _id: printer.agentId,
    storeId: sid,
    active: true,
  });
  if (!agent)
    return res.status(409).json({ message: "Print agent is inactive" });
  const printableText = String(
    req.body?.printableText ?? "列印測試\n印表機連線正常",
  ).trim();
  if (!printableText)
    return res.status(400).json({ message: "Test print text is required" });
  const fontSize = Math.min(48, Math.max(8, Number(req.body?.fontSize) || 40));
  const bold = req.body?.bold === true;
  const copies = Math.min(50, Math.max(1, Number(req.body?.copies) || 1));
  const job = await PrintJob.create({
    storeId: sid,
    printerId: printer._id,
    kind: "test",
    payload: { printableText, fontSize, bold, copies },
    retentionUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  res.status(201).json({ success: true, data: job });
};
export const updatePrintRouting = async (req: Request, res: Response) => {
  const sid = storeId(req);
  const data = {
    kitchenPrinterId: req.body?.kitchenPrinterId || undefined,
    receiptPrinterId: req.body?.receiptPrinterId || undefined,
    fapiaoPrinterId: req.body?.fapiaoPrinterId || undefined,
  };
  const routing = await PrintRouting.findOneAndUpdate(
    { storeId: sid },
    { $set: data },
    { upsert: true, returnDocument: "after" },
  ).lean();
  res.json({ success: true, data: routing });
};
export const rotatePrintAgentToken = async (req: Request, res: Response) => {
  const token = randomBytes(32).toString("base64url");
  const agent = await PrintAgent.findOneAndUpdate(
    { _id: String(req.params.id), storeId: storeId(req) },
    { $set: { tokenHash: hash(token), tokenPrefix: token.slice(0, 8) } },
    { returnDocument: "after" },
  ).lean();
  if (!agent) return res.status(404).json({ message: "Agent not found" });
  res.json({ success: true, data: { ...agentPublic(agent), token } });
};
export const getAgentConfig = async (req: Request, res: Response) => {
  const a = (req as any).printAgent;
  const printers = await Printer.find({
    storeId: a.storeId,
    agentId: a.agentDbId,
    active: true,
  }).lean();
  res.json({ success: true, data: { printers } });
};
