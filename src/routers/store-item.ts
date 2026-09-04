import { Router } from "express";
import authenticateToken from "../middlewares/auth.js";
import {
  addStoreItem,
  getItems,
  updateStoreItem,
  updateTemporaryStoreItemAvailability,
} from "../controllers/item.js";

const router = Router();
router.get("/", authenticateToken, getItems);
router.post("/", authenticateToken, addStoreItem);
router.put("/:itemId", authenticateToken, updateStoreItem);
router.patch(
  "/:itemId/temporary-availability",
  authenticateToken,
  updateTemporaryStoreItemAvailability,
);
export default router;
