import { Router } from "express";
import {
  createSupplier,
  deleteSupplier,
  getSuppliers,
  updateSupplier,
} from "../controllers/supplier.js";
import authenticateToken, { Role } from "../middlewares/auth.js";
import authorizationPermissions from "../middlewares/permissions.js";

const router = Router();
router.use(
  authenticateToken,
  authorizationPermissions([Role.Admin, Role.SuperAdmin]),
);
router.get("/", getSuppliers);
router.post("/", createSupplier);
router.put("/:id", updateSupplier);
router.delete("/:id", deleteSupplier);
export default router;
