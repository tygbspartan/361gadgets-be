import { Router } from "express";
import { CategoryController } from "../controllers/category.controller";
import {
  authenticate,
  isAdmin,
  isSuperadmin,
} from "../middleware/auth.middleware";

const router = Router();

// Public routes (no authentication required)
router.get("/", CategoryController.getAll);
router.get("/tree", CategoryController.getTree);
router.get("/slug/:slug", CategoryController.getBySlug);

// Read (any privileged user — vendors need to read categories to attach to products)
router.get("/:id", authenticate, isAdmin, CategoryController.getById);

// Mutations — superadmin only (vendors request new categories via /catalog-requests)
router.post("/bulk", authenticate, isSuperadmin, CategoryController.bulkCreate);
router.post("/", authenticate, isSuperadmin, CategoryController.create);
router.put("/:id", authenticate, isSuperadmin, CategoryController.update);
router.delete("/:id", authenticate, isSuperadmin, CategoryController.delete);

export default router;
