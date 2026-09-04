import { Router } from "express";
import authenticateToken from "../middlewares/auth.js";
import { createUnit, getUnits, updateUnit } from "../controllers/unit.js";
import authorizationPermissions from "../middlewares/permissions.js";
import { Role } from "../middlewares/auth.js";

const router = Router();

router.get("/", authenticateToken, getUnits);
router.post(
  "/",
  authenticateToken,
  authorizationPermissions([Role.SuperAdmin]),
  createUnit,
);
router.put(
  "/:id",
  authenticateToken,
  authorizationPermissions([Role.SuperAdmin]),
  updateUnit,
);

export default router;
