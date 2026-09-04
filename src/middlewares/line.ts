import { middleware } from "@line/bot-sdk";
import type { RequestHandler } from "express";

export const lineMiddleware: RequestHandler = (req, res, next) => {
  return middleware({
    channelSecret: process.env.LINE_CHANNEL_SECRET!,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  })(req, res, next);
};
