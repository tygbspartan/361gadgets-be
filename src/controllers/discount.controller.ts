import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/customError.util";
import {
  CreateDiscountRequest,
  UpdateDiscountRequest,
  ApplyDiscountRequest,
} from "../types/discount.types";
import { JwtPayload } from "../types/auth.types";
import { assertOwnership } from "../utils/ownership.util";
import { ROLES } from "../constants/roles.constants";

// Forbidden message reused across owner-scoped discount actions
const DISCOUNT_FORBIDDEN = "You can only manage your own discounts.";

export class DiscountController {
  // ==================== ADMIN ENDPOINTS ====================

  // Create discount (Admin/Vendor)
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const {
        name,
        code,
        type,
        value,
        minPurchaseAmount,
        maxDiscountAmount,
        startDate,
        endDate,
        usageLimit,
        productIds,
      }: CreateDiscountRequest = req.body;

      // Validation
      if (!name || !code || !type || !value || !startDate || !endDate) {
        throw new BadRequestError(
          "Name, code, type, value, start date, and end date are required",
        );
      }

      if (type !== "percentage" && type !== "fixed") {
        throw new BadRequestError('Type must be "percentage" or "fixed"');
      }

      if (value <= 0) {
        throw new BadRequestError("Value must be greater than 0");
      }

      if (type === "percentage" && value > 100) {
        throw new BadRequestError("Percentage value cannot exceed 100");
      }

      // Check if code already exists
      const existingCode = await prisma.discount.findUnique({
        where: { code: code.toUpperCase() },
      });

      if (existingCode) {
        throw new ConflictError(`Discount code "${code}" already exists`);
      }

      // Validate dates
      const start = new Date(startDate);
      const end = new Date(endDate);

      if (end <= start) {
        throw new BadRequestError("End date must be after start date");
      }

      // ✅ Validate product IDs if provided
      if (productIds && productIds.length > 0) {
        const products = await prisma.product.findMany({
          where: {
            id: {
              in: productIds,
            },
          },
          select: { id: true, ownerId: true },
        });

        if (products.length !== productIds.length) {
          const foundIds = products.map((p) => p.id);
          const missingIds = productIds.filter((id) => !foundIds.includes(id));
          throw new BadRequestError(
            `Products with IDs ${missingIds.join(", ")} not found`,
          );
        }

        // A vendor may only attach a discount to their own products
        if (jwtPayload.role !== ROLES.SUPERADMIN) {
          const foreign = products.filter((p) => p.ownerId !== jwtPayload.userId);
          if (foreign.length > 0) {
            throw new BadRequestError(
              "You can only attach discounts to your own products",
            );
          }
        }
      }

      // Create discount (owned by the creating vendor)
      const discount = await prisma.discount.create({
        data: {
          name,
          code: code.toUpperCase(),
          type,
          value,
          minPurchaseAmount,
          maxDiscountAmount,
          startDate: start,
          endDate: end,
          usageLimit,
          ownerId: jwtPayload.userId,
        },
      });

      // Link to specific products if provided
      if (productIds && productIds.length > 0) {
        await Promise.all(
          productIds.map((productId) =>
            prisma.productDiscount.create({
              data: {
                productId,
                discountId: discount.id,
              },
            }),
          ),
        );
      }

