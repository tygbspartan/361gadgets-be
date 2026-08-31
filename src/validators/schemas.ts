import { z } from "zod";

// Reusable pieces
const email = z.string().trim().toLowerCase().email("Invalid email address");
const password = z.string().min(6, "Password must be at least 6 characters").max(128);
const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);
const id = z.number().int().positive();

// ── Auth ────────────────────────────────────────────────────────────────────
export const registerSchema = z.object({
  email,
  password,
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(30).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  token: nonEmpty("Token"),
  newPassword: password,
});

export const changePasswordSchema = z.object({
  currentPassword: nonEmpty("Current password"),
  newPassword: password,
});

export const verifyEmailSchema = z.object({ token: nonEmpty("Token") });
export const resendVerificationSchema = z.object({ email });

// ── Checkout ──────────────────────────────────────────────────────────────
const shippingInfoSchema = z.object({
  fullName: nonEmpty("Full name").max(120),
  phone: nonEmpty("Phone").max(30),
  email,
  addressLine1: nonEmpty("Address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  city: nonEmpty("City").max(100),
  province: z.string().trim().max(100).optional(),
  postalCode: nonEmpty("Postal code").max(20),
  country: z.string().trim().max(100).optional(),
});

export const checkoutSchema = z.object({
  shippingInfo: shippingInfoSchema,
  paymentMethod: z.enum(["cod", "esewa", "khalti", "bank_transfer"]),
  transactionNumber: z.string().trim().max(120).optional(),
  customerNote: z.string().trim().max(1000).optional(),
  discountCode: z.string().trim().max(60).optional(),
  cartItemIds: z.array(id).optional(),
  items: z
    .array(
      z.object({
        productId: id,
        quantity: z.number().int().positive().max(999),
        colorId: id.optional(),
      }),
    )
    .optional(),
});

// ── Cart ──────────────────────────────────────────────────────────────────
export const addToCartSchema = z.object({
  productId: id,
  quantity: z.number().int().positive().max(999).optional(),
  colorId: id.optional(),
});

// ── Reviews ───────────────────────────────────────────────────────────────
export const createReviewSchema = z.object({
  productId: id,
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(150).optional(),
  comment: z.string().trim().min(1, "Comment is required").max(2000),
  images: z.array(z.string().url()).max(6).optional(),
});

// ── Platform settings ─────────────────────────────────────────────────────
export const settingsUpdateSchema = z.object({
  commissionRate: z.number().min(0).max(1).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  supportEmail: z.string().trim().max(120).optional(),
  shippingInsideValley: z.number().min(0).optional(),
  shippingOutsideValley: z.number().min(0).optional(),
  freeShippingThreshold: z.number().min(0).optional(),
  featureFlags: z.record(z.string(), z.any()).optional(),
});

// ── Payouts ───────────────────────────────────────────────────────────────
export const createPayoutSchema = z.object({
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
});

export const markPayoutPaidSchema = z.object({
  reference: z.string().trim().max(120).optional(),
});

// ── Refunds ───────────────────────────────────────────────────────────────
export const refundSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500),
  amount: z.number().positive().optional(), // defaults to full order total
});

// ── Addresses ─────────────────────────────────────────────────────────────
export const addressSchema = z.object({
  fullName: nonEmpty("Full name").max(120),
  phone: nonEmpty("Phone").max(30),
  addressLine1: nonEmpty("Address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  city: nonEmpty("City").max(100),
  province: z.string().trim().max(100).optional(),
  postalCode: nonEmpty("Postal code").max(20),
  country: z.string().trim().max(100).optional(),
  isDefault: z.boolean().optional(),
});

// ── Cart merge (guest → user on login) ────────────────────────────────────
export const cartMergeSchema = z.object({
  items: z
    .array(
      z.object({
        productId: id,
        quantity: z.number().int().positive().max(999),
        colorId: id.optional(),
      }),
    )
    .max(100),
});

// ── Order cancellation ────────────────────────────────────────────────────
export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

// ── Catalog requests ──────────────────────────────────────────────────────
export const catalogRequestSchema = z.object({
  type: z.enum(["brand", "category"]),
  name: nonEmpty("Name").max(120),
  parentName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
