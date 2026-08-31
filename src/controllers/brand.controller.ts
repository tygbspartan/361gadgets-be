import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { SlugUtil } from "../utils/slug.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/customError.util";
import { CreateBrandRequest, UpdateBrandRequest } from "../types/product.types";
import { StorageService } from "../services/storage.service";
import { CacheService, TTL } from "../services/cache.service";
import { ROLES } from "../constants/roles.constants";
import { reassignBrandOwner } from "../utils/brandOwnership.util";
import { JwtPayload } from "../types/auth.types";

export class BrandController {
  // Validate that an assigned brand owner is an actual vendor (admin) account.
  private static async assertValidBrandOwner(
    ownerId: number | null | undefined,
  ): Promise<void> {
    if (ownerId === undefined || ownerId === null) return;
    const vendor = await prisma.user.findFirst({
      where: { id: ownerId, role: ROLES.ADMIN },
      select: { id: true },
    });
    if (!vendor) {
      throw new BadRequestError(
        "ownerId must reference an existing vendor account",
      );
    }
  }

  // Create brand (Admin only)
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name,
        slug,
        description,
        logoUrl,
        metaTitle,
        metaDescription,
        isFeatured,
        ownerId,
      }: CreateBrandRequest = req.body;

      // Validation
      if (!name) {
        throw new BadRequestError("Brand name is required");
      }

      await BrandController.assertValidBrandOwner(ownerId);

      // Generate slug if not provided
      let brandSlug = slug || SlugUtil.generateSlug(name);

      // Check if slug already exists
      const existingSlug = await prisma.brand.findUnique({
        where: { slug: brandSlug },
      });

      if (existingSlug) {
        throw new ConflictError(
          `Brand with slug "${brandSlug}" already exists`
        );
      }

      // Create brand
      const brand = await prisma.brand.create({
        data: {
          name,
          slug: brandSlug,
          description,
          logoUrl,
          metaTitle,
          metaDescription,
          isFeatured,
          ownerId: ownerId ?? null,
        },
      });

      await CacheService.invalidatePattern("brands:*");
      return ResponseUtil.success(res, brand, "Brand created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  // Bulk create brands (superadmin). All-or-nothing: if any item is invalid,
  // nothing is created and per-item errors are returned.
  static async bulkCreate(req: Request, res: Response, next: NextFunction) {
    try {
      const items: CreateBrandRequest[] = req.body.brands ?? req.body.items;

      if (!Array.isArray(items) || items.length === 0) {
        throw new BadRequestError("Provide a non-empty 'brands' array");
      }
      if (items.length > 100) {
        throw new BadRequestError("Cannot create more than 100 brands at once");
      }

      // Which of the desired slugs already exist in the DB?
      const desiredSlugs = items
        .map((b) => b?.slug || (b?.name ? SlugUtil.generateSlug(b.name) : ""))
        .filter(Boolean);
      const existing = await prisma.brand.findMany({
        where: { slug: { in: desiredSlugs } },
        select: { slug: true },
      });
      const existingSlugs = new Set(existing.map((b) => b.slug));

      const errors: { index: number; error: string }[] = [];
      const prepared: any[] = [];
      const seenSlugs = new Set<string>();

      items.forEach((b, i) => {
        if (!b?.name || !String(b.name).trim()) {
          errors.push({ index: i, error: "name is required" });
          return;
        }
        const slug = b.slug || SlugUtil.generateSlug(b.name);
        if (existingSlugs.has(slug)) {
          errors.push({ index: i, error: `slug "${slug}" already exists` });
          return;
        }
        if (seenSlugs.has(slug)) {
          errors.push({
            index: i,
            error: `duplicate slug "${slug}" within the batch`,
          });
          return;
        }
        seenSlugs.add(slug);
        prepared.push({
          name: b.name.trim(),
          slug,
          description: b.description,
          logoUrl: b.logoUrl,
          metaTitle: b.metaTitle,
          metaDescription: b.metaDescription,
          isFeatured: b.isFeatured ?? false,
        });
      });

      if (errors.length > 0) {
        return ResponseUtil.badRequest(
          res,
          `Bulk create failed for ${errors.length} of ${items.length} item(s). No brands were created.`,
          errors,
        );
      }

      const created = await prisma.$transaction(
        prepared.map((data) => prisma.brand.create({ data })),
      );

      await CacheService.invalidatePattern("brands:*");
      return ResponseUtil.success(
        res,
        { count: created.length, brands: created },
        `${created.length} brand(s) created successfully`,
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // Get all brands (Public)
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { isActive, isFeatured } = req.query;

      const cacheKey = `brands:all:${JSON.stringify(req.query)}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) return ResponseUtil.success(res, cached, "Brands retrieved successfully");

      // Build filter
      const where: any = {};

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      if (isFeatured !== undefined) {
        where.isFeatured = isFeatured === "true";
      }

      const brands = await prisma.brand.findMany({
        where,
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      // Transform response to include product count
      const response = brands.map((brand) => ({
        ...brand,
        productCount: brand._count.products,
        _count: undefined, // Remove internal count object
      }));

      CacheService.setBackground(cacheKey, response, TTL.BRAND);
      return ResponseUtil.success(res, response, "Brands retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get featured brands (Public)
  static async getFeatured(req: Request, res: Response, next: NextFunction) {
    try {
      const cached = await CacheService.get("brands:featured");
      if (cached) return ResponseUtil.success(res, cached, "Featured brands retrieved successfully");

      const brands = await prisma.brand.findMany({
        where: {
          isFeatured: true,
          isActive: true,
        },
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
        orderBy: { name: "asc" },
      });

      const response = brands.map((brand) => ({
        ...brand,
        productCount: brand._count.products,
        _count: undefined,
      }));

      CacheService.setBackground("brands:featured", response, TTL.BRAND);
      return ResponseUtil.success(res, response, "Featured brands retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get single brand by slug (Public)
  static async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;

      const cacheKey = `brands:slug:${slug}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) return ResponseUtil.success(res, cached, "Brand retrieved successfully");

      const brand = await prisma.brand.findUnique({
        where: { slug },
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
      });

      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      const response = { ...brand, productCount: brand._count.products };
      CacheService.setBackground(cacheKey, response, TTL.BRAND);
      return ResponseUtil.success(res, response, "Brand retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Scoped admin brand list. A vendor sees only their own brands; the superadmin
  // sees all and may filter by ?ownerId=<id> or ?ownerId=null (unassigned only).
  // Each brand includes its owner (id + company/name) and product count.
  static async getAdminList(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const isSuper = jwtPayload.role === ROLES.SUPERADMIN;

      const where: any = {};
      if (isSuper) {
        const { ownerId } = req.query;
        if (ownerId === "null") {
          where.ownerId = null;
        } else if (ownerId !== undefined && ownerId !== "") {
          where.ownerId = parseInt(ownerId as string);
        }
      } else {
        where.ownerId = jwtPayload.userId;
      }

      const brands = await prisma.brand.findMany({
        where,
        include: {
          owner: {
            select: {
              id: true,
              companyName: true,
              firstName: true,
              lastName: true,
            },
          },
          _count: { select: { products: true } },
        },
        orderBy: { name: "asc" },
      });

      const data = brands.map((brand) => ({
        ...brand,
        productCount: brand._count.products,
        _count: undefined,
      }));

      return ResponseUtil.success(res, data, "Brands retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get single brand by ID (Admin)
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const brand = await prisma.brand.findUnique({
        where: { id: parseInt(id) },
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
      });

      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      return ResponseUtil.success(res, brand, "Brand retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Update brand (Admin only)
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updateData: UpdateBrandRequest = req.body;

      // Check if brand exists
      const existingBrand = await prisma.brand.findUnique({
        where: { id: parseInt(id) },
      });

      if (!existingBrand) {
        throw new NotFoundError("Brand not found");
      }

      await BrandController.assertValidBrandOwner(updateData.ownerId);

      // If updating slug, check for conflicts
      if (updateData.slug && updateData.slug !== existingBrand.slug) {
        const slugExists = await prisma.brand.findUnique({
          where: { slug: updateData.slug },
        });

        if (slugExists) {
          throw new ConflictError("Slug already exists");
        }
      }

      // If a new logoUrl is being set via URL, delete the old file from storage
      if (
        updateData.logoUrl !== undefined &&
        updateData.logoUrl !== existingBrand.logoUrl &&
        existingBrand.logoUrl
      ) {
        await StorageService.deleteImage(existingBrand.logoUrl);
      }

      const brandId = parseInt(id);
      const ownerChanging =
        updateData.ownerId !== undefined &&
        (updateData.ownerId ?? null) !== existingBrand.ownerId;

      // Whitelist updatable fields explicitly (no raw body spread → no
      // mass-assignment). `undefined` values are ignored by Prisma. An ownerId
      // change is applied via reassignBrandOwner so the previous vendor's
      // products under the brand are deactivated (non-destructive transfer).
      const brand = await prisma.$transaction(async (tx) => {
        if (ownerChanging) {
          await reassignBrandOwner(tx, brandId, updateData.ownerId ?? null);
        }
        return tx.brand.update({
          where: { id: brandId },
          data: {
            name: updateData.name,
            slug: updateData.slug,
            description: updateData.description,
            logoUrl: updateData.logoUrl,
            isActive: updateData.isActive,
            isFeatured: updateData.isFeatured,
            metaTitle: updateData.metaTitle,
            metaDescription: updateData.metaDescription,
            // ownerId handled above via reassignBrandOwner (do not set here).
          },
        });
      });

      await CacheService.invalidatePattern("brands:*");
      return ResponseUtil.success(res, brand, "Brand updated successfully");
    } catch (error) {
      next(error);
    }
  }

  // Delete brand (Admin only)
  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Check if brand exists
      const brand = await prisma.brand.findUnique({
        where: { id: parseInt(id) },
        include: {
          _count: {
            select: {
              products: true,
            },
          },
        },
      });

      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      // Check if brand has products
      if (brand._count.products > 0) {
        throw new BadRequestError(
          `Cannot delete brand with ${brand._count.products} products. Remove products first.`
        );
      }

      // Delete logo from storage if it exists
      if (brand.logoUrl) {
        await StorageService.deleteImage(brand.logoUrl);
      }

      await prisma.brand.delete({ where: { id: parseInt(id) } });

      await CacheService.invalidatePattern("brands:*");
      return ResponseUtil.success(res, null, "Brand deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  // Upload logo file to Supabase Storage (Admin only)
  static async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const brandId = parseInt(id);
      const file = req.file;

      if (!file) {
        throw new BadRequestError("Logo file is required");
      }

      const brand = await prisma.brand.findUnique({ where: { id: brandId } });

      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      // Delete old logo from storage before uploading new one
      if (brand.logoUrl) {
        await StorageService.deleteImage(brand.logoUrl);
      }

      const logoUrl = await StorageService.uploadImage(file, "brands");

      const updated = await prisma.brand.update({
        where: { id: brandId },
        data: { logoUrl },
      });

      return ResponseUtil.success(res, updated, "Logo uploaded successfully");
    } catch (error) {
      next(error);
    }
  }

  // Delete brand logo from storage and clear the field (Admin only)
  static async deleteLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const brandId = parseInt(id);

      const brand = await prisma.brand.findUnique({ where: { id: brandId } });

      if (!brand) {
        throw new NotFoundError("Brand not found");
      }

      if (!brand.logoUrl) {
        throw new BadRequestError("Brand has no logo to delete");
      }

      await StorageService.deleteImage(brand.logoUrl);

      const updated = await prisma.brand.update({
        where: { id: brandId },
        data: { logoUrl: null },
      });

      return ResponseUtil.success(res, updated, "Logo deleted successfully");
    } catch (error) {
      next(error);
    }
  }
}
