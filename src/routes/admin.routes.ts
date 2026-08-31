import { Router } from "express";
import { AdminController } from "../controllers/admin.controller";
import { SettingsController } from "../controllers/settings.controller";
import { authenticate, isSuperadmin } from "../middleware/auth.middleware";
import { upload, validateImageBuffer } from "../middleware/upload.middleware";
import { validateBody } from "../middleware/validate";
import {
  settingsUpdateSchema,
  createPayoutSchema,
  markPayoutPaidSchema,
} from "../validators/schemas";

const router = Router();

// ==================== SUPERADMIN ROUTES ====================
// Vendor (admin) account management — only the superadmin can create/moderate vendors.

router.post("/vendors", authenticate, isSuperadmin, AdminController.createAdmin);
router.get("/vendors", authenticate, isSuperadmin, AdminController.listAdmins);

// Per-vendor earnings / payouts owed. MUST be declared before "/vendors/:id"
// so "earnings" isn't captured as an :id param.
router.get(
  "/vendors/earnings",
  authenticate,
  isSuperadmin,
  AdminController.getVendorEarnings,
);

router.get("/vendors/:id", authenticate, isSuperadmin, AdminController.getAdmin);

// Order-by-order earnings breakdown for one vendor.
router.get(
  "/vendors/:id/earnings",
  authenticate,
  isSuperadmin,
  AdminController.getVendorEarningsDetail,
);
router.patch(
  "/vendors/:id",
  authenticate,
  isSuperadmin,
  AdminController.updateAdmin,
);
router.patch(
  "/vendors/:id/status",
  authenticate,
  isSuperadmin,
  AdminController.setAdminStatus,
);
router.put(
  "/vendors/:id/brands",
  authenticate,
  isSuperadmin,
  AdminController.setVendorBrands,
);

// Vendor logo upload/delete (multipart/form-data, field name: "logo")
router.post(
  "/vendors/:id/logo/upload",
  authenticate,
  isSuperadmin,
  upload.single("logo"),
  validateImageBuffer,
  AdminController.uploadLogo,
);
router.delete(
  "/vendors/:id/logo",
  authenticate,
  isSuperadmin,
  AdminController.deleteLogo,
);

// ==================== PAYOUTS ====================
router.get(
  "/vendors/:id/payouts",
  authenticate,
  isSuperadmin,
  AdminController.listPayouts,
);
router.post(
  "/vendors/:id/payouts",
  authenticate,
  isSuperadmin,
  validateBody(createPayoutSchema),
  AdminController.createPayout,
);
router.patch(
  "/payouts/:payoutId/mark-paid",
  authenticate,
  isSuperadmin,
  validateBody(markPayoutPaidSchema),
  AdminController.markPayoutPaid,
);

// ==================== PLATFORM SETTINGS ====================
router.get("/settings", authenticate, isSuperadmin, SettingsController.get);
router.put(
  "/settings",
  authenticate,
  isSuperadmin,
  validateBody(settingsUpdateSchema),
  SettingsController.update,
);

// ==================== CUSTOMER MANAGEMENT ====================
router.get(
  "/customers",
  authenticate,
  isSuperadmin,
  AdminController.listCustomers,
);
router.get(
  "/customers/:id",
  authenticate,
  isSuperadmin,
  AdminController.getCustomer,
);
router.get(
  "/customers/:id/export",
  authenticate,
  isSuperadmin,
  AdminController.exportCustomer,
);
router.patch(
  "/customers/:id/status",
  authenticate,
  isSuperadmin,
  AdminController.setCustomerStatus,
);
router.delete(
  "/customers/:id",
  authenticate,
  isSuperadmin,
  AdminController.deleteCustomer,
);

export default router;
