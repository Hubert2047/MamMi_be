import type { Request, Response } from "express";
import Store from "../models/store.js";
import User from "../models/user.js";
import { Role, type AuthRequest } from "../middlewares/auth.js";

export const getAccessibleStores = async (req: Request, res: Response) => {
  try {
    const authUser = (req as AuthRequest).user;
    const user = await User.findOne({ account: authUser.account })
      .select({ storeIds: 1 })
      .lean();
    const filter =
      authUser.role === Role.SuperAdmin
        ? { active: true }
        : {
            _id: {
              $in: user?.storeIds?.length ? user.storeIds : [authUser.storeId],
            },
            active: true,
          };
    const stores = await Store.find(filter)
      .select({ code: 1, name: 1 })
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, data: stores });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
