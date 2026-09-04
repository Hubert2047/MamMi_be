import { Router } from "express";
import { getAccessibleStores } from "../controllers/store.js";
import authenticateToken from "../middlewares/auth.js";

const router = Router();
router.get("/", authenticateToken, getAccessibleStores);

export default router;
