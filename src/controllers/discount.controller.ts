import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { parseId } from "../utils/parseId.util";
import { parsePagination } from "../utils/pagination.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/customError.util";
import type { z } from "zod";
import type {
  createDiscountSchema,
  updateDiscountSchema,
  validateDiscountSchema,
} from "../validators/schemas";
import { JwtPayload } from "../types/auth.types";
import { assertOwnership } from "../utils/ownership.util";
import { evaluateDiscount, linesFromItems } from "../services/discount.service";
import { ROLES } from "../constants/roles.constants";

// Forbidden message reused across owner-scoped discount actions
const DISCOUNT_FORBIDDEN = "You can only manage your own discounts.";

type CreateDiscountInput = z.output<typeof createDiscountSchema>;
type UpdateDiscountInput = z.output<typeof updateDiscountSchema>;

// Returned with a created/updated discount so the admin UI can list products.
const DISCOUNT_PRODUCTS_INCLUDE = {
  products: {
    include: { product: { select: { id: true, name: true } } },
  },
} as const;

export class DiscountController {
  // ==================== ADMIN ENDPOINTS ====================

  // Create discount (Admin/Vendor). Body is validated by createDiscountSchema.
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const { productIds, ...fields } = req.body as CreateDiscountInput;

      const existingCode = await prisma.discount.findUnique({
        where: { code: fields.code },
      });
      if (existingCode) {
        throw new ConflictError(`Discount code "${fields.code}" already exists`);
      }

      if (productIds?.length) {
        await DiscountController.assertLinkableProducts(productIds, jwtPayload);
      }

      // Discount and its product links together: a failure leaves neither.
      const discount = await prisma.$transaction(async (tx) => {
        const created = await tx.discount.create({
          data: {
            ...fields,
            isActive: fields.isActive ?? true,
            oncePerUser: fields.oncePerUser ?? false,
            ownerId: jwtPayload.userId,
          },
        });
        if (productIds?.length) {
          await tx.productDiscount.createMany({
            data: productIds.map((productId) => ({ productId, discountId: created.id })),
          });
        }
        return tx.discount.findUnique({
          where: { id: created.id },
          include: DISCOUNT_PRODUCTS_INCLUDE,
        });
      });

