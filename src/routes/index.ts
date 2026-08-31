import { Router } from "express";
import testRoutes from "./test.routes";
import authRoutes from "./auth.routes";
import categoryRoutes from "./category.routes";
import brandRoutes from "./brand.routes";
import productRoutes from "./product.routes";
import cartRoutes from "./cart.routes";
import wishlistRoutes from "./wishlist.routes";
import orderRoutes from "./order.routes";
import discountRoutes from "./discount.routes";
import reviewRoutes from "./review.routes";
import dashboardRoutes from "./dashboard.routes";
import heroRoutes from "./hero.routes";
import adminRoutes from "./admin.routes";
import catalogRequestRoutes from "./catalogRequest.routes";
import addressRoutes from "./address.routes";
import settingsRoutes from "./settings.routes";
import { pingDatabase } from "../config/database.config";
import { getRedisClient } from "../config/redis.config";
import { StorageService } from "../services/storage.service";

const router = Router();

// Liveness — cheap, no dependencies. "Is the process up?"
router.get("/health", (_req, res) => {
  res.json({
    status: "success",
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

// Readiness — "can we serve traffic?" Verifies the hard dependency (DB) plus the
// optional ones (Redis cache, Supabase Storage). DB down ⇒ 503; Redis/Storage
// problems are reported as "degraded" but don't fail readiness, since the core
// API still functions without them.
router.get("/health/ready", async (_req, res) => {
  const checks: Record<string, string> = {};

  try {
    await pingDatabase();
    checks.database = "ok";
  } catch {
    checks.database = "down";
  }

  const redis = getRedisClient();
  if (!redis) {
    checks.redis = "skipped";
  } else {
    try {
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "degraded";
    }
  }

  try {
    await StorageService.healthCheck();
    checks.storage = "ok";
  } catch {
    checks.storage = "degraded";
  }

  const ready = checks.database === "ok";
  res.status(ready ? 200 : 503).json({
    status: ready ? "success" : "error",
    ready,
    checks,
    timestamp: new Date().toISOString(),
  });
});

// Routes
// Test/debug router is dev-only — never mounted in production.
if (process.env.NODE_ENV !== "production") {
  router.use("/test", testRoutes);
}
router.use("/auth", authRoutes);
router.use("/categories", categoryRoutes);
router.use("/brands", brandRoutes);
router.use("/products", productRoutes);
router.use("/cart", cartRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/orders", orderRoutes);
router.use("/discounts", discountRoutes);
router.use("/reviews", reviewRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/hero", heroRoutes);
router.use("/admin", adminRoutes);
router.use("/catalog-requests", catalogRequestRoutes);
router.use("/addresses", addressRoutes);
router.use("/settings", settingsRoutes);

export default router;
