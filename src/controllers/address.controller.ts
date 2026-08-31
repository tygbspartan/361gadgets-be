import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { NotFoundError } from "../utils/customError.util";
import { JwtPayload } from "../types/auth.types";

// Saved addresses for the logged-in customer. Orders still snapshot the address
// at checkout, so these are purely a convenience book.
export class AddressController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = ((req as any).jwtPayload as JwtPayload).userId;
      const addresses = await prisma.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      });
      return ResponseUtil.success(res, addresses, "Addresses retrieved");
    } catch (error) {
      next(error);
    }
  }

  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = ((req as any).jwtPayload as JwtPayload).userId;
      const body = req.body; // validated + stripped by addressSchema

      const address = await prisma.$transaction(async (tx) => {
        const count = await tx.address.count({ where: { userId } });
        const makeDefault = body.isDefault ?? count === 0;
        if (makeDefault) {
          await tx.address.updateMany({
            where: { userId },
            data: { isDefault: false },
          });
        }
        return tx.address.create({
          data: { ...body, userId, isDefault: makeDefault },
        });
      });

      return ResponseUtil.success(res, address, "Address added", 201);
    } catch (error) {
      next(error);
    }
  }

  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = ((req as any).jwtPayload as JwtPayload).userId;
      const id = parseInt(req.params.id);
      const existing = await prisma.address.findFirst({ where: { id, userId } });
      if (!existing) throw new NotFoundError("Address not found");

      const body = req.body;
      const address = await prisma.$transaction(async (tx) => {
        if (body.isDefault) {
          await tx.address.updateMany({
            where: { userId, id: { not: id } },
            data: { isDefault: false },
          });
        }
        return tx.address.update({ where: { id }, data: body });
      });

      return ResponseUtil.success(res, address, "Address updated");
    } catch (error) {
      next(error);
    }
  }

  static async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = ((req as any).jwtPayload as JwtPayload).userId;
      const id = parseInt(req.params.id);
      const existing = await prisma.address.findFirst({ where: { id, userId } });
      if (!existing) throw new NotFoundError("Address not found");
      await prisma.address.delete({ where: { id } });
      return ResponseUtil.success(res, null, "Address deleted");
    } catch (error) {
      next(error);
    }
  }
}
