import { Router } from "express";
import authenticatePrintAgent from "../middlewares/printAgentAuth.js";
import {
  claimPrintJob,
  completePrintJob,
  failPrintJob,
} from "../controllers/printAgent.js";
import { getAgentConfig } from "../controllers/printAgentAdmin.js";

const router = Router();
router.use(authenticatePrintAgent);
router.get("/config", getAgentConfig);
router.post("/jobs/claim", claimPrintJob);
router.post("/jobs/:id/complete", completePrintJob);
router.post("/jobs/:id/fail", failPrintJob);

export default router;
