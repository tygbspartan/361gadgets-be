import crypto from "crypto";
import { EmailService } from "./../services/email.service";
import { SettingsService } from "../services/settings.service";
import { writeAudit } from "../utils/audit.util";
import { withTxRetry } from "../utils/retryTransaction.util";
import { logger } from "../utils/logger.util";
import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/customError.util";
import {
  CheckoutRequest,
  SHIPPING_CONFIG,
  UpdateOrderStatusRequest,
  UpdatePaymentStatusRequest,
  calculateShippingCost,
} from "../types/order.types";
import { JwtPayload } from "../types/auth.types";
import { ROLES } from "../constants/roles.constants";
import {
  PAYMENT_METHODS,
  requiresTransactionNumber,
} from "../constants/payment.constants";
import {
  generateCustomerOrderEmail,
  generateAdminOrderNotification,
} from "../templates/orderEmails";
import { config } from "../config/env.config";

export class OrderController {
  // Checkout - Create order from cart
  static async checkout(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        shippingInfo,
        paymentMethod,
        transactionNumber,
        customerNote,
        discountCode,
        cartItemIds,
        items: guestItems,
      }: CheckoutRequest = req.body;

      const jwtPayload = (req as any).jwtPayload as JwtPayload | undefined;

      // Idempotent checkout: a retry/double-submit with the same Idempotency-Key
      // returns the original order instead of creating a duplicate.
      const idempotencyKey =
        (req.headers["idempotency-key"] as string | undefined)?.trim() || null;
      if (idempotencyKey) {
        const prior = await prisma.idempotencyKey.findUnique({
          where: { key: idempotencyKey },
        });
        if (prior?.orderId) {
          const existingOrder = await prisma.order.findUnique({
            where: { id: prior.orderId },
            include: { items: true, appliedDiscount: true },
          });
          return ResponseUtil.success(
            res,
            existingOrder,
            "Order placed successfully",
            201,
          );
        }
      }

      // Validation - Shipping Info
      if (
        !shippingInfo ||
        !shippingInfo.fullName ||
        !shippingInfo.phone ||
        !shippingInfo.email ||
        !shippingInfo.addressLine1 ||
        !shippingInfo.city ||
        !shippingInfo.postalCode
      ) {
        throw new BadRequestError(
          "Full name, phone, email, address, city, and postal code are required",
        );
      }

      // Validation - Payment Method
      if (!paymentMethod) {
        throw new BadRequestError("Payment method is required");
      }

      const validPaymentMethods = Object.values(PAYMENT_METHODS);
      if (!validPaymentMethods.includes(paymentMethod as any)) {
        throw new BadRequestError(
          `Invalid payment method. Must be one of: ${validPaymentMethods.join(
            ", ",
          )}`,
        );
      }

      // Validation - Transaction Number (required for online payments)
      if (requiresTransactionNumber(paymentMethod)) {
        if (!transactionNumber || transactionNumber.trim() === "") {
          throw new BadRequestError(
            "Transaction number is required for online payments (eSewa, Khalti, Bank Transfer)",
          );
        }
      }

      // Build a unified list of line items for both logged-in and guest flows.
      // For logged-in users, cartItemIds carries the originating CartItem ids so
      // they can be deleted after checkout; for guests it stays empty.
      type LineItem = {
        product: any;
        quantity: number;
        color: { id: number; name: string; stockQuantity: number } | null;
        cartItemId: number | null;
      };
      let lineItems: LineItem[] = [];
      const checkedOutCartItemIds: number[] = [];

