import { Request, Response } from "express";
import prisma from "../config/database.config";
import { ROLES } from "../constants/roles.constants";
import { JwtPayload } from "../types/auth.types";

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const jwtPayload = (req as any).jwtPayload as JwtPayload | undefined;
    const isSuper = jwtPayload?.role === ROLES.SUPERADMIN;
    const ownerId = jwtPayload?.userId;

    const { startDate, endDate } = req.query;

    // Parse dates or use defaults (last 30 days)
    const start = startDate
      ? new Date(startDate as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate as string) : new Date();

    // Set end date to end of day
    end.setHours(23, 59, 59, 999);

    // 1. Total counts (not date-filtered). Products/discounts are owner-scoped
    //    for vendors; brands are a shared/global catalog so they stay platform-wide.
    const productWhere: any = { isActive: true };
    const discountWhere: any = { isActive: true };
    if (!isSuper) {
      productWhere.ownerId = ownerId;
      discountWhere.ownerId = ownerId;
    }

    const [totalProducts, totalDiscounts, totalBrands] = await Promise.all([
      prisma.product.count({ where: productWhere }),
      prisma.discount.count({ where: discountWhere }),
      prisma.brand.count({ where: { isActive: true } }),
    ]);

    // 2. Orders by status + revenue within the date range
    const ordersByStatus = {
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    let totalRevenue = 0;
    let totalOrders = 0;

    if (isSuper) {
      // Platform-wide: every order, revenue = full order totals (excl. cancelled).
      const ordersInRange = await prisma.order.findMany({
        where: { createdAt: { gte: start, lte: end } },
        select: { status: true, total: true },
      });

      ordersInRange.forEach((order) => {
        if (ordersByStatus.hasOwnProperty(order.status)) {
          ordersByStatus[order.status as keyof typeof ordersByStatus]++;
        }
        if (order.status !== "cancelled") {
          totalRevenue += parseFloat(order.total.toString());
        }
      });

      totalOrders = ordersInRange.length;
    } else {
      // Vendor-scoped: only orders that contain THIS vendor's products.
      // Revenue = the vendor's share (sum of their order-item subtotals, which
      // excludes shipping and other vendors' items), excluding cancelled orders.
      const items = await prisma.orderItem.findMany({
        where: {
          product: { ownerId },
          order: { createdAt: { gte: start, lte: end } },
        },
        select: {
          subtotal: true,
          order: { select: { id: true, status: true } },
        },
      });

      // Count each order once (an order may include several of the vendor's items).
      const orderStatusById = new Map<number, string>();
      items.forEach((item) => {
        if (!orderStatusById.has(item.order.id)) {
          orderStatusById.set(item.order.id, item.order.status);
        }
        if (item.order.status !== "cancelled") {
          totalRevenue += parseFloat(item.subtotal.toString());
        }
      });

      orderStatusById.forEach((status) => {
        if (ordersByStatus.hasOwnProperty(status)) {
          ordersByStatus[status as keyof typeof ordersByStatus]++;
        }
      });

      totalOrders = orderStatusById.size;
    }

    res.status(200).json({
      status: "success",
      message: "Dashboard stats retrieved successfully",
      data: {
        // Indicates how the numbers are scoped (handy for the UI label).
        scope: isSuper ? "platform" : "vendor",

        // Top section stats
        totalProducts,
        totalDiscounts,
        totalBrands,

        // Date range stats
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
        },
        totalOrders,
        totalRevenue: totalRevenue.toFixed(2),

        // Orders by status
        ordersByStatus,
      },
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({
      status: "error",
      message: "Failed to fetch dashboard stats",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
