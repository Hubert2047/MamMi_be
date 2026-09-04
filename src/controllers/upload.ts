import type { Request, Response } from "express";
import { createHash, randomUUID } from "node:crypto";

export const createCloudinaryUploadSignature = async (
  _req: Request,
  res: Response,
) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (!cloudName || !apiKey || !apiSecret)
    return res
      .status(503)
      .json({ success: false, message: "Cloudinary is not configured" });
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = "mammi/products";
  const publicId = randomUUID();
  const paramsToSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = createHash("sha1")
    .update(`${paramsToSign}${apiSecret}`)
    .digest("hex");
  res.json({
    success: true,
    data: { cloudName, apiKey, folder, publicId, timestamp, signature },
  });
};
