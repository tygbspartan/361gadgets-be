import { z } from "zod";
import {
  NEPAL_DISTRICTS,
  NEPAL_MOBILE_REGEX,
  NEPAL_POSTAL_REGEX,
  NEPAL_PROVINCES,
  matchListEntry,
  normalizeNepalPhone,
} from "../constants/nepal.constants";

// Reusable pieces
const email = z.string().trim().toLowerCase().email("Invalid email address");
const password = z.string().min(6, "Password must be at least 6 characters").max(128);
const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);
const id = z.number().int().positive();

// Nepal address fields (rules in constants/nepal.constants.ts, mirrored by the
// storefront form). District and province are stored in the list spelling.
const listEntry = <T extends string>(label: string, list: readonly T[], message: string) =>
  nonEmpty(label).transform((value, ctx) => {
    const match = matchListEntry(list, value);
    if (!match) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return match;
  });
const nepalPhone = nonEmpty("Phone")
  .transform(normalizeNepalPhone)
  .pipe(
    z.string().regex(NEPAL_MOBILE_REGEX, "Phone must be a 10-digit Nepali mobile number starting with 97 or 98"),
  );
const district = listEntry("City", NEPAL_DISTRICTS, "City must be one of Nepal's 77 districts");
const province = listEntry("Province", NEPAL_PROVINCES, "Province must be one of Nepal's 7 provinces");
const postalCode = nonEmpty("Postal code").regex(NEPAL_POSTAL_REGEX, "Postal code must be 5 digits");
const landmark = nonEmpty("Landmark").max(200);

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
  phone: nepalPhone,
  email,
  addressLine1: nonEmpty("Address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark,
  city: district,
  province,
  postalCode,
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

// ── Discounts ─────────────────────────────────────────────────────────────
// Only these fields can be set. usedCount and ownerId are server-managed and
// are dropped if sent. null clears an optional limit (min, max, usage limit).
const discountFields = {
  name: nonEmpty("Name").max(100),
  code: nonEmpty("Code")
    .min(3, "Code must be at least 3 characters")
    .max(30, "Code can be at most 30 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "Code can only contain letters, numbers, dashes and underscores")
    .transform((code) => code.toUpperCase()),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive("Value must be greater than 0").max(10_000_000),
  minPurchaseAmount: z.number().min(0, "Minimum purchase can't be negative").nullable().optional(),
  maxDiscountAmount: z.number().positive("Maximum discount must be greater than 0").nullable().optional(),
  startDate: z.coerce.date({ error: "Invalid start date" }),
  endDate: z.coerce.date({ error: "Invalid end date" }),
  usageLimit: z.number().int().min(1, "Usage limit must be at least 1").nullable().optional(),
  isActive: z.boolean().optional(),
  oncePerUser: z.boolean().optional(),
  // Replaces the discount's product links (empty array removes them all).
  productIds: z.array(id).max(500).optional(),
};

export const createDiscountSchema = z
  .object(discountFields)
  .superRefine((d, ctx) => {
    if (d.type === "percentage" && d.value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percentage can't exceed 100" });
    }
    if (d.endDate <= d.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after start date" });
    }
  });

// Partial: cross-field checks (percentage cap, dates, usage limit vs uses so
// far) need the stored discount, so the controller does them.
export const updateDiscountSchema = z.object(discountFields).partial();

// "Apply" at checkout: the code plus the cart lines (priced on the server).
export const validateDiscountSchema = z.object({
  code: nonEmpty("Discount code").max(60),
  items: z
    .array(z.object({ productId: id, quantity: z.number().int().positive().max(1000) }), {
      error: "Please refresh the page and try the code again",
    })
    .min(1, "Your cart is empty")
    .max(200),
});

// ── Refunds ───────────────────────────────────────────────────────────────
export const refundSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(500),
  amount: z.number().positive().optional(), // defaults to full order total
});

// ── Addresses ─────────────────────────────────────────────────────────────
export const addressSchema = z.object({
  fullName: nonEmpty("Full name").max(120),
  phone: nepalPhone,
  addressLine1: nonEmpty("Address").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  landmark,
  city: district,
  province,
  postalCode,
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

// ── SEO content (categories, products) ────────────────────────────────────
// FAQ list shown on the page and emitted as FAQPage schema. Blank rows are
// dropped; an empty list (or null) clears it.
export const faqsSchema = z
  .array(
    z.object({
      question: z.string().trim().max(300, "FAQ questions can be at most 300 characters"),
      answer: z.string().trim().max(3000, "FAQ answers can be at most 3000 characters"),
    }),
  )
  .max(30, "At most 30 FAQs")
  .transform((items) => items.filter((f) => f.question && f.answer))
  .refine((items) => items.every((f) => f.question.length >= 5), "Each FAQ question needs at least 5 characters");

// "" or whitespace means "clear it" (null), so a cleared admin field is saved.
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} can be at most ${max} characters`)
    .transform((v) => v.trim() || null)
    .nullable()
    .optional();

const categoryFields = {
  name: nonEmpty("Category name").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug can only contain lowercase letters, numbers and dashes")
    .max(140)
    .optional(),
  description: optionalText(2000, "Description"),
  seoDescription: optionalText(2000, "SEO intro"),
  seoContent: optionalText(20000, "SEO content"),
  faqs: faqsSchema.nullable().optional(),
  parentId: id.nullable().optional(),
  displayOrder: z.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
};

export const createCategorySchema = z.object({
  ...categoryFields,
  level: z.union([z.literal(1), z.literal(2), z.literal(3)], { error: "Level must be 1, 2, or 3" }),
});

// Level can't change after creation, so it isn't accepted here.
export const updateCategorySchema = z.object(categoryFields).partial();

// ── Catalog requests ──────────────────────────────────────────────────────
export const catalogRequestSchema = z.object({
  type: z.enum(["brand", "category"]),
  name: nonEmpty("Name").max(120),
  parentName: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
