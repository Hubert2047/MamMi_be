import { Router } from "express";
import {
  checkIn,
  checkOut,
  getAttendances,
  updateAttendance,
} from "../controllers/shift-attendance.js";
import authenticateToken from "../middlewares/auth.js";
import authorizationPermissions from "../middlewares/permissions.js";
import { Role } from "../constants/role.js";

const router = Router();

router.post("/check-in", authenticateToken, checkIn);
router.post("/check-out", authenticateToken, checkOut);
router.get("/", authenticateToken, getAttendances);
router.put(
  "/:id",
  authenticateToken,
  authorizationPermissions([Role.SuperAdmin]),
  updateAttendance,
);

export default router;
