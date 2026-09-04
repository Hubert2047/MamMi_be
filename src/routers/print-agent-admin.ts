import { Router } from "express";
import authenticateToken from "../middlewares/auth.js";
import authorizationPermissions from "../middlewares/permissions.js";
import { Role } from "../constants/role.js";
import {
  createPrintAgent,
  createPrinter,
  createPrinterTestJob,
  listPrintAgents,
  rotatePrintAgentToken,
  updatePrintAgent,
  updatePrinter,
  updatePrintRouting,
} from "../controllers/printAgentAdmin.js";

const router = Router();
router.use(
  authenticateToken,
  authorizationPermissions([Role.Admin, Role.SuperAdmin]),
);
router.get("/", listPrintAgents);
router.post("/", createPrintAgent);
router.post("/:id/printers", createPrinter);
router.patch("/:id", updatePrintAgent);
router.patch("/:id/printers/:printerId", updatePrinter);
router.post("/:id/printers/:printerId/test", createPrinterTestJob);
router.put("/routing", updatePrintRouting);
router.post("/:id/rotate-token", rotatePrintAgentToken);

export default router;