      if (jwtPayload) {
        // ===== Logged-in: source items from the DB cart =====
        const cartWhere: any = { userId: jwtPayload.userId };
        if (cartItemIds && cartItemIds.length > 0) {
          cartWhere.id = { in: cartItemIds };
        }

        // Get selected (or all) cart items
        const cartItems = await prisma.cartItem.findMany({
          where: cartWhere,
          include: {
            color: true,
            product: {
              include: {
                images: {
                  where: { isPrimary: true },
                  take: 1,
                },
              },
            },
          },
        });

        if (cartItems.length === 0) {
          throw new BadRequestError(
            cartItemIds && cartItemIds.length > 0
              ? "None of the selected cart items were found."
              : "Cart is empty. Add items before checkout.",
          );
        }

        // Guard: ensure every requested ID actually belongs to this user
        if (cartItemIds && cartItemIds.length > 0) {
          const foundIds = new Set(cartItems.map((c) => c.id));
          const missing = cartItemIds.filter((id) => !foundIds.has(id));
          if (missing.length > 0) {
            throw new BadRequestError(
              `Cart item(s) not found: ${missing.join(", ")}`,
            );
          }
        }

        lineItems = cartItems.map((item) => ({
          product: item.product,
          quantity: item.quantity,
          color: item.color
            ? {
                id: item.color.id,
                name: item.color.name,
                stockQuantity: item.color.stockQuantity,
              }
            : null,
          cartItemId: item.id,
        }));
        checkedOutCartItemIds.push(...cartItems.map((c) => c.id));
      } else {
        // ===== Guest: source items from the request body =====
        if (!guestItems || guestItems.length === 0) {
          throw new BadRequestError("No items to checkout");
        }

        const productIds = guestItems.map((i) => i.productId);
        const products = await prisma.product.findMany({
          where: { id: { in: productIds } },
          include: {
            colors: true,
            images: {
              where: { isPrimary: true },
              take: 1,
            },
          },
        });
        const productMap = new Map(products.map((p) => [p.id, p]));

        for (const gi of guestItems) {
          const product = productMap.get(gi.productId);
          if (!product) {
            throw new BadRequestError(`Product not found: ${gi.productId}`);
          }
          if (!gi.quantity || gi.quantity < 1) {
            throw new BadRequestError(
              `Invalid quantity for product "${product.name}"`,
            );
          }

          // Resolve color variant (required when the product has colors).
          let color: LineItem["color"] = null;
          if (product.colors.length > 0) {
            if (!gi.colorId) {
              throw new BadRequestError(
                `Please select a color for "${product.name}". Available: ${product.colors
                  .map((c) => c.name)
                  .join(", ")}`,
              );
            }
            const c = product.colors.find((col) => col.id === gi.colorId);
            if (!c) {
              throw new BadRequestError(
                `Invalid color for product "${product.name}"`,
              );
            }
            color = { id: c.id, name: c.name, stockQuantity: c.stockQuantity };
          }

          lineItems.push({
            product,
            quantity: gi.quantity,
            color,
            cartItemId: null,
          });
        }
      }

      // Validate stock availability (per-color when a color was selected)
      for (const item of lineItems) {
        if (!item.product.isActive) {
          throw new BadRequestError(
            `Product "${item.product.name}" is no longer available`,
          );
        }

        const availableStock = item.color
          ? item.color.stockQuantity
          : item.product.stockQuantity;
        if (availableStock < item.quantity) {
          const label = item.color
            ? `"${item.product.name}" (${item.color.name})`
            : `"${item.product.name}"`;
          throw new BadRequestError(
            `Insufficient stock for ${label}. Only ${availableStock} available.`,
          );
        }
      }

      // Calculate totals
      let subtotal = 0;
      lineItems.forEach((item) => {
        subtotal += Number(item.product.price) * item.quantity;
      });

      // Calculate shipping cost from editable platform settings (no hardcoding).
      const settings = await SettingsService.get();
      let shippingCost = 0;

      if (subtotal >= Number(settings.freeShippingThreshold)) {
        shippingCost = 0;
      } else {
        const city = shippingInfo.city.toLowerCase().trim();
        const valleyCities = [
          "kathmandu",
          "lalitpur",
          "bhaktapur",
          "kirtipur",
          "madhyapur thimi",
          "thimi",
        ];

        const isInsideValley = valleyCities.some(
          (valleyCity) =>
            city.includes(valleyCity) || valleyCity.includes(city),
        );

        shippingCost = isInsideValley
          ? Number(settings.shippingInsideValley)
          : Number(settings.shippingOutsideValley);
      }

      // ✅ NEW: Apply discount if code provided
      let discount = 0;
      let discountId: number | null = null;
      let discountCodeUsed: string | null = null;
      let discountUsageLimit: number | null = null;
      let discountOncePerUser = false;

