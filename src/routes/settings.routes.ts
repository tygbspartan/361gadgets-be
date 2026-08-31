import { Router } from "express";
import { SettingsController } from "../controllers/settings.controller";

const router = Router();

// Public storefront settings (shipping amounts, free-shipping threshold,
// currency). No auth — the checkout page reads this to show an accurate total.
router.get("/public", SettingsController.getPublic);

export default router;
