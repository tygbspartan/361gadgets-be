import { Router } from "express";
import { OrderController } from "../controllers/order.controller";
import {
  authenticate,
  optionalAuthenticate,
  isAdmin,
  isSuperadmin,
} from "../middleware/auth.middleware";
import { checkoutLimiter } from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";
import {
  checkoutSchema,
  cancelOrderSchema,
  refundSchema,
} from "../validators/schemas";

const router = Router();

// ==================== CUSTOMER ROUTES ====================

// Checkout (guest-friendly, rate-limited + validated)
router.post(
  "/checkout",
  checkoutLimiter,
  optionalAuthenticate,
  validateBody(checkoutSchema),
  OrderController.checkout,
);

// Get user's orders (logged-in only — guests have no history)
router.get("/", authenticate, OrderController.getUserOrders);

// Cancel own order (before it ships)
router.post(
  "/:id/cancel",
  authenticate,
  validateBody(cancelOrderSchema),
  OrderController.cancelOrder,
);

// Get single order by order number (guest-friendly for confirmation page)
router.get(
  "/:orderNumber",
  optionalAuthenticate,
  OrderController.getOrderByNumber
);

// ==================== ADMIN ROUTES ====================

// Get all orders
router.get("/admin/all", authenticate, isAdmin, OrderController.getAllOrders);

// Get single order by ID
router.get("/admin/:id", authenticate, isAdmin, OrderController.getOrderById);

// Update order status — superadmin only (orders are multi-vendor; one shared status)
router.patch(
  "/admin/:id/status",
  authenticate,
  isSuperadmin,
  OrderController.updateOrderStatus
);

// Update payment status — superadmin only
router.patch(
  "/admin/:id/payment",
  authenticate,
  isSuperadmin,
  OrderController.updatePaymentStatus
);

// Refund an order (superadmin) — fake-product cases
router.post(
  "/admin/:id/refund",
  authenticate,
  isSuperadmin,
  validateBody(refundSchema),
  OrderController.refundOrder,
);

export default router;
