import { createHash } from "node:crypto";

const cloudinaryConfig = () => ({
  cloudName: process.env.CLOUDINARY_CLOUD_NAME?.trim(),
  apiKey: process.env.CLOUDINARY_API_KEY?.trim(),
  apiSecret: process.env.CLOUDINARY_API_SECRET?.trim(),
});

export const deleteCloudinaryImage = async (publicId: string) => {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  if (!cloudName || !apiKey || !apiSecret || !publicId)
    throw new Error("Cloudinary is not configured");
  const timestamp = Math.floor(Date.now() / 1000);
  const paramsToSign = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = createHash("sha1")
    .update(`${paramsToSign}${apiSecret}`)
    .digest("hex");
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    invalidate: "true",
    api_key: apiKey,
    signature,
  });
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
    { method: "POST", body },
  );
  if (!response.ok)
    throw new Error(`Cloudinary deletion failed (${response.status})`);
  const result = (await response.json()) as { result?: string };
  if (result.result !== "ok" && result.result !== "not found")
    throw new Error(
      `Cloudinary deletion result: ${result.result || "unknown"}`,
    );
};
