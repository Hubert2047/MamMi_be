import { Router } from "express";
import {
  confirmGuestCart,
  createGuestCart,
  createOnlineGuestCart,
  getGuestCart,
  getOnlineMenu,
  getQrMenu,
  previewGuestCart,
  updateGuestCart,
} from "../controllers/public-order.js";
import { publicRateLimit } from "../middlewares/public-rate-limit.js";

const router = Router();
router.get("/qr/:token", publicRateLimit("menu", 60, 60_000), getQrMenu);
router.post(
  "/qr/:token/carts",
  publicRateLimit("cart-create", 12, 60_000),
  createGuestCart,
);
router.get("/online", publicRateLimit("menu", 60, 60_000), getOnlineMenu);
router.post(
  "/online/carts",
  publicRateLimit("cart-create", 12, 60_000),
  createOnlineGuestCart,
);
const cartKey = (req: any) => `cart:${req.params.cartToken}`;
router.get(
  "/carts/:cartToken",
  publicRateLimit("cart-read", 60, 60_000, cartKey),
  getGuestCart,
);
router.patch(
  "/carts/:cartToken",
  publicRateLimit("cart-write", 30, 60_000, cartKey),
  updateGuestCart,
);
router.post(
  "/carts/:cartToken/preview",
  publicRateLimit("quote", 20, 60_000, cartKey),
  previewGuestCart,
);
router.post(
  "/carts/:cartToken/confirm",
  publicRateLimit("confirm", 8, 60_000, cartKey),
  confirmGuestCart,
);
export default router;
