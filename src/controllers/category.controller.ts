import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { SlugUtil } from "../utils/slug.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
} from "../utils/customError.util";
import {
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from "../types/product.types";
import { CacheService, TTL } from "../services/cache.service";

export class CategoryController {
  // Create category (Admin only)
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        name,
        slug,
        description,
        parentId,
        level,
        displayOrder,
      }: CreateCategoryRequest = req.body;

      // Validation
      if (!name) {
        throw new BadRequestError("Category name is required");
      }

      if (!level || (level !== 1 && level !== 2 && level !== 3)) {
        throw new BadRequestError("Level must be 1, 2, or 3");
      }

      // If level 2 or 3, parentId is required
      if (level > 1 && !parentId) {
        throw new BadRequestError(
          `Parent category is required for level ${level}`
        );
      }

      // Validate parent exists if provided
      if (parentId) {
        const parent = await prisma.category.findUnique({
          where: { id: parentId },
        });

        if (!parent) {
          throw new NotFoundError("Parent category not found");
        }

        // Validate parent level is correct
        if (parent.level !== level - 1) {
          throw new BadRequestError(
            `Parent must be level ${level - 1} for level ${level} category`
          );
        }
      }

      // Generate slug if not provided
      let categorySlug = slug || SlugUtil.generateSlug(name);

      // Check if slug already exists
      const existingSlug = await prisma.category.findUnique({
        where: { slug: categorySlug },
      });

      if (existingSlug) {
        throw new ConflictError(
          `Category with slug "${categorySlug}" already exists`
        );
      }

      // Create category
      const category = await prisma.category.create({
        data: {
          name,
          slug: categorySlug,
          description,
          parentId,
          level,
          displayOrder: displayOrder || 0,
        },
        include: {
          parent: true,
        },
      });

      await CacheService.invalidatePattern("categories:*");
      return ResponseUtil.success(res, category, "Category created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  // Bulk create categories (superadmin). All-or-nothing: if any item is invalid,
  // nothing is created and per-item errors are returned. Parent categories must
  // already exist in the DB (they can't be referenced from within the same batch).
  static async bulkCreate(req: Request, res: Response, next: NextFunction) {
    try {
      const items: CreateCategoryRequest[] =
        req.body.categories ?? req.body.items;

      if (!Array.isArray(items) || items.length === 0) {
        throw new BadRequestError("Provide a non-empty 'categories' array");
      }
      if (items.length > 100) {
        throw new BadRequestError(
          "Cannot create more than 100 categories at once",
        );
      }

      // Pre-fetch referenced parents and existing slugs.
      const parentIds = [
        ...new Set(
          items.map((c) => c?.parentId).filter((v): v is number => !!v),
        ),
      ];
      const desiredSlugs = items
        .map((c) => c?.slug || (c?.name ? SlugUtil.generateSlug(c.name) : ""))
        .filter(Boolean);

      const [parents, existing] = await Promise.all([
        parentIds.length
          ? prisma.category.findMany({ where: { id: { in: parentIds } } })
          : Promise.resolve([]),
        prisma.category.findMany({
          where: { slug: { in: desiredSlugs } },
          select: { slug: true },
        }),
      ]);
      const parentMap = new Map(parents.map((p) => [p.id, p]));
      const existingSlugs = new Set(existing.map((c) => c.slug));

      const errors: { index: number; error: string }[] = [];
      const prepared: any[] = [];
      const seenSlugs = new Set<string>();

      items.forEach((c, i) => {
        if (!c?.name || !String(c.name).trim()) {
          errors.push({ index: i, error: "name is required" });
          return;
        }
        if (!c.level || ![1, 2, 3].includes(c.level)) {
          errors.push({ index: i, error: "level must be 1, 2, or 3" });
          return;
        }
        if (c.level > 1 && !c.parentId) {
          errors.push({
            index: i,
            error: `parentId is required for level ${c.level}`,
          });
          return;
        }
        if (c.parentId) {
          const parent = parentMap.get(c.parentId);
          if (!parent) {
            errors.push({
              index: i,
              error: `parent category ${c.parentId} not found`,
            });
            return;
          }
          if (parent.level !== c.level - 1) {
            errors.push({
              index: i,
              error: `parent must be level ${c.level - 1} for a level ${c.level} category`,
            });
            return;
          }
        }
        const slug = c.slug || SlugUtil.generateSlug(c.name);
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
          name: c.name.trim(),
          slug,
          description: c.description,
          parentId: c.parentId,
          level: c.level,
          displayOrder: c.displayOrder || 0,
        });
      });

      if (errors.length > 0) {
        return ResponseUtil.badRequest(
          res,
          `Bulk create failed for ${errors.length} of ${items.length} item(s). No categories were created.`,
          errors,
        );
      }

      const created = await prisma.$transaction(
        prepared.map((data) =>
          prisma.category.create({ data, include: { parent: true } }),
        ),
      );

      await CacheService.invalidatePattern("categories:*");
      return ResponseUtil.success(
        res,
        { count: created.length, categories: created },
        `${created.length} category(ies) created successfully`,
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // Get all categories (Public)
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { level, parentId, isActive } = req.query;

      const cacheKey = `categories:all:${JSON.stringify(req.query)}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) return ResponseUtil.success(res, cached, "Categories retrieved successfully");

      // Build filter
      const where: any = {};

      if (level) {
        where.level = parseInt(level as string);
      }

      if (parentId) {
        where.parentId = parseInt(parentId as string);
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      const categories = await prisma.category.findMany({
        where,
        include: {
          parent: true,
          _count: {
            select: {
              products: true,
              children: true,
            },
          },
        },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      });

      // Transform response to include counts
      const response = categories.map((category) => ({
        ...category,
        productCount: category._count.products,
        childrenCount: category._count.children,
        _count: undefined, // Remove internal count object
      }));

      CacheService.setBackground(cacheKey, response, TTL.CATEGORY);
      return ResponseUtil.success(res, response, "Categories retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get category tree (hierarchical structure) (Public)
  static async getTree(req: Request, res: Response, next: NextFunction) {
    try {
      const cached = await CacheService.get("categories:tree");
      if (cached) return ResponseUtil.success(res, cached, "Category tree retrieved successfully");

      // Get all Level 1 categories with their children
      const categories = await prisma.category.findMany({
        where: {
          level: 1,
          isActive: true,
        },
        include: {
          children: {
            where: { isActive: true },
            include: {
              children: {
                where: { isActive: true },
                include: {
                  _count: {
                    select: { products: true },
                  },
                },
              },
              _count: {
                select: { products: true },
              },
            },
            orderBy: { displayOrder: "asc" },
          },
          _count: {
            select: { products: true },
          },
        },
        orderBy: { displayOrder: "asc" },
      });

      CacheService.setBackground("categories:tree", categories, TTL.CATEGORY);
      return ResponseUtil.success(res, categories, "Category tree retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get single category by slug (Public)
  static async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;

      const cacheKey = `categories:slug:${slug}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) return ResponseUtil.success(res, cached, "Category retrieved successfully");

      const category = await prisma.category.findUnique({
        where: { slug },
        include: {
          parent: true,
          children: {
            where: { isActive: true },
            orderBy: { displayOrder: "asc" },
          },
          _count: {
            select: { products: true },
          },
        },
      });

      if (!category) {
        throw new NotFoundError("Category not found");
      }

      const response = { ...category, productCount: category._count.products };
      CacheService.setBackground(cacheKey, response, TTL.CATEGORY);
      return ResponseUtil.success(res, response, "Category retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get single category by ID (Admin)
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const category = await prisma.category.findUnique({
        where: { id: parseInt(id) },
        include: {
          parent: true,
          children: true,
          _count: {
            select: { products: true },
          },
        },
      });

      if (!category) {
        throw new NotFoundError("Category not found");
      }

      return ResponseUtil.success(
        res,
        category,
        "Category retrieved successfully"
      );
    } catch (error) {
      next(error);
    }
  }

  // Update category (Admin only)
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updateData: UpdateCategoryRequest = req.body;

      // Check if category exists
      const existingCategory = await prisma.category.findUnique({
        where: { id: parseInt(id) },
      });

      if (!existingCategory) {
        throw new NotFoundError("Category not found");
      }

      // If updating slug, check for conflicts
      if (updateData.slug && updateData.slug !== existingCategory.slug) {
        const slugExists = await prisma.category.findUnique({
          where: { slug: updateData.slug },
        });

        if (slugExists) {
          throw new ConflictError("Slug already exists");
        }
      }

      // If updating parentId, validate it
      if (updateData.parentId !== undefined) {
        if (updateData.parentId === parseInt(id)) {
          throw new BadRequestError("Category cannot be its own parent");
        }

        if (updateData.parentId !== null) {
          const parent = await prisma.category.findUnique({
            where: { id: updateData.parentId },
          });

          if (!parent) {
            throw new NotFoundError("Parent category not found");
          }
        }
      }

      // Update category
      const category = await prisma.category.update({
        where: { id: parseInt(id) },
        data: updateData,
        include: {
          parent: true,
          children: true,
        },
      });

      await CacheService.invalidatePattern("categories:*");
      return ResponseUtil.success(res, category, "Category updated successfully");
    } catch (error) {
      next(error);
    }
  }

  // Delete category (Admin only)
  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Check if category exists
      const category = await prisma.category.findUnique({
        where: { id: parseInt(id) },
        include: {
          children: true,
          _count: {
            select: { products: true },
          },
        },
      });

      if (!category) {
        throw new NotFoundError("Category not found");
      }

      // Check if category has products
      if (category._count.products > 0) {
        throw new BadRequestError(
          `Cannot delete category with ${category._count.products} products. Remove products first.`
        );
      }

      // Check if category has children
      if (category.children.length > 0) {
        throw new BadRequestError(
          `Cannot delete category with ${category.children.length} subcategories. Remove subcategories first.`
        );
      }

      // Delete category
      await prisma.category.delete({
        where: { id: parseInt(id) },
      });

      await CacheService.invalidatePattern("categories:*");
      return ResponseUtil.success(res, null, "Category deleted successfully");
    } catch (error) {
      next(error);
    }
  }
}
