import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/customError.util";
import { AddToCartRequest, UpdateCartItemRequest } from "../types/cart.types";
import { JwtPayload } from "../types/auth.types";

export class CartController {
  // Add item to cart
  static async addToCart(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId, quantity = 1, colorId }: AddToCartRequest = req.body;
      const jwtPayload = (req as any).jwtPayload as JwtPayload;

      // Validation
      if (!productId) {
        throw new BadRequestError("Product ID is required");
      }

      if (quantity < 1) {
        throw new BadRequestError("Quantity must be at least 1");
      }

      // Check if product exists and is active
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { colors: true },
      });

      if (!product || !product.isActive) {
        throw new NotFoundError("Product not found or unavailable");
      }

      // Resolve the color variant (required when the product has colors).
      // availableStock is the per-color stock when a color is chosen, otherwise
      // the product's own stock.
      let selectedColorId: number | null = null;
      let availableStock = product.stockQuantity;

      if (product.colors.length > 0) {
        if (!colorId) {
          throw new BadRequestError(
            `Please select a color. Available: ${product.colors
              .map((c) => c.name)
              .join(", ")}`
          );
        }
        const color = product.colors.find((c) => c.id === colorId);
        if (!color) {
          throw new BadRequestError("Invalid color for this product");
        }
        selectedColorId = color.id;
        availableStock = color.stockQuantity;
      }

      // Check stock
      if (availableStock < quantity) {
        throw new BadRequestError(
          `Only ${availableStock} units available in stock`
        );
      }

      // Find existing cart item for this product + color combination
      const existingCartItem = await prisma.cartItem.findFirst({
        where: {
          userId: jwtPayload.userId,
          productId: productId,
          colorId: selectedColorId,
        },
      });

      let cartItem;

      if (existingCartItem) {
        // Update quantity
        const newQuantity = existingCartItem.quantity + quantity;

        if (availableStock < newQuantity) {
          throw new BadRequestError(
            `Cannot add more. Only ${availableStock} units available`
          );
        }

        cartItem = await prisma.cartItem.update({
          where: { id: existingCartItem.id },
          data: { quantity: newQuantity },
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
      } else {
        // Create new cart item
        cartItem = await prisma.cartItem.create({
          data: {
            userId: jwtPayload.userId,
            productId: productId,
            quantity: quantity,
            colorId: selectedColorId,
          },
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
      }

      return ResponseUtil.success(
        res,
        cartItem,
        "Item added to cart successfully",
        201
      );
    } catch (error) {
      next(error);
    }
  }

  // Get user's cart
  static async getCart(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;

      const cartItems = await prisma.cartItem.findMany({
        where: { userId: jwtPayload.userId },
        include: {
          color: true,
          product: {
            include: {
              images: {
                where: { isPrimary: true },
                take: 1,
              },
              brand: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      // Calculate totals
      let subtotal = 0;
      let totalItems = 0;

      const itemsWithStockStatus = cartItems.map((item) => {
        const itemTotal = Number(item.product.price) * item.quantity;
        subtotal += itemTotal;
        totalItems += item.quantity;

        // Stock status uses the selected color's stock when present.
        const availableStock = item.color
          ? item.color.stockQuantity
          : item.product.stockQuantity;

        let stockStatus: "in_stock" | "low_stock" | "out_of_stock" = "in_stock";
        if (availableStock === 0) {
          stockStatus = "out_of_stock";
        } else if (availableStock <= item.product.lowStockThreshold) {
          stockStatus = "low_stock";
        }

        return {
          ...item,
          product: {
            ...item.product,
            stockStatus,
          },
        };
      });

      const cartSummary = {
        items: itemsWithStockStatus,
        summary: {
          totalItems,
          subtotal,
          estimatedTotal: subtotal, // Will add shipping/tax later
        },
      };

      return ResponseUtil.success(
        res,
        cartSummary,
        "Cart retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  }

  // Update cart item quantity
  static async updateCartItem(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { quantity }: UpdateCartItemRequest = req.body;
      const jwtPayload = (req as any).jwtPayload as JwtPayload;

      const cartItemId = parseInt(id);

      if (!quantity || quantity < 1) {
        throw new BadRequestError("Valid quantity is required");
      }

      // Check if cart item exists and belongs to user
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: cartItemId },
        include: { product: true, color: true },
      });

      if (!cartItem || cartItem.userId !== jwtPayload.userId) {
        throw new NotFoundError("Cart item not found");
      }

      // Check stock availability (per-color when a color was selected)
      const availableStock = cartItem.color
        ? cartItem.color.stockQuantity
        : cartItem.product.stockQuantity;
      if (availableStock < quantity) {
        throw new BadRequestError(
          `Only ${availableStock} units available in stock`
        );
      }

      // Update quantity
      const updatedCartItem = await prisma.cartItem.update({
        where: { id: cartItemId },
        data: { quantity },
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

      return ResponseUtil.success(
        res,
        updatedCartItem,
        "Cart item updated successfully"
      );
    } catch (error) {
      next(error);
    }
  }

  // Remove item from cart
  static async removeFromCart(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const jwtPayload = (req as any).jwtPayload as JwtPayload;

      const cartItemId = parseInt(id);

      // Check if cart item exists and belongs to user
      const cartItem = await prisma.cartItem.findUnique({
        where: { id: cartItemId },
      });

      if (!cartItem || cartItem.userId !== jwtPayload.userId) {
        throw new NotFoundError("Cart item not found");
      }

      // Delete cart item
      await prisma.cartItem.delete({
        where: { id: cartItemId },
      });

      return ResponseUtil.success(res, null, "Item removed from cart");
    } catch (error) {
      next(error);
    }
  }

  // Merge a guest cart into the logged-in user's cart. Called by the frontend
  // once, right after login/register. Best-effort: unavailable products or
  // out-of-stock lines are skipped rather than failing the whole merge, so the
  // user never loses their session over one stale item.
  static async mergeCart(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const { items } = req.body as {
        items: { productId: number; quantity: number; colorId?: number }[];
      };

      for (const line of items) {
        const product = await prisma.product.findUnique({
          where: { id: line.productId },
          include: { colors: true },
        });
        if (!product || !product.isActive) continue;

        // Resolve color + available stock the same way addToCart does.
        let selectedColorId: number | null = null;
        let availableStock = product.stockQuantity;
        if (product.colors.length > 0) {
          const color = line.colorId
            ? product.colors.find((c) => c.id === line.colorId)
            : undefined;
          if (!color) continue; // color required but missing/invalid — skip
          selectedColorId = color.id;
          availableStock = color.stockQuantity;
        }
        if (availableStock < 1) continue;

        const existing = await prisma.cartItem.findFirst({
          where: {
            userId: jwtPayload.userId,
            productId: line.productId,
            colorId: selectedColorId,
          },
        });

        // Cap the merged quantity at available stock.
        const desired = (existing?.quantity ?? 0) + line.quantity;
        const quantity = Math.min(desired, availableStock);
        if (quantity < 1) continue;

        if (existing) {
          await prisma.cartItem.update({
            where: { id: existing.id },
            data: { quantity },
          });
        } else {
          await prisma.cartItem.create({
            data: {
              userId: jwtPayload.userId,
              productId: line.productId,
              quantity,
              colorId: selectedColorId,
            },
          });
        }
      }

      // Return the merged cart so the client can replace its local state.
      return CartController.getCart(req, res, next);
    } catch (error) {
      next(error);
    }
  }

  // Clear entire cart
  static async clearCart(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;

      await prisma.cartItem.deleteMany({
        where: { userId: jwtPayload.userId },
      });

      return ResponseUtil.success(res, null, "Cart cleared successfully");
    } catch (error) {
      next(error);
    }
  }
}