      if (discountCode) {
        const discountRecord = await prisma.discount.findUnique({
          where: { code: discountCode.toUpperCase() },
        });

        if (discountRecord) {
          const now = new Date();

          // once-per-user codes: reject if this customer already redeemed it.
          const alreadyRedeemed =
            discountRecord.oncePerUser && jwtPayload
              ? !!(await prisma.discountRedemption.findUnique({
                  where: {
                    discountId_userId: {
                      discountId: discountRecord.id,
                      userId: jwtPayload.userId,
                    },
                  },
                }))
              : false;

          // Validate discount
          const isValid =
            discountRecord.isActive &&
            !alreadyRedeemed &&
            now >= discountRecord.startDate &&
            now <= discountRecord.endDate &&
            (!discountRecord.usageLimit ||
              discountRecord.usedCount < discountRecord.usageLimit) &&
            (!discountRecord.minPurchaseAmount ||
              subtotal >= Number(discountRecord.minPurchaseAmount));

          if (isValid) {
            // Calculate discount
            if (discountRecord.type === "percentage") {
              discount = (subtotal * Number(discountRecord.value)) / 100;
            } else {
              discount = Number(discountRecord.value);
            }

            // Apply max discount cap
            if (
              discountRecord.maxDiscountAmount &&
              discount > Number(discountRecord.maxDiscountAmount)
            ) {
              discount = Number(discountRecord.maxDiscountAmount);
            }

            // Discount cannot exceed subtotal
            if (discount > subtotal) {
              discount = subtotal;
            }

            discountId = discountRecord.id;
            discountCodeUsed = discountRecord.code;
            discountUsageLimit = discountRecord.usageLimit ?? null;
            discountOncePerUser = discountRecord.oncePerUser;
          }
        }
      }

      const tax = 0;
      const total = subtotal + shippingCost + tax - discount;

      // Generate order number
      const orderNumber = await OrderController.generateOrderNumber();