      // Fetch discount with products
      const discountWithProducts = await prisma.discount.findUnique({
        where: { id: discount.id },
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
        },
      });

      return ResponseUtil.success(
        res,
        discountWithProducts,
        "Discount created successfully",
        201,
      );
    } catch (error) {
      next(error);
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

      const discounts = await prisma.discount.findMany({
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
      });

      return ResponseUtil.success(
        res,
        discounts,
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
        where: { id: parseInt(id) },
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

  // Update discount (Admin)
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updateData: UpdateDiscountRequest = req.body;

      const discountId = parseInt(id);

      // Check if discount exists
      const existingDiscount = await prisma.discount.findUnique({
        where: { id: discountId },
      });

      if (!existingDiscount) {
        throw new NotFoundError("Discount not found");
      }

      // A vendor may only edit their own discount (superadmin bypasses).
      assertOwnership(
        existingDiscount.ownerId,
        (req as any).jwtPayload as JwtPayload,
        DISCOUNT_FORBIDDEN,
      );

      // Check if code is being updated and already exists
      if (updateData.code && updateData.code !== existingDiscount.code) {
        const codeExists = await prisma.discount.findUnique({
          where: { code: updateData.code.toUpperCase() },
        });

        if (codeExists) {
          throw new ConflictError("Discount code already exists");
        }
      }

      // Validate dates if provided
      if (updateData.startDate || updateData.endDate) {
        const start = updateData.startDate
          ? new Date(updateData.startDate)
          : existingDiscount.startDate;
        const end = updateData.endDate
          ? new Date(updateData.endDate)
          : existingDiscount.endDate;

        if (end <= start) {
          throw new BadRequestError("End date must be after start date");
        }
      }

      // Update discount
      const dataToUpdate: any = { ...updateData };

      // Never let the owner be reassigned via the request body.
      delete dataToUpdate.ownerId;

      if (updateData.code) {
        dataToUpdate.code = updateData.code.toUpperCase();
      }

      if (updateData.startDate) {
        dataToUpdate.startDate = new Date(updateData.startDate);
      }

      if (updateData.endDate) {
        dataToUpdate.endDate = new Date(updateData.endDate);
      }

      const discount = await prisma.discount.update({
        where: { id: discountId },
        data: dataToUpdate,
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
        },
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
      const discountId = parseInt(id);

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

  // Validate and apply discount code (Customer)
  static async validateCode(req: Request, res: Response, next: NextFunction) {
    try {
      const { code, cartSubtotal }: ApplyDiscountRequest = req.body;

      if (!code) {
        throw new BadRequestError("Discount code is required");
      }

      if (!cartSubtotal || cartSubtotal <= 0) {
        throw new BadRequestError("Valid cart subtotal is required");
      }

      // Find discount by code
      const discount = await prisma.discount.findUnique({
        where: { code: code.toUpperCase() },
      });

      if (!discount) {
        return ResponseUtil.success(
          res,
          {
            valid: false,
            message: "Invalid discount code",
          },
          "Discount code validation failed",
        );
      }

      // Check if active
      if (!discount.isActive) {
        return ResponseUtil.success(
          res,
          {
            valid: false,
            message: "This discount code is no longer active",
          },
          "Discount code validation failed",
        );
      }

      // Check if expired
      const now = new Date();
      if (now < discount.startDate || now > discount.endDate) {
        return ResponseUtil.success(
          res,
          {
            valid: false,
            message: "This discount code has expired",
          },
          "Discount code validation failed",
        );
      }

      // Check usage limit
      if (discount.usageLimit && discount.usedCount >= discount.usageLimit) {
        return ResponseUtil.success(
          res,
          {
            valid: false,
            message: "This discount code has reached its usage limit",
          },
          "Discount code validation failed",
        );
      }

      // Check minimum purchase amount
      if (
        discount.minPurchaseAmount &&
        cartSubtotal < Number(discount.minPurchaseAmount)
      ) {
        return ResponseUtil.success(
          res,
          {
            valid: false,
            message: `Minimum purchase amount of Rs ${discount.minPurchaseAmount} required`,
          },
          "Discount code validation failed",
        );
      }

      // Calculate discount amount
      let discountAmount = 0;

      if (discount.type === "percentage") {
        discountAmount = (cartSubtotal * Number(discount.value)) / 100;
      } else {
        // fixed
        discountAmount = Number(discount.value);
      }

      // Apply max discount cap if set
      if (
        discount.maxDiscountAmount &&
        discountAmount > Number(discount.maxDiscountAmount)
      ) {
        discountAmount = Number(discount.maxDiscountAmount);
      }

      // Discount cannot exceed cart subtotal
      if (discountAmount > cartSubtotal) {
        discountAmount = cartSubtotal;
      }

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
            discountAmount: Math.round(discountAmount * 100) / 100, // Round to 2 decimals
          },
        },
        "Discount code is valid",
      );
    } catch (error) {
      next(error);
    }
  }
}
