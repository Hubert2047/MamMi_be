import { Router } from "express";
import authenticateToken, { Role } from "../middlewares/auth.js";
import authorizationPermissions from "../middlewares/permissions.js";
import {
  deleteLineGroup,
  listLineGroups,
  testLineGroup,
  updateLineGroup,
} from "../controllers/line-group.js";

const router = Router();
router.use(authenticateToken, authorizationPermissions([Role.SuperAdmin]));
router.get("/", listLineGroups);
router.post("/:id/test", testLineGroup);
router.patch("/:id", updateLineGroup);
router.delete("/:id", deleteLineGroup);

export default router;
