import { Router } from "express";
import {
  createRevenue,
  deleteRevenue,
  getRevenues,
  updateRevenue,
} from "../controllers/revenue.js";
import authenticateToken from "../middlewares/auth.js";

const router = Router();

router.post("/", authenticateToken, createRevenue);
router.get("/", authenticateToken, getRevenues);
router.put("/:id", authenticateToken, updateRevenue);
router.delete("/:id", authenticateToken, deleteRevenue);

export default router;
