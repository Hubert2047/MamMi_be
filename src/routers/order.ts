import { Router } from "express";
import {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  getNextOrderNumber,
  cancelOrder,
  getSalesByPaymentMethod,
  updateOrderPayment,
  updatePendingOrder,
  updateOrderCustomer,
  printKitchenOrder
} from "../controllers/order.js";
import authenticateToken from "../middlewares/auth.js";

const router = Router();

router.post("/",authenticateToken, createOrder);
router.get("/", authenticateToken, getOrders);
router.get("/next-order-number", authenticateToken, getNextOrderNumber);
router.get("/sales-by-payment", authenticateToken, getSalesByPaymentMethod);
router.put("/payment/:id", authenticateToken, updateOrderPayment);   
router.put("/:id", authenticateToken, updatePendingOrder);
router.put("/:id/customer", authenticateToken, updateOrderCustomer);
router.post("/:id/print-kitchen", authenticateToken, printKitchenOrder);
router.get("/:id", authenticateToken, getOrderById);
router.patch("/:id/status", authenticateToken, updateOrderStatus);
router.patch("/:id/cancel", authenticateToken, cancelOrder);

export default router;
