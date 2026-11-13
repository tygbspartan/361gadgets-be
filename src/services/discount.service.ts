import type { Discount } from "@prisma/client";
import prisma from "../config/database.config";
import { ROLES } from "../constants/roles.constants";
import { BadRequestError } from "../utils/customError.util";

/** One cart line, as far as discount rules care. */
export interface DiscountLine {
  productId: number;
  // The product's vendor (null for platform-owned products).
  ownerId: number | null;
  // price × quantity, at the server's price.
  subtotal: number;
}

export type DiscountEvaluation =
  | {
      ok: true;
      discount: Discount;
      // Total taken off the order.
      amount: number;
      // Sum of the lines the code applies to.
      eligibleSubtotal: number;
      // How much of `amount` each line carries (same order as the input lines;
      // 0 for lines the code doesn't apply to). Sums exactly to `amount`.
      allocations: number[];
      // True when the code belongs to a vendor, who then pays for it out of
      // their earnings. Platform (superadmin) codes are paid by the platform.
      vendorFunded: boolean;
    }
  | { ok: false; message: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/*
 * The one place that decides whether a discount code applies to a cart and how
 * much it takes off. Both the "Apply" check (/discounts/validate) and checkout
 * call this, so a code the customer saw accepted can only fail at checkout if
 * something actually changed in between (expired, limit reached).
 *
 * Which lines a code covers:
 *   - linked to specific products  -> only those products
 *   - a vendor's code              -> only that vendor's products
 *   - a platform (superadmin) code -> the whole cart
 * The minimum purchase and the percentage are measured on those lines only.
 *
 * The usage limit is checked here for a friendly message, but the binding
 * check is the guarded increment inside the checkout transaction.
 */
export async function evaluateDiscount(
  code: string,
  lines: DiscountLine[],
  userId: number | null,
): Promise<DiscountEvaluation> {
  const discount = await prisma.discount.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: {
      products: { select: { productId: true } },
      owner: { select: { role: true } },
    },
  });

  if (!discount) return { ok: false, message: "This discount code doesn't exist." };
  if (!discount.isActive) return { ok: false, message: "This discount code is no longer active." };

  const now = new Date();
  if (now < discount.startDate) return { ok: false, message: "This discount code isn't active yet." };
  if (now > discount.endDate) return { ok: false, message: "This discount code has expired." };

  if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
    return { ok: false, message: "This discount code has reached its usage limit." };
  }

  const vendorFunded =
    discount.ownerId != null && discount.owner?.role !== ROLES.SUPERADMIN;
  const linked = new Set(discount.products.map((p) => p.productId));

  const applies = (line: DiscountLine) =>
    linked.size > 0
      ? linked.has(line.productId)
      : vendorFunded
        ? line.ownerId === discount.ownerId
        : true;

  const eligibleSubtotal = round2(
    lines.filter(applies).reduce((sum, line) => sum + line.subtotal, 0),
  );
  if (eligibleSubtotal <= 0) {
    return {
      ok: false,
      message:
        linked.size > 0
          ? "This code only applies to selected products, and none are in your cart."
          : "This code doesn't apply to any of the items in your cart.",
    };
  }

  const coversWholeCart = lines.every(applies);
  const minPurchase = Number(discount.minPurchaseAmount ?? 0);
  if (minPurchase > 0 && eligibleSubtotal < minPurchase) {
    const min = minPurchase.toLocaleString("en-IN");
    return {
      ok: false,
      message: coversWholeCart
        ? `This code needs a minimum purchase of Rs ${min}.`
        : `This code needs a minimum of Rs ${min} on the items it applies to.`,
    };
  }

  // Once-per-customer codes need an account to track who has used them.
  if (discount.oncePerUser) {
    if (userId == null) {
      return { ok: false, message: "Log in to use this discount code." };
    }
    const redeemed = await prisma.discountRedemption.findUnique({
      where: { discountId_userId: { discountId: discount.id, userId } },
    });
    if (redeemed) return { ok: false, message: "You've already used this discount code." };
  }

  let amount =
    discount.type === "percentage"
      ? (eligibleSubtotal * Number(discount.value)) / 100
      : Number(discount.value);
  // A cap of 0 has always meant "no cap" (the admin form saves 0 when empty).
  if (Number(discount.maxDiscountAmount ?? 0) > 0) {
    amount = Math.min(amount, Number(discount.maxDiscountAmount));
  }
  amount = round2(Math.min(amount, eligibleSubtotal));

  const { products: _products, owner: _owner, ...plainDiscount } = discount;
  return {
    ok: true,
    discount: plainDiscount,
    amount,
    eligibleSubtotal,
    allocations: allocate(amount, lines.map((l) => (applies(l) ? l.subtotal : 0))),
    vendorFunded,
  };
}

/*
 * Split `amount` across lines in proportion to their weights, rounded to the
 * paisa. The rounding remainder goes to the largest line so the parts always
 * add up to exactly `amount`.
 */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);

  const parts = weights.map((w) => round2((amount * w) / total));
  const remainder = round2(amount - parts.reduce((a, b) => a + b, 0));
  if (remainder !== 0) {
    const largest = weights.indexOf(Math.max(...weights));
    parts[largest] = round2(parts[largest] + remainder);
  }
  return parts;
}

/*
 * Price a list of {productId, quantity} with server-side prices and owners,
 * for the "Apply" check (checkout builds its lines from its own items).
 */
export async function linesFromItems(
  items: Array<{ productId: number; quantity: number }>,
): Promise<DiscountLine[]> {
  const products = await prisma.product.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.productId))] }, isActive: true },
    select: { id: true, price: true, ownerId: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  return items.map((item) => {
    const product = byId.get(item.productId);
    if (!product) {
      throw new BadRequestError(`Product ${item.productId} is no longer available`);
    }
    return {
      productId: product.id,
      ownerId: product.ownerId,
      subtotal: Number(product.price) * item.quantity,
    };
  });
}
