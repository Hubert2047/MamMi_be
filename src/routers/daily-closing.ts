import { Router } from "express";
import {
  createDailyClosing,
  getDailyClosingSummary,
  getDailyClosings,
  voidDailyClosing,
  getDailyClosingLineGroup,
  updateDailyClosingLineGroup,
} from "../controllers/daily-closing.js";
import authenticateToken, { Role } from "../middlewares/auth.js";
import authorizationPermissions from "../middlewares/permissions.js";

const router = Router();

router.post("/", authenticateToken, createDailyClosing);
router.get("/summary", authenticateToken, getDailyClosingSummary);
router.get("/line-group", authenticateToken, getDailyClosingLineGroup);
router.patch("/line-group", authenticateToken, updateDailyClosingLineGroup);
router.get("/", authenticateToken, getDailyClosings);
router.post(
  "/:id/void",
  authenticateToken,
  authorizationPermissions([Role.Admin, Role.SuperAdmin]),
  voidDailyClosing,
);

export default router;
