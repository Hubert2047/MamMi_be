import { Router } from "express";
import authenticateToken from "../middlewares/auth.js";
import {
  addStoreAddon,
  getStoreAddons,
  updateStoreAddon,
  updateTemporaryStoreAddonAvailability,
} from "../controllers/addon.js";

const router = Router();
router.get("/", authenticateToken, getStoreAddons);
router.post("/", authenticateToken, addStoreAddon);
router.put("/:addonId", authenticateToken, updateStoreAddon);
router.patch(
  "/:addonId/temporary-availability",
  authenticateToken,
  updateTemporaryStoreAddonAvailability,
);
export default router;
