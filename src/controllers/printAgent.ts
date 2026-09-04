import type { Request, Response } from "express";
import PrintJob from "../models/print-job.js";
import Printer from "../models/printer.js";
import type { PrintAgentRequest } from "../middlewares/printAgentAuth.js";

const retryAfterMs = 2 * 60 * 1000;
const retentionMs = 7 * 24 * 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function claimAvailableJob(
  storeId: string,
  printerIds: string[],
  agentId: string,
) {
  const now = new Date();
  return PrintJob.findOneAndUpdate(
    {
      storeId,
      printerId: { $in: printerIds },
      $or: [
        { status: "queued" },
        {
          status: "processing",
          lockedAt: { $lt: new Date(now.getTime() - retryAfterMs) },
        },
      ],
    },
    {
      $set: { status: "processing", agentId, lockedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  ).lean();
}

export const claimPrintJob = async (req: Request, res: Response) => {
  try {
    const { agentId, storeId, agentDbId } = (req as PrintAgentRequest)
      .printAgent;
    const printerIds = (
      await Printer.find({ storeId, agentId: agentDbId, active: true })
        .select({ _id: 1 })
        .lean()
    ).map((printer) => String(printer._id));
    if (!printerIds.length) return res.json({ success: true, data: null });
    const requestedWaitMs = Number(req.query.wait || 0);
    const waitMs = Number.isFinite(requestedWaitMs)
      ? Math.min(Math.max(requestedWaitMs, 0), 25000)
      : 0;
    const deadline = Date.now() + waitMs;
    let job = await claimAvailableJob(storeId, printerIds, agentId);
    while (!job && Date.now() < deadline) {
      await sleep(Math.min(1000, deadline - Date.now()));
      job = await claimAvailableJob(storeId, printerIds, agentId);
    }
    res.json({ success: true, data: job });
  } catch (error) {
    res
      .status(500)
      .json({ success: false, message: "Failed to claim print job", error });
  }
};

export const completePrintJob = async (req: Request, res: Response) => {
  const { agentId, storeId } = (req as PrintAgentRequest).printAgent;
  const id = String(req.params.id);
  const job = await PrintJob.findOneAndUpdate(
    { _id: id, storeId, status: "processing", agentId },
    {
      $set: {
        status: "printed",
        printedAt: new Date(),
        retentionUntil: new Date(Date.now() + retentionMs),
      },
      $unset: { lockedAt: 1, lastError: 1 },
    },
    { returnDocument: "after" },
  ).lean();
  if (!job)
    return res
      .status(404)
      .json({ success: false, message: "Print job not found" });
  res.json({ success: true, data: job });
};

export const failPrintJob = async (req: Request, res: Response) => {
  const { agentId, storeId } = (req as PrintAgentRequest).printAgent;
  const id = String(req.params.id);
  const job = await PrintJob.findOne({
    _id: id,
    storeId,
    status: "processing",
    agentId,
  });
  if (!job)
    return res
      .status(404)
      .json({ success: false, message: "Print job not found" });
  const updated = await PrintJob.findOneAndUpdate(
    { _id: id, storeId, status: "processing", agentId },
    {
      $set: {
        lastError: String(req.body?.error || "Print failed").slice(0, 1000),
        status: "failed",
        retentionUntil: new Date(Date.now() + retentionMs),
      },
      $unset: { lockedAt: 1 },
    },
    { returnDocument: "after" },
  ).lean();
  res.json({ success: true, data: updated });
};
