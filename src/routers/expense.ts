import { Router } from "express";
import {
  createExpense,
  deleteExpense,
  getExpenses,
  updateExpense,
} from "../controllers/expense.js";
import authenticateToken from "../middlewares/auth.js";

const router = Router();

router.post("/", authenticateToken, createExpense);
router.get("/", authenticateToken, getExpenses);
router.put("/:id", authenticateToken, updateExpense);
router.delete("/:id", authenticateToken, deleteExpense);

export default router;
