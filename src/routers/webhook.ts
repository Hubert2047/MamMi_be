import { Router } from "express";
import express from "express";
import { handleWebhook } from "../controllers/webhook.js";
import { lineMiddleware } from "../middlewares/line.js";

const router = Router();

router.post(
  "/",
  express.raw({ type: "application/json" }),
  lineMiddleware,
  handleWebhook,
);

export default router;