      // Create order with items in transaction.
      // Retried on transient contention (pool exhaustion / deadlock) so a burst
      // of simultaneous checkouts self-heals instead of surfacing a 500. The
      // read-back of the finished order is done AFTER commit (outside the tx) to
      // keep the connection held for as short a time as possible.
      let order;
      try {
        const createdId = await withTxRetry(() =>
          prisma.$transaction(
            async (tx) => {
        // 1. Create order
        const newOrder = await tx.order.create({
          data: {
            orderNumber,
            userId: jwtPayload ? jwtPayload.userId : null,
            status: "pending",
            subtotal,
            shippingCost,
            tax,
            discount,
            total,
            shippingFullName: shippingInfo.fullName,
            shippingPhone: shippingInfo.phone,
            shippingEmail: shippingInfo.email,
            shippingAddressLine1: shippingInfo.addressLine1,
            shippingAddressLine2: shippingInfo.addressLine2,
            shippingLandmark: shippingInfo.landmark,
            shippingCity: shippingInfo.city,
            shippingProvince: shippingInfo.province,
            shippingPostalCode: shippingInfo.postalCode,
            shippingCountry: shippingInfo.country || "Nepal",
            paymentMethod,
            paymentStatus: "pending",
            transactionNumber:
              paymentMethod === PAYMENT_METHODS.COD ? null : transactionNumber,
            discountId,
            discountCode: discountCodeUsed,
            customerNote,
          },
        });

        // 1b. Seed the status-history audit trail.
        await tx.orderStatusHistory.create({
          data: {
            orderId: newOrder.id,
            fromStatus: null,
            toStatus: "pending",
            changedById: jwtPayload?.userId ?? null,
            note: "Order placed",
          },
        });

        // 2a. Atomically decrement stock with a guard, so concurrent checkouts
        // can't oversell. If the affected row count is 0, stock is gone.
        for (const item of lineItems) {
          if (item.color) {
            const colorDec = await tx.productColor.updateMany({
              where: {
                id: item.color.id,
                stockQuantity: { gte: item.quantity },
              },
              data: { stockQuantity: { decrement: item.quantity } },
            });
            if (colorDec.count === 0) {
              throw new ConflictError(
                `"${item.product.name}" (${item.color.name}) just went out of stock.`,
              );
            }
            // Keep the product's aggregate stock in sync (color guarantees ≥ 0).
            await tx.product.update({
              where: { id: item.product.id },
              data: { stockQuantity: { decrement: item.quantity } },
            });
          } else {
            const prodDec = await tx.product.updateMany({
              where: {
                id: item.product.id,
                stockQuantity: { gte: item.quantity },
              },
              data: { stockQuantity: { decrement: item.quantity } },
            });
            if (prodDec.count === 0) {
              throw new ConflictError(
                `"${item.product.name}" just went out of stock.`,
              );
            }
          }
        }

        // 2b. Insert all order items in a single round-trip (snapshot of each
        // product at time of order). Batching keeps the transaction — and the
        // connection it holds — as short as possible under concurrency.
        await tx.orderItem.createMany({
          data: lineItems.map((item) => ({
            orderId: newOrder.id,
            productId: item.product.id,
            productName: item.product.name,
            productSku: item.product.sku,
            productImage: item.product.images[0]?.imageUrl || null,
            colorName: item.color?.name ?? null,
            colorId: item.color?.id ?? null,
            price: item.product.price,
            quantity: item.quantity,
            subtotal: Number(item.product.price) * item.quantity,
          })),
        });

        // 3. Remove only the checked-out items from cart (leave others untouched).
        //    Guests have no DB cart, so nothing to delete.
        if (checkedOutCartItemIds.length > 0) {
          await tx.cartItem.deleteMany({
            where: { id: { in: checkedOutCartItemIds } },
          });
        }

        // 4. Increment discount usage — atomically guarded by the usage limit.
        if (discountId) {
          const discDec = await tx.discount.updateMany({
            where: {
              id: discountId,
              ...(discountUsageLimit != null
                ? { usedCount: { lt: discountUsageLimit } }
                : {}),
            },
            data: { usedCount: { increment: 1 } },
          });
          if (discDec.count === 0) {
            throw new ConflictError(
              "This discount code has reached its usage limit.",
            );
          }

          // Record the per-user redemption (idempotent — ignores a duplicate).
          if (discountOncePerUser && jwtPayload) {
            await tx.discountRedemption.createMany({
              data: {
                discountId,
                userId: jwtPayload.userId,
                orderId: newOrder.id,
              },
              skipDuplicates: true,
            });
          }
        }

        // 5. Record the idempotency key so a retry returns this same order.
        if (idempotencyKey) {
          await tx.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              orderId: newOrder.id,
              userId: jwtPayload?.userId ?? null,
            },
          });
        }

        // 6. Hand back just the id — the full order is read after commit.
        return newOrder.id;
            },
            { maxWait: 5000, timeout: 15000 },
          ),
        );

        // Read the committed order (outside the transaction, so it doesn't
        // extend the connection hold) for the response payload.
        order = await prisma.order.findUnique({
          where: { id: createdId },
          include: {
            items: true,
            appliedDiscount: true, // ✅ Include discount details
          },
        });
      } catch (e: any) {
        // Lost the idempotency-key race → return the order the winner created.
        if (idempotencyKey && e?.code === "P2002") {
          const prior = await prisma.idempotencyKey.findUnique({
            where: { key: idempotencyKey },
          });
          if (prior?.orderId) {
            const dupOrder = await prisma.order.findUnique({
              where: { id: prior.orderId },
              include: { items: true, appliedDiscount: true },
            });
            return ResponseUtil.success(
              res,
              dupOrder,
              "Order placed successfully",
              201,
            );
          }
        }
        throw e;
      }
      // Send emails in background — don't block the response
      if (order) {
        const orderDate = new Date(order.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const shippingAddress = [
          order.shippingFullName,
          order.shippingAddressLine1,
          order.shippingAddressLine2,
          `${order.shippingCity}, ${order.shippingProvince} ${order.shippingPostalCode ?? ""}`,
          `Phone: ${order.shippingPhone}`,
        ]
          .filter(Boolean)
          .join("\n");

        const orderItems = order.items.map((item) => ({
          name: item.productName,
          quantity: item.quantity,
          price: parseFloat(item.price.toString()),
        }));

        const emailData = {
          customerName: order.shippingFullName,
          orderNumber: order.orderNumber,
          orderDate,
          items: orderItems,
          subtotal: parseFloat(order.subtotal.toString()),
          shippingCost: parseFloat(order.shippingCost.toString()),
          discount: parseFloat(order.discount.toString()),
          total: parseFloat(order.total.toString()),
          paymentMethod: order.paymentMethod || "Cash on Delivery",
          shippingAddress,
        };

        // Fire-and-forget both emails — order is saved, no reason to block customer
        void EmailService.sendEmail({
          to: order.shippingEmail,
          subject: `Order Confirmation - ${order.orderNumber}`,
          html: generateCustomerOrderEmail(emailData),
        }).catch((err) =>
          logger.warn({ err: err?.message }, "customer order email failed"),
        );

        void EmailService.sendEmail({
          to: config.adminNotificationEmail,
          subject: `New Order Received - ${order.orderNumber}`,
          html: generateAdminOrderNotification({
            ...emailData,
            customerEmail: order.shippingEmail,
            customerPhone: order.shippingPhone,
          }),
        }).catch((err) =>
          logger.warn({ err: err?.message }, "admin order email failed"),
        );
      }

      return ResponseUtil.success(res, order, "Order placed successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  // Get user's orders
  static async getUserOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, paymentStatus, page = 1, limit = 20, search } = req.query;
      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;
      const jwtPayload = (req as any).jwtPayload as JwtPayload;

      const where: any = { userId: jwtPayload.userId };

      if (status) {
        where.status = status;
      }

      if (paymentStatus) {
        where.paymentStatus = paymentStatus;
      }

      if (search) {
        where.OR = [
          { orderNumber: { contains: search as string, mode: "insensitive" } },
          {
            shippingFullName: {
              contains: search as string,
              mode: "insensitive",
            },
          },
          {
            shippingPhone: {
              contains: search as string,
              mode: "insensitive",
            },
          },
        ];
      }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include: {
            items: {
              include: {
                product: {
                  include: { brand: true },
                },
              },
            },
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          skip,
          take: limitNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.order.count({ where }),
      ]);

      return ResponseUtil.success(
        res,
        {
          data: orders,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        },
        "Orders retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Get single order by order number
  static async getOrderByNumber(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { orderNumber } = req.params;
      const jwtPayload = (req as any).jwtPayload as JwtPayload | undefined;
      const { email } = req.query;

      const order = await prisma.order.findUnique({
        where: { orderNumber },
        include: {
          items: true,
        },
      });

      if (!order) {
        throw new NotFoundError("Order not found");
      }

      if (order.userId !== null) {
        // Owned order — only the owner may view it.
        if (!jwtPayload || jwtPayload.userId !== order.userId) {
          throw new NotFoundError("Order not found");
        }
      } else {
        // Guest order — allow lookup by order number. If an email is provided,
        // require it to match the order's shipping email for a bit more safety.
        if (
          email &&
          (email as string).toLowerCase() !== order.shippingEmail.toLowerCase()
        ) {
          throw new NotFoundError("Order not found");
        }
      }

      return ResponseUtil.success(res, order, "Order retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // ==================== ADMIN ENDPOINTS ====================

  // Get all orders (Admin). Superadmin sees every order; a vendor sees only
  // orders containing their products, with the order trimmed to their own items.
  static async getAllOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const { status, paymentStatus, page = 1, limit = 20, search } = req.query;
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const isSuper = jwtPayload.role === ROLES.SUPERADMIN;
      const ownerId = jwtPayload.userId;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      // Build filter
      const where: any = {};

      if (status) {
        where.status = status;
      }

      if (paymentStatus) {
        where.paymentStatus = paymentStatus;
      }

      if (search) {
        where.OR = [
          { orderNumber: { contains: search as string, mode: "insensitive" } },
          {
            shippingFullName: {
              contains: search as string,
              mode: "insensitive",
            },
          },
          {
            shippingPhone: {
              contains: search as string,
              mode: "insensitive",
            },
          },
        ];
      }

      // Vendors only see orders that include at least one of their products.
      if (!isSuper) {
        where.items = { some: { product: { ownerId } } };
      }

      // Get orders with pagination
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          include: {
            // For a vendor, only return their own line items.
            items: {
              where: isSuper ? undefined : { product: { ownerId } },
              include: {
                product: {
                  include: { brand: true },
                },
              },
            },
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          skip,
          take: limitNum,
          orderBy: { createdAt: "desc" },
        }),
        prisma.order.count({ where }),
      ]);

      // For vendors, attach their share of each order (sum of their item subtotals).
      const data = isSuper
        ? orders
        : orders.map((order) => ({
            ...order,
            vendorSubtotal: order.items
              .reduce((sum, item) => sum + Number(item.subtotal), 0)
              .toFixed(2),
          }));

      return ResponseUtil.success(
        res,
        {
          data,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        },
        "Orders retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Get single order by ID (Admin). Superadmin sees the full order; a vendor
  // sees it only if it contains their products, trimmed to their own items.
  static async getOrderById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const orderId = parseInt(id);
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const isSuper = jwtPayload.role === ROLES.SUPERADMIN;
      const ownerId = jwtPayload.userId;

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: { select: { id: true, ownerId: true } },
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundError("Order not found");
      }

      if (isSuper) {
        return ResponseUtil.success(res, order, "Order retrieved successfully");
      }

      // Vendor view: keep only their items; if none, hide the order's existence.
      const vendorItems = order.items.filter(
        (item) => item.product?.ownerId === ownerId,
      );

      if (vendorItems.length === 0) {
        throw new NotFoundError("Order not found");
      }

      const vendorSubtotal = vendorItems
        .reduce((sum, item) => sum + Number(item.subtotal), 0)
        .toFixed(2);

      return ResponseUtil.success(
        res,
        { ...order, items: vendorItems, vendorSubtotal },
        "Order retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Update order status (Admin)
  static async updateOrderStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      const { status, adminNote }: UpdateOrderStatusRequest = req.body;

      const orderId = parseInt(id);

      if (!status) {
        throw new BadRequestError("Status is required");
      }

      const validStatuses = [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ];

      if (!validStatuses.includes(status)) {
        throw new BadRequestError(
          `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }

      // Check if order exists
      const existingOrder = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
        },
      });

      if (!existingOrder) {
        throw new NotFoundError("Order not found");
      }

      // Check if order is already cancelled
      if (existingOrder.status === "cancelled" && status === "cancelled") {
        throw new BadRequestError("Order is already cancelled");
      }

      // ✅ NEW: If cancelling order, restore stock and discount usage
      if (status === "cancelled" && existingOrder.status !== "cancelled") {
        await prisma.$transaction(async (tx) => {
          // 1. Restore stock for each item (aggregate + the specific color)
          for (const item of existingOrder.items) {
            await tx.product.update({
              where: { id: item.productId },
              data: {
                stockQuantity: {
                  increment: item.quantity,
                },
              },
            });

            if (item.colorId) {
              await tx.productColor.update({
                where: { id: item.colorId },
                data: {
                  stockQuantity: {
                    increment: item.quantity,
                  },
                },
              });
            }
          }

          // 2. Decrement discount usage count (if discount was used)
          if (existingOrder.discountId) {
            await tx.discount.update({
              where: { id: existingOrder.discountId },
              data: {
                usedCount: {
                  decrement: 1,
                },
              },
            });
          }

          // 3. Update order status
          await tx.order.update({
            where: { id: orderId },
            data: {
              status,
              adminNote: adminNote || existingOrder.adminNote,
            },
          });
        });
      } else {
        // Normal status update (not cancelling)
        await prisma.order.update({
          where: { id: orderId },
          data: {
            status,
            adminNote: adminNote || existingOrder.adminNote,
          },
        });
      }

      // Record the transition in the audit trail.
      if (status !== existingOrder.status) {
        await prisma.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: existingOrder.status,
            toStatus: status,
            changedById: (req as any).jwtPayload?.userId ?? null,
            note: adminNote || null,
          },
        });
      }

      // Fetch updated order with items
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          appliedDiscount: true,
        },
      });

      return ResponseUtil.success(
        res,
        order,
        "Order status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Update payment status (Admin)
  static async updatePaymentStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      const { paymentStatus, adminNote }: UpdatePaymentStatusRequest = req.body;

      const orderId = parseInt(id);

      if (!paymentStatus) {
        throw new BadRequestError("Payment status is required");
      }

      const validStatuses = ["pending", "paid", "failed"];

      if (!validStatuses.includes(paymentStatus)) {
        throw new BadRequestError(
          `Invalid payment status. Must be one of: ${validStatuses.join(", ")}`,
        );
      }

      // Check if order exists
      const existingOrder = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!existingOrder) {
        throw new NotFoundError("Order not found");
      }

      // Update payment status
      const order = await prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus,
          adminNote: adminNote || existingOrder.adminNote,
        },
        include: {
          items: true,
        },
      });

      return ResponseUtil.success(
        res,
        order,
        "Payment status updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Cancel own order (Customer). Only before it ships; restores stock/discount.
  static async cancelOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const orderId = parseInt(req.params.id);
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const { reason } = req.body as { reason?: string };

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order || order.userId !== jwtPayload.userId) {
        throw new NotFoundError("Order not found");
      }

      const cancellable = ["pending", "confirmed", "processing"];
      if (!cancellable.includes(order.status)) {
        throw new BadRequestError(
          `This order can no longer be cancelled (status: ${order.status}).`,
        );
      }

      await prisma.$transaction(async (tx) => {
        // Restore stock (aggregate + color).
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: item.quantity } },
          });
          if (item.colorId) {
            await tx.productColor.update({
              where: { id: item.colorId },
              data: { stockQuantity: { increment: item.quantity } },
            });
          }
        }
        // Return the discount to the pool.
        if (order.discountId) {
          await tx.discount.update({
            where: { id: order.discountId },
            data: { usedCount: { decrement: 1 } },
          });
        }
        await tx.order.update({
          where: { id: orderId },
          data: { status: "cancelled" },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: order.status,
            toStatus: "cancelled",
            changedById: jwtPayload.userId,
            note: reason || "Cancelled by customer",
          },
        });
      });

      const updated = await prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      return ResponseUtil.success(res, updated, "Order cancelled successfully");
    } catch (error) {
      next(error);
    }
  }

  // Refund an order (Superadmin) — only for confirmed-fake products. Records a
  // manual refund (no payment provider) and marks the order refunded.
  static async refundOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const orderId = parseInt(req.params.id);
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const { reason, amount } = req.body as {
        reason: string;
        amount?: number;
      };

      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });
      if (!order) {
        throw new NotFoundError("Order not found");
      }
      if (order.status === "refunded") {
        throw new BadRequestError("Order has already been refunded.");
      }

      const refundAmount = amount ?? Number(order.total);

      const refund = await prisma.$transaction(async (tx) => {
        const created = await tx.refund.create({
          data: {
            orderId,
            amount: refundAmount,
            reason, // e.g. "fake product"
            createdById: jwtPayload.userId,
          },
        });
        await tx.order.update({
          where: { id: orderId },
          data: { status: "refunded", paymentStatus: "failed" },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: order.status,
            toStatus: "refunded",
            changedById: jwtPayload.userId,
            note: `Refund: ${reason}`,
          },
        });
        return created;
      });

      await writeAudit({
        actorId: jwtPayload.userId,
        action: "order.refund",
        entity: "order",
        entityId: orderId,
        meta: { amount: refundAmount, reason },
      });

      return ResponseUtil.success(res, refund, "Refund recorded successfully");
    } catch (error) {
      next(error);
    }
  }

  // ==================== HELPER METHODS ====================

  // Generate a hard-to-guess unique order number. Sequential numbers let anyone
  // enumerate guest orders via the public lookup, so we use a random suffix
  // (no ambiguous chars) and retry on the rare collision.
  private static async generateOrderNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

    for (let attempt = 0; attempt < 5; attempt++) {
      let token = "";
      const bytes = crypto.randomBytes(10);
      for (let i = 0; i < 10; i++) token += alphabet[bytes[i] % alphabet.length];
      const orderNumber = `ORD-${year}-${token}`;

      const clash = await prisma.order.findUnique({ where: { orderNumber } });
      if (!clash) return orderNumber;
    }
    // Extremely unlikely; fall back to a timestamp-based token.
    return `ORD-${year}-${Date.now().toString(36).toUpperCase()}`;
  }
}
