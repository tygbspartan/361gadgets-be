import { Router } from "express";
import { DiscountController } from "../controllers/discount.controller";
import {
  authenticate,
  isAdmin,
  optionalAuthenticate,
} from "../middleware/auth.middleware";
import { discountCheckLimiter } from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";
import {
  createDiscountSchema,
  updateDiscountSchema,
  validateDiscountSchema,
} from "../validators/schemas";

const router = Router();

// ==================== CUSTOMER ROUTES ====================

// Validate discount code. Guests too: checkout accepts their codes, and
// once-per-customer codes still require a login (evaluateDiscount).
// Rate-limited against code guessing (per account, or per IP for guests).
router.post(
  "/validate",
  optionalAuthenticate,
  discountCheckLimiter,
  validateBody(validateDiscountSchema),
  DiscountController.validateCode,
);

// ==================== ADMIN ROUTES ====================

// CRUD operations
router.post(
  "/",
  authenticate,
  isAdmin,
  validateBody(createDiscountSchema),
  DiscountController.create,
);
router.get("/", authenticate, isAdmin, DiscountController.getAll);
router.get("/:id", authenticate, isAdmin, DiscountController.getById);
router.put(
  "/:id",
  authenticate,
  isAdmin,
  validateBody(updateDiscountSchema),
  DiscountController.update,
);
router.delete("/:id", authenticate, isAdmin, DiscountController.delete);

export default router;
