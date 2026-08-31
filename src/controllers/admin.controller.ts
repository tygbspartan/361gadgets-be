import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { AuthService } from "../services/auth.service";
import { ResponseUtil } from "../utils/response.util";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../utils/customError.util";
import { ROLES } from "../constants/roles.constants";
import { CacheService } from "../services/cache.service";
import { StorageService } from "../services/storage.service";
import { SettingsService } from "../services/settings.service";
import { writeAudit } from "../utils/audit.util";
import { reassignBrandOwner } from "../utils/brandOwnership.util";
import {
  CreateAdminRequest,
  UpdateAdminRequest,
  SetAdminStatusRequest,
  JwtPayload,
} from "../types/auth.types";

// Fields returned for an admin/vendor account (never expose password hashes/tokens)
const ADMIN_SELECT = {
  id: true,
  email: true,
  companyName: true,
  logoUrl: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  isEmailVerified: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class AdminController {
  // Create a vendor (admin) account — superadmin only.
  static async createAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const {
        email,
        password,
        companyName,
        logoUrl,
        firstName,
        lastName,
        phone,
        brandIds,
      }: CreateAdminRequest = req.body;

      if (!email || !password) {
        throw new BadRequestError("Email and password are required");
      }

      if (!AuthService.validateEmail(email)) {
        throw new BadRequestError("Invalid email format");
      }

      const passwordValidation = AuthService.validatePassword(password);
      if (!passwordValidation.valid) {
        throw new BadRequestError(
          passwordValidation.message || "Invalid password",
        );
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        throw new ConflictError("A user with this email already exists");
      }

      // Optional initial brand assignment. The picker only offers UNASSIGNED
      // brands, so reject any id that's missing or already owned by a vendor.
      let brandIdList: number[] = [];
      if (brandIds !== undefined) {
        if (!Array.isArray(brandIds)) {
          throw new BadRequestError("brandIds must be an array of ids");
        }
        brandIdList = [
          ...new Set(
            brandIds
              .map((v) => parseInt(String(v), 10))
              .filter((n) => Number.isInteger(n) && n > 0),
          ),
        ];
        if (brandIdList.length > 0) {
          const brands = await prisma.brand.findMany({
            where: { id: { in: brandIdList } },
            select: { id: true, ownerId: true },
          });
          if (brands.length !== brandIdList.length) {
            throw new BadRequestError("One or more brand ids do not exist");
          }
          if (brands.some((b) => b.ownerId != null)) {
            throw new BadRequestError(
              "One or more selected brands are already assigned to a vendor",
            );
          }
        }
      }

      const passwordHash = await AuthService.hashPassword(password);

      const admin = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            passwordHash,
            companyName,
            logoUrl,
            // Mirror companyName into firstName when no contact name is given, so
            // existing name-display code (emails, headers) shows the vendor's name.
            firstName: firstName ?? companyName,
            lastName,
            phone,
            role: ROLES.ADMIN,
            // Superadmin-created vendors are trusted: no email verification gate
            isEmailVerified: true,
            isActive: true,
            createdById: jwtPayload.userId,
          },
          select: ADMIN_SELECT,
        });
        if (brandIdList.length > 0) {
          await tx.brand.updateMany({
            where: { id: { in: brandIdList } },
            data: { ownerId: created.id },
          });
        }
        return created;
      });

      if (brandIdList.length > 0) {
        await CacheService.invalidatePattern("brands:*");
      }

      return ResponseUtil.success(
        res,
        admin,
        "Vendor account created successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // List all vendor (admin) accounts — superadmin only.
  static async listAdmins(req: Request, res: Response, next: NextFunction) {
    try {
      const { isActive, search } = req.query;

      const where: any = { role: ROLES.ADMIN };

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      if (search) {
        where.OR = [
          { email: { contains: search as string, mode: "insensitive" } },
          { firstName: { contains: search as string, mode: "insensitive" } },
          { lastName: { contains: search as string, mode: "insensitive" } },
        ];
      }

      const admins = await prisma.user.findMany({
        where,
        select: {
          ...ADMIN_SELECT,
          _count: { select: { ownedProducts: true, ownedDiscounts: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      return ResponseUtil.success(
        res,
        admins,
        "Vendors retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Get a single vendor (admin) account — superadmin only.
  static async getAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = parseInt(req.params.id);

      const admin = await prisma.user.findFirst({
        where: { id: adminId, role: ROLES.ADMIN },
        select: {
          ...ADMIN_SELECT,
          _count: { select: { ownedProducts: true, ownedDiscounts: true } },
        },
      });

      if (!admin) {
        throw new NotFoundError("Vendor not found");
      }

      return ResponseUtil.success(res, admin, "Vendor retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Update a vendor's profile — superadmin only.
  static async updateAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = parseInt(req.params.id);
      const { companyName, logoUrl, firstName, lastName, phone }: UpdateAdminRequest =
        req.body;

      const existing = await prisma.user.findFirst({
        where: { id: adminId, role: ROLES.ADMIN },
      });

      if (!existing) {
        throw new NotFoundError("Vendor not found");
      }

      const admin = await prisma.user.update({
        where: { id: adminId },
        data: { companyName, logoUrl, firstName, lastName, phone },
        select: ADMIN_SELECT,
      });

      return ResponseUtil.success(res, admin, "Vendor updated successfully");
    } catch (error) {
      next(error);
    }
  }

  // Activate / deactivate a vendor (moderation) — superadmin only.
  static async setAdminStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = parseInt(req.params.id);
      const { isActive }: SetAdminStatusRequest = req.body;

      if (typeof isActive !== "boolean") {
        throw new BadRequestError("isActive (boolean) is required");
      }

      const existing = await prisma.user.findFirst({
        where: { id: adminId, role: ROLES.ADMIN },
      });

      if (!existing) {
        throw new NotFoundError("Vendor not found");
      }

      // Deactivating a vendor also deactivates all of their products (pulling
      // them from the store). Reactivating only restores account access —
      // products are left as-is so the vendor can re-enable them selectively.
      let deactivatedProducts = 0;
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: adminId },
          // Deactivating also revokes the vendor's existing tokens immediately.
          data: isActive ? { isActive } : { isActive, tokenVersion: { increment: 1 } },
        });

        if (!isActive) {
          const result = await tx.product.updateMany({
            where: { ownerId: adminId, isActive: true },
            data: { isActive: false },
          });
          deactivatedProducts = result.count;
        }
      });

      // The store/product lists are cached; clear so the change shows immediately.
      if (!isActive) {
        await CacheService.invalidatePattern("products:*");
      }

      const admin = await prisma.user.findUnique({
        where: { id: adminId },
        select: ADMIN_SELECT,
      });

      return ResponseUtil.success(
        res,
        admin,
        isActive
          ? "Vendor activated successfully"
          : `Vendor deactivated. ${deactivatedProducts} product(s) were set to inactive.`,
      );
    } catch (error) {
      next(error);
    }
  }

  // Upload / replace a vendor's logo file (Supabase Storage) — superadmin only.
  static async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = parseInt(req.params.id);
      const file = req.file;

      if (!file) {
        throw new BadRequestError("Logo file is required");
      }

      const vendor = await prisma.user.findFirst({
        where: { id: adminId, role: ROLES.ADMIN },
      });
      if (!vendor) {
        throw new NotFoundError("Vendor not found");
      }

      // Remove the old logo before uploading the new one.
      if (vendor.logoUrl) {
        await StorageService.deleteImage(vendor.logoUrl);
      }

      const logoUrl = await StorageService.uploadImage(file, "vendors");

      const updated = await prisma.user.update({
        where: { id: adminId },
        data: { logoUrl },
        select: ADMIN_SELECT,
      });

      return ResponseUtil.success(res, updated, "Logo uploaded successfully");
    } catch (error) {
      next(error);
    }
  }

  // Delete a vendor's logo from storage and clear the field — superadmin only.
  static async deleteLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const adminId = parseInt(req.params.id);

      const vendor = await prisma.user.findFirst({
        where: { id: adminId, role: ROLES.ADMIN },
      });
      if (!vendor) {
        throw new NotFoundError("Vendor not found");
      }
      if (!vendor.logoUrl) {
        throw new BadRequestError("Vendor has no logo to delete");
      }

      await StorageService.deleteImage(vendor.logoUrl);

      const updated = await prisma.user.update({
        where: { id: adminId },
        data: { logoUrl: null },
        select: ADMIN_SELECT,
      });

      return ResponseUtil.success(res, updated, "Logo deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  // Set the exact set of brands a vendor owns — superadmin only.
  // Assigns the given brands to this vendor (reassigning from other vendors if
  // needed) and un-assigns any of this vendor's brands not in the list.
  static async setVendorBrands(req: Request, res: Response, next: NextFunction) {
    try {
      const vendorId = parseInt(req.params.id);
      const { brandIds } = req.body as { brandIds?: unknown };

      if (!Array.isArray(brandIds)) {
        throw new BadRequestError("brandIds (array of ids) is required");
      }

      const ids = [
        ...new Set(
          brandIds
            .map((v) => parseInt(String(v), 10))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ];

      const vendor = await prisma.user.findFirst({
        where: { id: vendorId, role: ROLES.ADMIN },
        select: { id: true },
      });
      if (!vendor) {
        throw new NotFoundError("Vendor not found");
      }

      if (ids.length > 0) {
        const found = await prisma.brand.findMany({
          where: { id: { in: ids } },
          select: { id: true },
        });
        if (found.length !== ids.length) {
          throw new BadRequestError("One or more brand ids do not exist");
        }
      }

      await prisma.$transaction(async (tx) => {
        // Brands this vendor currently owns.
        const current = await tx.brand.findMany({
          where: { ownerId: vendorId },
          select: { id: true },
        });
        const targetIds = new Set(ids);

        // Release brands no longer selected — deactivates this vendor's products
        // under each (non-destructive transfer).
        for (const b of current) {
          if (!targetIds.has(b.id)) {
            await reassignBrandOwner(tx, b.id, null);
          }
        }
        // Claim newly selected brands — transfers from a prior vendor (releasing
        // their products) when one exists.
        const currentIds = new Set(current.map((b) => b.id));
        for (const id of ids) {
          if (!currentIds.has(id)) {
            await reassignBrandOwner(tx, id, vendorId);
          }
        }
      });

      await CacheService.invalidatePattern("brands:*");

      return ResponseUtil.success(
        res,
        { vendorId, brandIds: ids },
        "Vendor brands updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Per-vendor earnings & payouts — superadmin only.
  // Customers pay into the platform (superadmin) account, so this reports how
  // much each vendor generated and how much the platform still owes them.
  //
  // Definitions (cancelled orders are excluded entirely):
  //   grossSales     = sum of the vendor's order-item subtotals (price × qty)
  //   amountOwed     = the vendor's share on orders that are BOTH paid
  //                    (paymentStatus = "paid") AND fulfilled (status = "delivered")
  //                    — i.e. payable to the vendor now
  //   pendingPayout  = grossSales − amountOwed (sold but not yet payable)
  //
  // Note: figures are the vendor's item subtotals only — shipping and other
  // vendors' items are never attributed here. No platform commission is applied.
  //
  // Optional query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD (defaults to all time).
  static async getVendorEarnings(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { startDate, endDate } = req.query;

      const orderWhere: any = { status: { not: "cancelled" } };
      if (startDate || endDate) {
        orderWhere.createdAt = {};
        if (startDate) orderWhere.createdAt.gte = new Date(startDate as string);
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          orderWhere.createdAt.lte = end;
        }
      }

      // Every vendor-owned order item in scope.
      const items = await prisma.orderItem.findMany({
        where: {
          product: { ownerId: { not: null } },
          order: orderWhere,
        },
        select: {
          subtotal: true,
          quantity: true,
          product: { select: { ownerId: true } },
          order: { select: { id: true, status: true, paymentStatus: true } },
        },
      });

      // Aggregate per vendor.
      type Agg = {
        grossSales: number;
        owed: number;
        unitsSold: number;
        orderIds: Set<number>;
      };
      const byVendor = new Map<number, Agg>();

      for (const item of items) {
        const ownerId = item.product.ownerId as number;
        let agg = byVendor.get(ownerId);
        if (!agg) {
          agg = {
            grossSales: 0,
            owed: 0,
            unitsSold: 0,
            orderIds: new Set<number>(),
          };
          byVendor.set(ownerId, agg);
        }
        const amount = parseFloat(item.subtotal.toString());
        agg.grossSales += amount;
        agg.unitsSold += item.quantity;
        agg.orderIds.add(item.order.id);
        // Payable only once the order is both collected and fulfilled.
        if (
          item.order.paymentStatus === "paid" &&
          item.order.status === "delivered"
        ) {
          agg.owed += amount;
        }
      }

      // Include every vendor (even those with zero sales) with their profile.
      const vendors = await prisma.user.findMany({
        where: { role: ROLES.ADMIN },
        select: {
          id: true,
          email: true,
          companyName: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const data = vendors.map((v) => {
        const agg = byVendor.get(v.id);
        const grossSales = agg?.grossSales ?? 0;
        const owed = agg?.owed ?? 0;
        return {
          vendorId: v.id,
          vendor: {
            id: v.id,
            email: v.email,
            companyName: v.companyName,
            name:
              [v.firstName, v.lastName].filter(Boolean).join(" ") ||
              v.companyName ||
              v.email,
            isActive: v.isActive,
          },
          unitsSold: agg?.unitsSold ?? 0,
          orderCount: agg ? agg.orderIds.size : 0,
          grossSales: grossSales.toFixed(2),
          amountOwed: owed.toFixed(2),
          pendingPayout: (grossSales - owed).toFixed(2),
        };
      });

      // Most owed first.
      data.sort((a, b) => parseFloat(b.amountOwed) - parseFloat(a.amountOwed));

      const totals = data.reduce(
        (acc, d) => {
          acc.grossSales += parseFloat(d.grossSales);
          acc.amountOwed += parseFloat(d.amountOwed);
          acc.pendingPayout += parseFloat(d.pendingPayout);
          return acc;
        },
        { grossSales: 0, amountOwed: 0, pendingPayout: 0 },
      );

      return ResponseUtil.success(
        res,
        {
          dateRange: {
            start: startDate
              ? new Date(startDate as string).toISOString()
              : null,
            end: endDate ? new Date(endDate as string).toISOString() : null,
          },
          totals: {
            grossSales: totals.grossSales.toFixed(2),
            amountOwed: totals.amountOwed.toFixed(2),
            pendingPayout: totals.pendingPayout.toFixed(2),
          },
          vendors: data,
        },
        "Vendor earnings retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Order-by-order earnings breakdown for a single vendor — superadmin only.
  // Lists each non-cancelled order that includes the vendor's products, with
  // only that vendor's line items and their subtotal, plus whether it's payable
  // (payable = paymentStatus "paid" AND status "delivered"). Useful for payout
  // reconciliation. Optional query: ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD.
  static async getVendorEarningsDetail(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const vendorId = parseInt(req.params.id);
      const { startDate, endDate } = req.query;

      const vendor = await prisma.user.findFirst({
        where: { id: vendorId, role: ROLES.ADMIN },
        select: {
          id: true,
          email: true,
          companyName: true,
          firstName: true,
          lastName: true,
          isActive: true,
        },
      });

      if (!vendor) {
        throw new NotFoundError("Vendor not found");
      }

      const orderWhere: any = {
        status: { not: "cancelled" },
        items: { some: { product: { ownerId: vendorId } } },
      };
      if (startDate || endDate) {
        orderWhere.createdAt = {};
        if (startDate) orderWhere.createdAt.gte = new Date(startDate as string);
        if (endDate) {
          const end = new Date(endDate as string);
          end.setHours(23, 59, 59, 999);
          orderWhere.createdAt.lte = end;
        }
      }

      const orders = await prisma.order.findMany({
        where: orderWhere,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          paymentStatus: true,
          createdAt: true,
          // Only this vendor's line items.
          items: {
            where: { product: { ownerId: vendorId } },
            select: {
              id: true,
              productName: true,
              productSku: true,
              quantity: true,
              price: true,
              subtotal: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      let grossSales = 0;
      let amountOwed = 0;

      const detailedOrders = orders.map((order) => {
        const vendorSubtotal = order.items.reduce(
          (sum, item) => sum + parseFloat(item.subtotal.toString()),
          0,
        );
        const payable =
          order.paymentStatus === "paid" && order.status === "delivered";

        grossSales += vendorSubtotal;
        if (payable) amountOwed += vendorSubtotal;

        return {
          orderId: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          paymentStatus: order.paymentStatus,
          createdAt: order.createdAt,
          payable,
          vendorSubtotal: vendorSubtotal.toFixed(2),
          items: order.items.map((item) => ({
            id: item.id,
            productName: item.productName,
            productSku: item.productSku,
            quantity: item.quantity,
            price: parseFloat(item.price.toString()).toFixed(2),
            subtotal: parseFloat(item.subtotal.toString()).toFixed(2),
          })),
        };
      });

      return ResponseUtil.success(
        res,
        {
          vendor: {
            id: vendor.id,
            email: vendor.email,
            companyName: vendor.companyName,
            name:
              [vendor.firstName, vendor.lastName].filter(Boolean).join(" ") ||
              vendor.companyName ||
              vendor.email,
            isActive: vendor.isActive,
          },
          dateRange: {
            start: startDate
              ? new Date(startDate as string).toISOString()
              : null,
            end: endDate ? new Date(endDate as string).toISOString() : null,
          },
          totals: {
            orderCount: detailedOrders.length,
            grossSales: grossSales.toFixed(2),
            amountOwed: amountOwed.toFixed(2),
            pendingPayout: (grossSales - amountOwed).toFixed(2),
          },
          orders: detailedOrders,
        },
        "Vendor earnings detail retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // ==================== PAYOUTS (superadmin) ====================

  // Generate a payout record for a vendor over a period. Gross is the sum of the
  // vendor's line items on paid + delivered orders in the window; commission uses
  // the current platform rate; net is what the platform owes the vendor.
  static async createPayout(req: Request, res: Response, next: NextFunction) {
    try {
      const vendorId = parseInt(req.params.id);
      const { periodStart, periodEnd } = req.body as {
        periodStart: Date;
        periodEnd: Date;
      };

      const vendor = await prisma.user.findFirst({
        where: { id: vendorId, role: ROLES.ADMIN },
        select: { id: true },
      });
      if (!vendor) throw new NotFoundError("Vendor not found");

      const end = new Date(periodEnd);
      end.setHours(23, 59, 59, 999);

      const items = await prisma.orderItem.findMany({
        where: {
          product: { ownerId: vendorId },
          order: {
            status: "delivered",
            paymentStatus: "paid",
            createdAt: { gte: new Date(periodStart), lte: end },
          },
        },
        select: { subtotal: true },
      });

      const gross = items.reduce(
        (sum, item) => sum + parseFloat(item.subtotal.toString()),
        0,
      );
      const settings = await SettingsService.get();
      const rate = Number(settings.commissionRate);
      const commission = Math.round(gross * rate * 100) / 100;
      const net = Math.round((gross - commission) * 100) / 100;

      const payout = await prisma.payout.create({
        data: {
          vendorId,
          periodStart: new Date(periodStart),
          periodEnd: end,
          gross,
          commission,
          net,
          status: "pending",
        },
      });

      const actorId = ((req as any).jwtPayload as JwtPayload).userId;
      writeAudit({
        actorId,
        action: "payout.create",
        entity: "payout",
        entityId: payout.id,
        meta: { vendorId, gross, commission, net },
      });

      return ResponseUtil.success(res, payout, "Payout generated", 201);
    } catch (error) {
      next(error);
    }
  }

  static async listPayouts(req: Request, res: Response, next: NextFunction) {
    try {
      const vendorId = parseInt(req.params.id);
      const payouts = await prisma.payout.findMany({
        where: { vendorId },
        orderBy: { createdAt: "desc" },
      });
      return ResponseUtil.success(res, payouts, "Payouts retrieved");
    } catch (error) {
      next(error);
    }
  }

  static async markPayoutPaid(req: Request, res: Response, next: NextFunction) {
    try {
      const payoutId = parseInt(req.params.payoutId);
      const { reference } = req.body as { reference?: string };

      const existing = await prisma.payout.findUnique({
        where: { id: payoutId },
      });
      if (!existing) throw new NotFoundError("Payout not found");
      if (existing.status === "paid") {
        throw new ConflictError("Payout is already marked as paid");
      }

      const payout = await prisma.payout.update({
        where: { id: payoutId },
        data: { status: "paid", paidAt: new Date(), reference: reference ?? null },
      });

      const actorId = ((req as any).jwtPayload as JwtPayload).userId;
      writeAudit({
        actorId,
        action: "payout.mark_paid",
        entity: "payout",
        entityId: payout.id,
        meta: { reference: reference ?? null },
      });

      return ResponseUtil.success(res, payout, "Payout marked as paid");
    } catch (error) {
      next(error);
    }
  }

  // ==================== CUSTOMER MANAGEMENT (superadmin) ====================

  static async listCustomers(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Math.max(1, parseInt((req.query.page as string) || "1"));
      const limit = Math.min(
        100,
        Math.max(1, parseInt((req.query.limit as string) || "20")),
      );
      const search = (req.query.search as string)?.trim();
      const status = req.query.status as string; // "active" | "inactive"

      const where: any = { role: ROLES.CUSTOMER };
      if (status === "active") where.isActive = true;
      if (status === "inactive") where.isActive = false;
      if (search) {
        where.OR = [
          { email: { contains: search, mode: "insensitive" } },
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ];
      }

      const [customers, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            isActive: true,
            isEmailVerified: true,
            createdAt: true,
            _count: { select: { orders: true } },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);

      return ResponseUtil.success(
        res,
        {
          customers,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
        "Customers retrieved",
      );
    } catch (error) {
      next(error);
    }
  }

  static async getCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = parseInt(req.params.id);
      const customer = await prisma.user.findFirst({
        where: { id: customerId, role: ROLES.CUSTOMER },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isActive: true,
          isEmailVerified: true,
          createdAt: true,
          addresses: true,
          orders: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              paymentStatus: true,
              total: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          },
          _count: { select: { orders: true, reviews: true } },
        },
      });
      if (!customer) throw new NotFoundError("Customer not found");
      return ResponseUtil.success(res, customer, "Customer retrieved");
    } catch (error) {
      next(error);
    }
  }

  // Suspend/reactivate a customer. Suspending bumps tokenVersion so existing
  // sessions are revoked immediately.
  static async setCustomerStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const customerId = parseInt(req.params.id);
      const { isActive } = req.body as { isActive: boolean };
      if (typeof isActive !== "boolean") {
        throw new BadRequestError("isActive (boolean) is required");
      }

      const customer = await prisma.user.findFirst({
        where: { id: customerId, role: ROLES.CUSTOMER },
        select: { id: true },
      });
      if (!customer) throw new NotFoundError("Customer not found");

      const updated = await prisma.user.update({
        where: { id: customerId },
        data: isActive
          ? { isActive: true }
          : { isActive: false, tokenVersion: { increment: 1 } },
        select: { id: true, email: true, isActive: true },
      });

      const actorId = ((req as any).jwtPayload as JwtPayload).userId;
      writeAudit({
        actorId,
        action: isActive ? "customer.activate" : "customer.suspend",
        entity: "user",
        entityId: customerId,
      });

      return ResponseUtil.success(
        res,
        updated,
        `Customer ${isActive ? "activated" : "suspended"}`,
      );
    } catch (error) {
      next(error);
    }
  }

  // Export a customer's data (GDPR-style). Returns profile, addresses, orders,
  // and reviews as a single JSON payload.
  static async exportCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = parseInt(req.params.id);
      const customer = await prisma.user.findFirst({
        where: { id: customerId, role: ROLES.CUSTOMER },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          isActive: true,
          isEmailVerified: true,
          createdAt: true,
          addresses: true,
          orders: {
            include: { items: true },
            orderBy: { createdAt: "desc" },
          },
          reviews: true,
        },
      });
      if (!customer) throw new NotFoundError("Customer not found");

      const actorId = ((req as any).jwtPayload as JwtPayload).userId;
      writeAudit({
        actorId,
        action: "customer.export",
        entity: "user",
        entityId: customerId,
      });

      return ResponseUtil.success(res, customer, "Customer data exported");
    } catch (error) {
      next(error);
    }
  }

  // Delete a customer account. Their orders are preserved but anonymized (the
  // userId FK is set null); addresses, cart, wishlist and reviews cascade away.
  static async deleteCustomer(req: Request, res: Response, next: NextFunction) {
    try {
      const customerId = parseInt(req.params.id);
      const customer = await prisma.user.findFirst({
        where: { id: customerId, role: ROLES.CUSTOMER },
        select: { id: true, email: true },
      });
      if (!customer) throw new NotFoundError("Customer not found");

      await prisma.user.delete({ where: { id: customerId } });

      const actorId = ((req as any).jwtPayload as JwtPayload).userId;
      writeAudit({
        actorId,
        action: "customer.delete",
        entity: "user",
        entityId: customerId,
        meta: { email: customer.email },
      });

      return ResponseUtil.success(res, null, "Customer deleted");
    } catch (error) {
      next(error);
    }
  }
}
