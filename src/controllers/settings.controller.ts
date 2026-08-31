import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { SettingsService } from "../services/settings.service";
import { writeAudit } from "../utils/audit.util";
import { JwtPayload } from "../types/auth.types";

export class SettingsController {
  // Get platform settings (superadmin).
  static async get(_req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await SettingsService.get();
      return ResponseUtil.success(res, settings, "Settings retrieved");
    } catch (error) {
      next(error);
    }
  }

  // Public subset — only the fields the storefront needs to mirror the backend's
  // shipping math at checkout. Never exposes commission rate, feature flags, etc.
  static async getPublic(_req: Request, res: Response, next: NextFunction) {
    try {
      const s = await SettingsService.get();
      return ResponseUtil.success(
        res,
        {
          currency: s.currency,
          shippingInsideValley: Number(s.shippingInsideValley),
          shippingOutsideValley: Number(s.shippingOutsideValley),
          freeShippingThreshold: Number(s.freeShippingThreshold),
        },
        "Public settings retrieved",
      );
    } catch (error) {
      next(error);
    }
  }

  // Update platform settings (superadmin). Only provided fields change.
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        commissionRate,
        currency,
        supportEmail,
        shippingInsideValley,
        shippingOutsideValley,
        freeShippingThreshold,
        featureFlags,
      } = req.body;

      await SettingsService.get(); // ensure the singleton row exists

      const data: any = {};
      if (commissionRate !== undefined) data.commissionRate = commissionRate;
      if (currency !== undefined) data.currency = currency;
      if (supportEmail !== undefined) data.supportEmail = supportEmail || null;
      if (shippingInsideValley !== undefined)
        data.shippingInsideValley = shippingInsideValley;
      if (shippingOutsideValley !== undefined)
        data.shippingOutsideValley = shippingOutsideValley;
      if (freeShippingThreshold !== undefined)
        data.freeShippingThreshold = freeShippingThreshold;
      if (featureFlags !== undefined)
        data.featureFlags = featureFlags ? JSON.stringify(featureFlags) : null;

      const updated = await prisma.platformSettings.update({
        where: { id: 1 },
        data,
      });

      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      await writeAudit({
        actorId: jwtPayload.userId,
        action: "settings.update",
        entity: "platform_settings",
        entityId: 1,
        meta: data,
      });

      return ResponseUtil.success(res, updated, "Settings updated");
    } catch (error) {
      next(error);
    }
  }
}