      return ResponseUtil.success(
        res,
        discount,
        "Discount created successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // Products must exist, and a vendor may only link their own.
  private static async assertLinkableProducts(
    productIds: number[],
    jwtPayload: JwtPayload,
  ): Promise<void> {
    const uniqueIds = [...new Set(productIds)];
    const products = await prisma.product.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, ownerId: true },
    });

    if (products.length !== uniqueIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = uniqueIds.filter((id) => !found.has(id));
      throw new BadRequestError(`Products with IDs ${missing.join(", ")} not found`);
    }

    if (
      jwtPayload.role !== ROLES.SUPERADMIN &&
      products.some((p) => p.ownerId !== jwtPayload.userId)
    ) {
      throw new BadRequestError("You can only attach discounts to your own products");
    }
  }

  // Get all discounts (Admin/Vendor — scoped to owner)
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const { isActive, type, search } = req.query;

      // Build filter — vendors only see their own discounts
      const where: any = {};
      if (jwtPayload.role !== ROLES.SUPERADMIN) {
        where.ownerId = jwtPayload.userId;
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      if (type) {
        where.type = type;
      }

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          {
            code: {
              contains: search as string,
              mode: "insensitive",
            },
          },
        ];
      }

      const { pageNum, limitNum, skip } = parsePagination(
        req.query.page,
        req.query.limit,
      );

      const [discounts, total] = await Promise.all([
        prisma.discount.findMany({
          where,
          include: {
            products: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            _count: {
              select: {
                orders: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limitNum,
        }),
        prisma.discount.count({ where }),
      ]);

      // Same list shape as orders/products, so the admin table can page.
      return ResponseUtil.success(
        res,
        {
          data: discounts,
          pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum),
          },
        },
        "Discounts retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Get single discount (Admin)
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const discount = await prisma.discount.findUnique({
        where: { id: parseId(id) },
        include: {
          products: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                },
              },
            },
          },
          _count: {
            select: {
              orders: true,
            },
          },
        },
      });

      if (!discount) {
        throw new NotFoundError("Discount not found");
      }

      assertOwnership(
        discount.ownerId,
        (req as any).jwtPayload as JwtPayload,
        DISCOUNT_FORBIDDEN,
      );

      return ResponseUtil.success(
        res,
        discount,
        "Discount retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Update discount (Admin/Vendor). Body is validated by updateDiscountSchema,
  // so only editable fields arrive (never usedCount or ownerId).
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const discountId = parseId(req.params.id);
      const { productIds, ...fields } = req.body as UpdateDiscountInput;

      const existing = await prisma.discount.findUnique({
        where: { id: discountId },
      });
      if (!existing) {
        throw new NotFoundError("Discount not found");
      }

      // A vendor may only edit their own discount (superadmin bypasses).
      assertOwnership(existing.ownerId, jwtPayload, DISCOUNT_FORBIDDEN);

      if (fields.code && fields.code !== existing.code) {
        const codeExists = await prisma.discount.findUnique({
          where: { code: fields.code },
        });
        if (codeExists) {
          throw new ConflictError("Discount code already exists");
        }
      }

      // Cross-field checks against the values the discount will end up with.
      const type = fields.type ?? existing.type;
      const value = fields.value ?? Number(existing.value);
      if (type === "percentage" && value > 100) {
        throw new BadRequestError("Percentage can't exceed 100");
      }

      const start = fields.startDate ?? existing.startDate;
      const end = fields.endDate ?? existing.endDate;
      if (end <= start) {
        throw new BadRequestError("End date must be after start date");
      }

      if (fields.usageLimit != null && fields.usageLimit < existing.usedCount) {
        throw new BadRequestError(
          `Usage limit can't be lower than the ${existing.usedCount} times this code has already been used. To stop it, set it to inactive.`,
        );
      }

      if (productIds?.length) {
        await DiscountController.assertLinkableProducts(productIds, jwtPayload);
      }

      const discount = await prisma.$transaction(async (tx) => {
        await tx.discount.update({ where: { id: discountId }, data: fields });
        // productIds, when sent, replaces the links (an empty array clears them).
        if (productIds) {
          await tx.productDiscount.deleteMany({ where: { discountId } });
          if (productIds.length) {
            await tx.productDiscount.createMany({
              data: [...new Set(productIds)].map((productId) => ({ productId, discountId })),
            });
          }
        }
        return tx.discount.findUnique({
          where: { id: discountId },
          include: DISCOUNT_PRODUCTS_INCLUDE,
        });
      });

      return ResponseUtil.success(
        res,
        discount,
        "Discount updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Delete discount (Admin)
  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const discountId = parseId(id);

      // Check if discount exists
      const discount = await prisma.discount.findUnique({
        where: { id: discountId },
      });

      if (!discount) {
        throw new NotFoundError("Discount not found");
      }

      // A vendor may only delete their own discount (superadmin bypasses).
      assertOwnership(
        discount.ownerId,
        (req as any).jwtPayload as JwtPayload,
        DISCOUNT_FORBIDDEN,
      );

      // Delete discount (cascade will delete product links)
      await prisma.discount.delete({
        where: { id: discountId },
      });

      return ResponseUtil.success(res, null, "Discount deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  // ==================== CUSTOMER ENDPOINTS ====================

  // Validate a discount code for the checkout "Apply" button (Customer or
  // guest). Body is validated by validateDiscountSchema. Uses the same rules
  // as checkout (evaluateDiscount), priced from the server's product data, so
  // a code accepted here only fails at Place Order if something changed.
  static async validateCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, items } = req.body as z.output<typeof validateDiscountSchema>;
      const jwtPayload = (req as any).jwtPayload as JwtPayload | undefined;

      const result = await evaluateDiscount(
        code,
        await linesFromItems(items),
        jwtPayload?.userId ?? null,
      );

      if (!result.ok) {
        return ResponseUtil.success(
          res,
          { valid: false, message: result.message },
          "Discount code validation failed",
        );
      }

      const { discount, amount, eligibleSubtotal } = result;
      return ResponseUtil.success(
        res,
        {
          valid: true,
          discount: {
            id: discount.id,
            name: discount.name,
            code: discount.code,
            type: discount.type,
            value: Number(discount.value),
            discountAmount: amount,
            // Lets the checkout say "applies to some items" when it's partial.
            eligibleSubtotal,
          },
        },
        "Discount code is valid",
      );
    } catch (error) {
      next(error);
    }
  }
}
