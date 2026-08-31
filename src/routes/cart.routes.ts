import { Router } from "express";
import { CartController } from "../controllers/cart.controller";
import { authenticate } from "../middleware/auth.middleware";
import { validateBody } from "../middleware/validate";
import { addToCartSchema, cartMergeSchema } from "../validators/schemas";

const router = Router();

// All cart routes require authentication
router.post("/", authenticate, validateBody(addToCartSchema), CartController.addToCart);
// Merge a guest cart into the user's cart (called once after login/register)
router.post(
  "/merge",
  authenticate,
  validateBody(cartMergeSchema),
  CartController.mergeCart,
);
router.get("/", authenticate, CartController.getCart);
router.put("/:id", authenticate, CartController.updateCartItem);
router.delete("/:id", authenticate, CartController.removeFromCart);
router.delete("/", authenticate, CartController.clearCart);

export default router;
