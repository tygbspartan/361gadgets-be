import { Router } from "express";
import { CatalogRequestController } from "../controllers/catalogRequest.controller";
import { authenticate, isAdmin } from "../middleware/auth.middleware";
import { writeLimiter } from "../middleware/rateLimit";
import { validateBody } from "../middleware/validate";
import { catalogRequestSchema } from "../validators/schemas";

const router = Router();

// Vendors (and superadmin) can request a new brand/category.
// This emails the platform admin — it does not create anything directly.
router.post(
  "/",
  authenticate,
  isAdmin,
  writeLimiter,
  validateBody(catalogRequestSchema),
  CatalogRequestController.create,
);

export default router;
