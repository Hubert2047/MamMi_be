import type { NextFunction } from "express";
import type { Request, Response } from "express";
import {
  customError,
  generateTokens,
  verifyRefreshToken,
} from "../utils/index.js";

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const refreshToken = req.cookies["jwt"];
  if (!refreshToken)
    return res
      .status(403)
      .json({ error: true, message: "Invalid refresh token" });
  try {
    const result: any = await verifyRefreshToken(refreshToken);
    const tokenDetails = result.tokenDetails;
    const payload = {
      account: tokenDetails.account,
      role: tokenDetails.role,
      storeId: tokenDetails.storeId,
    };
    const { accessToken } = await generateTokens(payload);
    res.status(200).json({
      error: false,
      accessToken,
      message: "Access token created successfully",
    });
  } catch (error: any) {
    next(
      customError({
        msg: error.message,
        status: "failed",
        statusCode: 403,
      }),
    );
  }
};
