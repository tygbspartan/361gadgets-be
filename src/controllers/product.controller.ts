import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { SlugUtil } from "../utils/slug.util";
import { JsonUtil } from "../utils/json.util";
import {
  BadRequestError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../utils/customError.util";
import {
  CreateProductRequest,
  ProductImageRequest,
  ProductSpecificationRequest,
  UpdateProductRequest,
} from "../types/product.types";
import { StorageService } from "../services/storage.service";
import { CacheService, TTL } from "../services/cache.service";
import { JwtPayload } from "../types/auth.types";
import { assertOwnership } from "../utils/ownership.util";
import { ROLES } from "../constants/roles.constants";

// Helper function to parse JSON fields
const parseProductArrays = (product: any) => {
  return { ...product };
};

// ── Color variant helpers ─────────────────────────────────────────────────
import type { ProductColorRequest } from "../types/product.types";

// Validate an optional list of color variants.
function validateColors(colors?: ProductColorRequest[]): void {
  if (!colors) return;
  for (const c of colors) {
    if (!c.name || !c.name.trim()) {
      throw new BadRequestError("Each color variant must have a name");
    }
    if (
      c.stockQuantity === undefined ||
      c.stockQuantity === null ||
      Number(c.stockQuantity) < 0 ||
      !Number.isFinite(Number(c.stockQuantity))
    ) {
      throw new BadRequestError(
        `Color "${c.name}" must have a valid stock quantity`,
      );
    }
  }
}

// A product's aggregate stock: sum of per-color stock when colors exist,
// otherwise the vendor-entered base stock. Keeping Product.stockQuantity in
// sync with this lets all existing aggregate stock logic keep working.
function resolveStock(
  baseStock: number | undefined,
  colors?: ProductColorRequest[],
): number {
  if (colors && colors.length > 0) {
    return colors.reduce((sum, c) => sum + (Number(c.stockQuantity) || 0), 0);
  }
  return Number(baseStock) || 0;
}

// Create color rows for a product inside a transaction.
async function createProductColors(
  tx: any,
  productId: number,
  colors?: ProductColorRequest[],
): Promise<void> {
  if (!colors || colors.length === 0) return;
  await tx.productColor.createMany({
    data: colors.map((c, i) => ({
      productId,
      name: c.name.trim(),
      hexCode: c.hexCode?.trim() || null,
      sku: c.sku?.trim() || null,
      imageUrl: c.imageUrl?.trim() || null,
      stockQuantity: Number(c.stockQuantity) || 0,
      displayOrder: c.displayOrder ?? i,
    })),
  });
}

export class ProductController {
  // Load a product's owner and enforce that the current user may manage it.
  // Superadmin bypasses; a vendor may only touch products they own.
  private static async assertCanManageProduct(
    productId: number,
    req: Request,
  ): Promise<void> {
    const jwtPayload = (req as any).jwtPayload as JwtPayload;
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, ownerId: true },
    });
    if (!product) {
      throw new NotFoundError("Product not found");
    }
    assertOwnership(product.ownerId, jwtPayload);
  }

  // Strict brand-ownership check for product create/update.
  //   - superadmin: may use any brand
  //   - vendor: the brand MUST be assigned to them (brand.ownerId === their id).
  //     Unassigned brands and other vendors' brands are rejected — no auto-claim.
  private static async assertBrandAssignable(
    brandId: number | null | undefined,
    jwtPayload: JwtPayload,
    client: any = prisma,
  ): Promise<void> {
    if (jwtPayload.role === ROLES.SUPERADMIN) return; // any brand allowed
    if (!brandId) {
      throw new BadRequestError("A brand assigned to you is required.");
    }
    const brand = await client.brand.findUnique({
      where: { id: brandId },
      select: { ownerId: true, name: true },
    });
    if (!brand) {
      throw new BadRequestError("Brand not found");
    }
    if (brand.ownerId !== jwtPayload.userId) {
      throw new ForbiddenError(
        "You can only add products under brands assigned to you.",
      );
    }
  }

  // Create product (Admin/Vendor)
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const {
        name,
        longDescription,
        price,
        originalPrice,
        costPrice,
        stockQuantity,
        lowStockThreshold,
        sku,
        brandId,
        categoryId,
        countryOfOrigin,
        isActive,
        isFeatured,
        homepageFeature,
        colors,
        images,
        specifications,
        metaTitle,
        metaDescription,
      }: CreateProductRequest = req.body;

      const hasColors = Array.isArray(colors) && colors.length > 0;

      // Validation. Stock may be omitted when color variants carry it instead.
      if (
        !name ||
        !price ||
        (stockQuantity === undefined && !hasColors) ||
        !longDescription ||
        !sku ||
        !brandId ||
        !categoryId
      ) {
        throw new BadRequestError(
          "Name, price, stock quantity (or colors), description, SKU, brand, and category are required",
        );
      }

      if (costPrice === undefined || costPrice === null) {
        throw new BadRequestError("Cost price is required");
      }

      if (price <= 0) {
        throw new BadRequestError("Price must be greater than 0");
      }

      if (stockQuantity !== undefined && stockQuantity < 0) {
        throw new BadRequestError("Stock quantity cannot be negative");
      }

      validateColors(colors);

      // Only the superadmin may feature products (store-front curation).
      const isSuperAdmin = jwtPayload.role === ROLES.SUPERADMIN;
      const featuredFlag = isSuperAdmin ? isFeatured ?? false : false;
      const homepageFlag = isSuperAdmin ? homepageFeature ?? false : false;

      // Product-level stock is the aggregate of color stock when colors exist.
      const resolvedStock = resolveStock(stockQuantity, colors);

      // Vendors may only build products under brands assigned to them.
      await ProductController.assertBrandAssignable(brandId, jwtPayload);

      // Check if SKU already exists (if provided)
      if (sku) {
        const existingSku = await prisma.product.findUnique({
          where: { sku },
        });

        if (existingSku) {
          throw new ConflictError(`Product with SKU "${sku}" already exists`);
        }
      }

      // Generate slug from name
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");

      // Check if slug already exists
      const existingSlug = await prisma.product.findUnique({
        where: { slug },
      });

      if (existingSlug) {
        // Append random number to make it unique
        const uniqueSlug = `${slug}-${Date.now()}`;

        // Create product with images and specifications in a transaction
        const product = await prisma.$transaction(async (tx) => {
          // 1. Create product
          const newProduct = await tx.product.create({
            data: {
              name,
              slug: uniqueSlug,
              longDescription,
              price,
              originalPrice,
              costPrice,
              stockQuantity: resolvedStock,
              lowStockThreshold: lowStockThreshold || 10,
              sku,
              owner: { connect: { id: jwtPayload.userId } },
              brand: brandId ? { connect: { id: brandId } } : undefined,
              category: categoryId ? { connect: { id: categoryId } } : undefined,
              countryOfOrigin,
              metaTitle,
              metaDescription,
              isActive: isActive ?? true,
              isFeatured: featuredFlag,
              homepageFeature: homepageFlag,
              colors: hasColors
                ? {
                    create: colors!.map((c, i) => ({
                      name: c.name.trim(),
                      hexCode: c.hexCode?.trim() || null,
                      sku: c.sku?.trim() || null,
                      imageUrl: c.imageUrl?.trim() || null,
                      stockQuantity: Number(c.stockQuantity) || 0,
                      displayOrder: c.displayOrder ?? i,
                    })),
                  }
                : undefined,
            } as any,
          });

          // 2. Create product images
          if (images && images.length > 0) {
            await Promise.all(
              images.map((image) =>
                tx.productImage.create({
                  data: {
                    productId: newProduct.id,
                    imageUrl: image.imageUrl,
                    altText: image.altText || newProduct.name,
                    isPrimary: image.isPrimary,
                    displayOrder: image.displayOrder,
                  },
                }),
              ),
            );
          }

          // 3. Create specifications
          if (specifications && specifications.length > 0) {
            await Promise.all(
              specifications.map((spec) =>
                tx.productSpecification.create({
                  data: {
                    productId: newProduct.id,
                    key: spec.key,
                    value: spec.value,
                  },
                }),
              ),
            );
          }

          return newProduct;
        });

        // Fetch created product with relations
        const productWithRelations = await prisma.product.findUnique({
          where: { id: product.id },
          include: {
            brand: true,
            category: true,
            images: {
              orderBy: { displayOrder: "asc" },
            },
            specifications: true,
            colors: { orderBy: { displayOrder: "asc" } },
          },
        });

        await CacheService.invalidatePattern("products:*");
        return ResponseUtil.success(
          res,
          productWithRelations,
          "Product created successfully",
          201,
        );
      } else {
        // Create product with images and specifications in a transaction
        const product = await prisma.$transaction(async (tx) => {
          // 1. Create product
          const newProduct = await tx.product.create({
            data: {
              name,
              slug,
              longDescription,
              price,
              originalPrice,
              costPrice,
              stockQuantity: resolvedStock,
              lowStockThreshold: lowStockThreshold || 10,
              sku,
              owner: { connect: { id: jwtPayload.userId } },
              brand: brandId ? { connect: { id: brandId } } : undefined,
              category: categoryId ? { connect: { id: categoryId } } : undefined,
              countryOfOrigin,
              isActive: isActive ?? true,
              isFeatured: featuredFlag,
              homepageFeature: homepageFlag,
              metaDescription,
              metaTitle,
              colors: hasColors
                ? {
                    create: colors!.map((c, i) => ({
                      name: c.name.trim(),
                      hexCode: c.hexCode?.trim() || null,
                      sku: c.sku?.trim() || null,
                      imageUrl: c.imageUrl?.trim() || null,
                      stockQuantity: Number(c.stockQuantity) || 0,
                      displayOrder: c.displayOrder ?? i,
                    })),
                  }
                : undefined,
            } as any,
          });

          // 2. Create product images
          if (images && images.length > 0) {
            await Promise.all(
              images.map((image) =>
                tx.productImage.create({
                  data: {
                    productId: newProduct.id,
                    imageUrl: image.imageUrl,
                    altText: image.altText || newProduct.name,
                    isPrimary: image.isPrimary,
                    displayOrder: image.displayOrder,
                  },
                }),
              ),
            );
          }

          // 3. Create specifications
          if (specifications && specifications.length > 0) {
            await Promise.all(
              specifications.map((spec) =>
                tx.productSpecification.create({
                  data: {
                    productId: newProduct.id,
                    key: spec.key,
                    value: spec.value,
                  },
                }),
              ),
            );
          }

          return newProduct;
        });

        // Fetch created product with relations
        const productWithRelations = await prisma.product.findUnique({
          where: { id: product.id },
          include: {
            brand: true,
            category: true,
            images: {
              orderBy: { displayOrder: "asc" },
            },
            specifications: true,
            colors: { orderBy: { displayOrder: "asc" } },
          },
        });

        await CacheService.invalidatePattern("products:*");
        return ResponseUtil.success(
          res,
          parseProductArrays(productWithRelations),
          "Product created successfully",
          201,
        );
      }
    } catch (error) {
      next(error);
    }
  }

  // Bulk create products (Admin). Owner = current user. All-or-nothing: if any
  // item is invalid nothing is created and per-item errors are returned.
  // Images are URL-based here (file uploads aren't supported in bulk).
  static async bulkCreate(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const isSuperAdmin = jwtPayload.role === ROLES.SUPERADMIN;
      const items: CreateProductRequest[] = req.body.products ?? req.body.items;

      if (!Array.isArray(items) || items.length === 0) {
        throw new BadRequestError("Provide a non-empty 'products' array");
      }
      if (items.length > 50) {
        throw new BadRequestError("Cannot create more than 50 products at once");
      }

      // Pre-fetch referenced brands/categories and existing SKUs/slugs.
      const brandIds = [
        ...new Set(items.map((p) => p?.brandId).filter((v): v is number => !!v)),
      ];
      const categoryIds = [
        ...new Set(
          items.map((p) => p?.categoryId).filter((v): v is number => !!v),
        ),
      ];
      const skus = items
        .map((p) => p?.sku)
        .filter((v): v is string => !!v);

      const [brands, categories, existingSkuRows] = await Promise.all([
        brandIds.length
          ? prisma.brand.findMany({
              where: { id: { in: brandIds } },
              select: { id: true, ownerId: true, name: true },
            })
          : Promise.resolve([]),
        categoryIds.length
          ? prisma.category.findMany({
              where: { id: { in: categoryIds } },
              select: { id: true },
            })
          : Promise.resolve([]),
        skus.length
          ? prisma.product.findMany({
              where: { sku: { in: skus } },
              select: { sku: true },
            })
          : Promise.resolve([]),
      ]);
      const validBrandIds = new Set(brands.map((b) => b.id));
      const brandById = new Map(brands.map((b) => [b.id, b]));
      const validCategoryIds = new Set(categories.map((c) => c.id));
      const existingSkus = new Set(
        existingSkuRows.map((p) => p.sku).filter(Boolean) as string[],
      );

      // Existing slugs (to keep generated slugs unique across DB + batch).
      const existingSlugRows = await prisma.product.findMany({
        select: { slug: true },
      });
      const takenSlugs = new Set(existingSlugRows.map((p) => p.slug));

      const colorError = (
        colors?: typeof items[number]["colors"],
      ): string | null => {
        if (!colors) return null;
        for (const c of colors) {
          if (!c?.name || !String(c.name).trim()) {
            return "each color needs a name";
          }
          if (
            c.stockQuantity == null ||
            Number(c.stockQuantity) < 0 ||
            !Number.isFinite(Number(c.stockQuantity))
          ) {
            return `color "${c.name}" needs a valid stock quantity`;
          }
        }
        return null;
      };

      const errors: { index: number; error: string }[] = [];
      const prepared: any[] = [];
      const seenSkus = new Set<string>();

      items.forEach((p, i) => {
        const hasColors = Array.isArray(p?.colors) && p.colors.length > 0;

        if (
          !p?.name ||
          !p?.price ||
          (p.stockQuantity === undefined && !hasColors) ||
          !p?.longDescription ||
          !p?.sku ||
          !p?.brandId ||
          !p?.categoryId
        ) {
          errors.push({
            index: i,
            error:
              "name, price, stock (or colors), longDescription, sku, brandId, categoryId are required",
          });
          return;
        }
        if (p.costPrice === undefined || p.costPrice === null) {
          errors.push({ index: i, error: "costPrice is required" });
          return;
        }
        if (p.price <= 0) {
          errors.push({ index: i, error: "price must be greater than 0" });
          return;
        }
        if (!validBrandIds.has(p.brandId)) {
          errors.push({ index: i, error: `brand ${p.brandId} not found` });
          return;
        }
        // Vendors may only use brands assigned to them (no auto-claim).
        if (!isSuperAdmin) {
          const brand = brandById.get(p.brandId)!;
          if (brand.ownerId !== jwtPayload.userId) {
            errors.push({
              index: i,
              error: `brand "${brand.name}" is not assigned to you`,
            });
            return;
          }
        }
        if (!validCategoryIds.has(p.categoryId)) {
          errors.push({ index: i, error: `category ${p.categoryId} not found` });
          return;
        }
        if (existingSkus.has(p.sku)) {
          errors.push({ index: i, error: `SKU "${p.sku}" already exists` });
          return;
        }
        if (seenSkus.has(p.sku)) {
          errors.push({
            index: i,
            error: `duplicate SKU "${p.sku}" within the batch`,
          });
          return;
        }
        const cErr = colorError(p.colors);
        if (cErr) {
          errors.push({ index: i, error: cErr });
          return;
        }

        seenSkus.add(p.sku);

        // Unique slug across DB + this batch (auto-suffix on collision).
        const slug = SlugUtil.makeUniqueSlug(
          SlugUtil.generateSlug(p.name),
          [...takenSlugs],
        );
        takenSlugs.add(slug);

        const resolvedStock = resolveStock(p.stockQuantity, p.colors);
        const featuredFlag = isSuperAdmin ? p.isFeatured ?? false : false;
        const homepageFlag = isSuperAdmin ? p.homepageFeature ?? false : false;

        prepared.push({
          name: p.name,
          slug,
          longDescription: p.longDescription,
          price: p.price,
          originalPrice: p.originalPrice,
          costPrice: p.costPrice,
          stockQuantity: resolvedStock,
          lowStockThreshold: p.lowStockThreshold || 10,
          sku: p.sku,
          owner: { connect: { id: jwtPayload.userId } },
          brand: { connect: { id: p.brandId } },
          category: { connect: { id: p.categoryId } },
          countryOfOrigin: p.countryOfOrigin,
          metaTitle: p.metaTitle,
          metaDescription: p.metaDescription,
          isActive: p.isActive ?? true,
          isFeatured: featuredFlag,
          homepageFeature: homepageFlag,
          colors: hasColors
            ? {
                create: p.colors!.map((c, idx) => ({
                  name: c.name.trim(),
                  hexCode: c.hexCode?.trim() || null,
                  sku: c.sku?.trim() || null,
                  imageUrl: c.imageUrl?.trim() || null,
                  stockQuantity: Number(c.stockQuantity) || 0,
                  displayOrder: c.displayOrder ?? idx,
                })),
              }
            : undefined,
          images:
            p.images && p.images.length > 0
              ? {
                  create: p.images.map((img) => ({
                    imageUrl: img.imageUrl,
                    altText: img.altText || p.name,
                    isPrimary: img.isPrimary,
                    displayOrder: img.displayOrder,
                  })),
                }
              : undefined,
          specifications:
            p.specifications && p.specifications.length > 0
              ? {
                  create: p.specifications.map((s) => ({
                    key: s.key,
                    value: s.value,
                  })),
                }
              : undefined,
        });
      });

      if (errors.length > 0) {
        return ResponseUtil.badRequest(
          res,
          `Bulk create failed for ${errors.length} of ${items.length} item(s). No products were created.`,
          errors,
        );
      }

      const created = await prisma.$transaction(
        async (tx) => {
          const out = [];
          for (const data of prepared) {
            const product = await tx.product.create({
              data,
              include: {
                brand: true,
                category: true,
                images: { orderBy: { displayOrder: "asc" } },
                specifications: true,
                colors: { orderBy: { displayOrder: "asc" } },
              },
            });
            out.push(product);
          }
          return out;
        },
        // Creating up to 50 products (with nested colors/images/specs) over a
        // remote pooled connection can exceed the 5s default interactive-tx limit.
        { timeout: 60000, maxWait: 15000 },
      );

      const products = created.map((p) =>
        parseProductArrays(
          ProductController.transformProductResponse(p, true),
        ),
      );

      await CacheService.invalidatePattern("products:*");
      return ResponseUtil.success(
        res,
        { count: products.length, products },
        `${products.length} product(s) created successfully`,
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // Update product (Admin)
  static async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const updateData: UpdateProductRequest = req.body;

      const productId = parseInt(id);

      // Check if product exists
      const existingProduct = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          images: true,
          specifications: true,
        },
      });

      if (!existingProduct) {
        throw new NotFoundError("Product not found");
      }

      // Vendors may only update their own products (superadmin bypasses)
      assertOwnership(
        existingProduct.ownerId,
        (req as any).jwtPayload as JwtPayload,
      );

      // Extract fields from updateData
      const {
        name,
        longDescription,
        price,
        originalPrice,
        costPrice,
        stockQuantity,
        lowStockThreshold,
        sku,
        brandId,
        categoryId,
        countryOfOrigin,
        isActive,
        isFeatured,
        homepageFeature,
        colors,
        images,
        specifications,
        metaTitle,
        metaDescription,
      } = updateData;

      validateColors(colors);

      // colors provided (even empty array) => replace variants; sync product stock.
      const colorsProvided = colors !== undefined;
      const hasColors = Array.isArray(colors) && colors.length > 0;
      const resolvedStock = hasColors
        ? resolveStock(stockQuantity, colors)
        : stockQuantity;

      // Only the superadmin may change featured flags (store-front curation).
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const isSuperAdmin = jwtPayload.role === ROLES.SUPERADMIN;

      // If the brand is changing, a vendor may only move it to a brand assigned
      // to them (superadmin may use any).
      if (brandId !== undefined && brandId !== existingProduct.brandId) {
        await ProductController.assertBrandAssignable(brandId, jwtPayload);
      }

      // Check if SKU is being changed and if it's already in use
      if (sku && sku !== existingProduct.sku) {
        const existingSku = await prisma.product.findUnique({
          where: { sku },
        });

        if (existingSku) {
          throw new ConflictError(`Product with SKU "${sku}" already exists`);
        }
      }

      // Generate new slug if name is being changed
      let slug = existingProduct.slug;
      if (name && name !== existingProduct.name) {
        slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        // Check if new slug already exists
        const existingSlug = await prisma.product.findFirst({
          where: {
            slug,
            id: { not: productId },
          },
        });

        if (existingSlug) {
          slug = `${slug}-${Date.now()}`;
        }
      }

      // Update product with images and specifications in a transaction
      const product = await prisma.$transaction(async (tx) => {
        // 1. Update product
        const updatedProduct = await tx.product.update({
          where: { id: productId },
          data: {
            name,
            slug,
            longDescription,
            price,
            originalPrice,
            costPrice,
            stockQuantity: resolvedStock,
            lowStockThreshold,
            sku,
            brand: brandId !== undefined
              ? (brandId ? { connect: { id: brandId } } : { disconnect: true })
              : undefined,
            category: categoryId !== undefined
              ? (categoryId ? { connect: { id: categoryId } } : { disconnect: true })
              : undefined,
            countryOfOrigin,
            isActive,
            // Vendors cannot toggle featured flags — leave unchanged for them.
            isFeatured: isSuperAdmin ? isFeatured : undefined,
            homepageFeature: isSuperAdmin ? homepageFeature : undefined,
            metaTitle,
            metaDescription,
          } as any,
        });

        // 2. Update images if provided
        if (images !== undefined) {
          await tx.productImage.deleteMany({ where: { productId } });

          if (images && images.length > 0) {
            await Promise.all(
              images.map((image) =>
                tx.productImage.create({
                  data: {
                    productId,
                    imageUrl: image.imageUrl,
                    altText: image.altText || updatedProduct.name,
                    isPrimary: image.isPrimary,
                    displayOrder: image.displayOrder,
                  },
                }),
              ),
            );
          }
        }

        // 3. Update specifications if provided
        if (specifications !== undefined) {
          await tx.productSpecification.deleteMany({ where: { productId } });

          if (specifications && specifications.length > 0) {
            await Promise.all(
              specifications.map((spec) =>
                tx.productSpecification.create({
                  data: { productId, key: spec.key, value: spec.value },
                }),
              ),
            );
          }
        }

        // 4. Replace color variants if provided (empty array clears them)
        if (colorsProvided) {
          await tx.productColor.deleteMany({ where: { productId } });
          await createProductColors(tx, productId, colors);
        }

        return updatedProduct;
      });

      // Delete orphaned Supabase Storage files for images that were removed
      if (images !== undefined) {
        const newUrls = new Set((images || []).map((img) => img.imageUrl));
        const toDelete = existingProduct.images
          .filter((img) => !newUrls.has(img.imageUrl))
          .map((img) => img.imageUrl);

        if (toDelete.length > 0) {
          void StorageService.deleteImages(toDelete).catch((err) =>
            console.error("Failed to delete old product images from storage:", err),
          );
        }
      }

      // Fetch updated product with parallel queries (same pattern as getBySlug)
      const [updatedProduct, allCategories, updatedImages, updatedSpecs, updatedColors] =
        await Promise.all([
          prisma.product.findUnique({ where: { id: product.id }, include: { brand: true } }),
          prisma.category.findMany({
            select: { id: true, name: true, slug: true, parentId: true, level: true, description: true, isActive: true },
          }),
          prisma.productImage.findMany({
            where: { productId: product.id },
            orderBy: { displayOrder: "asc" },
          }),
          prisma.productSpecification.findMany({
            where: { productId: product.id },
          }),
          prisma.productColor.findMany({
            where: { productId: product.id },
            orderBy: { displayOrder: "asc" },
          }),
        ]);

      const catMap = new Map(allCategories.map((c) => [c.id, c]));
      const category = ProductController.buildCategoryWithParents(
        updatedProduct!.categoryId,
        catMap,
      );
      const fullProduct = { ...updatedProduct, category, images: updatedImages, specifications: updatedSpecs, colors: updatedColors };
      const response = ProductController.transformProductResponse(fullProduct, true);

      await CacheService.invalidatePattern("products:*");
      return ResponseUtil.success(res, response, "Product updated successfully");
    } catch (error) {
      next(error);
    }
  }

  // Helper function to get all category IDs including children
  private static async getCategoryIdsWithChildren(
    categoryId: number,
  ): Promise<number[]> {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) return [];

    const categoryIds: number[] = [categoryId];

    if (category.level === 1) {
      // Get all level 2 children
      const level2Categories = await prisma.category.findMany({
        where: { parentId: categoryId, level: 2 },
        select: { id: true },
      });

      const level2Ids = level2Categories.map((cat) => cat.id);
      categoryIds.push(...level2Ids);

      // Get all level 3 children
      if (level2Ids.length > 0) {
        const level3Categories = await prisma.category.findMany({
          where: { parentId: { in: level2Ids }, level: 3 },
          select: { id: true },
        });

        categoryIds.push(...level3Categories.map((cat) => cat.id));
      }
    } else if (category.level === 2) {
      // Get all level 3 children
      const level3Categories = await prisma.category.findMany({
        where: { parentId: categoryId, level: 3 },
        select: { id: true },
      });

      categoryIds.push(...level3Categories.map((cat) => cat.id));
    }

    return categoryIds;
  }

  // Get all products with filters (Public)
  static async getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = 1,
        limit = 12,
        search,
        categoryId,
        categorySlug,
        brandId,
        brandSlug,
        minPrice,
        maxPrice,
        inStock,
        isFeatured,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const cacheKey = `products:list:${JSON.stringify(req.query)}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) return ResponseUtil.success(res, cached, "Products retrieved successfully");

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      // Build where clause. Public storefront only ever shows active products
      // (deactivated products — e.g. from a deactivated vendor — stay hidden).
      const where: any = {
        isActive: true,
      };

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { longDescription: { contains: search as string, mode: "insensitive" } },
        ];
      }

      if (categoryId || categorySlug) {
        let targetCategoryId: number | null = null;

        if (categorySlug) {
          const category = await prisma.category.findUnique({
            where: { slug: categorySlug as string },
          });
          targetCategoryId = category?.id || null;
        } else {
          targetCategoryId = parseInt(categoryId as string);
        }

        if (targetCategoryId) {
          const categoryIds =
            await ProductController.getCategoryIdsWithChildren(
              targetCategoryId,
            );

          if (categoryIds.length > 0) {
            where.categoryId =
              categoryIds.length === 1 ? categoryIds[0] : { in: categoryIds };
          }
        }
      }

      // Handle brand filtering (by ID or slug)
      if (brandId || brandSlug) {
        if (brandSlug) {
          const brand = await prisma.brand.findUnique({
            where: { slug: brandSlug as string },
            select: { id: true },
          });
          if (brand) {
            where.brandId = brand.id;
          }
        } else {
          where.brandId = parseInt(brandId as string);
        }
      }

      if (minPrice || maxPrice) {
        where.price = {};
        if (minPrice) where.price.gte = parseFloat(minPrice as string);
        if (maxPrice) where.price.lte = parseFloat(maxPrice as string);
      }

      if (inStock === "true") {
        where.stockQuantity = { gt: 0 };
      }

      if (isFeatured === "true") {
        where.isFeatured = true;
      }

      if (req.query.homepageFeature === "true") {
        where.homepageFeature = true;
      }

      // Build orderBy
      const orderBy: any = {};
      orderBy[sortBy as string] = sortOrder;

      // Get products with pagination
      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            brand: true,
            category: true,
            images: {
              where: { isPrimary: true },
              take: 1,
            },
            colors: { orderBy: { displayOrder: "asc" } },
          },
          skip,
          take: limitNum,
          orderBy,
        }),
        prisma.product.count({ where }),
      ]);

      // Transform products
      const transformedProducts = products.map(
        (product) => ProductController.transformProductResponse(product, false), // false = don't include costPrice
      );

      // Parse JSON arrays for each product
      const parsedProducts = transformedProducts.map(parseProductArrays);

      const result = {
        data: parsedProducts,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
      CacheService.setBackground(cacheKey, result, TTL.PRODUCT_LIST);
      return ResponseUtil.success(res, result, "Products retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get products for the admin panel, scoped to the caller (Admin/Vendor).
  // A vendor sees only products they own; the superadmin sees all (optionally
  // filtered by ?ownerId=). Includes costPrice and is never cached.
  static async getAdminProducts(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const {
        page = 1,
        limit = 20,
        search,
        isActive,
        ownerId,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      const pageNum = parseInt(page as string);
      const limitNum = parseInt(limit as string);
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      // Ownership scoping: vendors are locked to their own products.
      if (jwtPayload.role === ROLES.SUPERADMIN) {
        if (ownerId) where.ownerId = parseInt(ownerId as string);
      } else {
        where.ownerId = jwtPayload.userId;
      }

      if (search) {
        where.OR = [
          { name: { contains: search as string, mode: "insensitive" } },
          { sku: { contains: search as string, mode: "insensitive" } },
        ];
      }

      if (isActive !== undefined) {
        where.isActive = isActive === "true";
      }

      if (req.query.isFeatured !== undefined) {
        where.isFeatured = req.query.isFeatured === "true";
      }

      if (req.query.homepageFeature !== undefined) {
        where.homepageFeature = req.query.homepageFeature === "true";
      }

      const orderBy: any = {};
      orderBy[sortBy as string] = sortOrder;

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            brand: true,
            category: true,
            images: { where: { isPrimary: true }, take: 1 },
            colors: { orderBy: { displayOrder: "asc" } },
          },
          skip,
          take: limitNum,
          orderBy,
        }),
        prisma.product.count({ where }),
      ]);

      const data = products.map((product) =>
        parseProductArrays(
          ProductController.transformProductResponse(product, true),
        ),
      );

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
        "Products retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Get products with discounts (originalPrice > price)
  static getDiscountedProducts = async (req: Request, res: Response) => {
    try {
      const { limit = 10 } = req.query;

      const cacheKey = `products:discounted:${limit}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) {
        return res.status(200).json({ status: "success", data: { data: cached } });
      }

      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          AND: [
            { originalPrice: { not: null } },
            {
              originalPrice: {
                gt: prisma.product.fields.price,
              },
            },
          ],
        },
        include: {
          brand: true,
          category: true,
          colors: { orderBy: { displayOrder: "asc" } },
          images: {
            orderBy: {
              displayOrder: "asc",
            },
          },
        },
        take: parseInt(limit as string),
        orderBy: {
          createdAt: "desc",
        },
      });

      // Transform products
      const transformedProducts = products.map(
        (product) => ProductController.transformProductResponse(product, false), // false = don't include costPrice
      );

      CacheService.setBackground(cacheKey, transformedProducts, TTL.PRODUCT_LIST);
      res.status(200).json({
        status: "success",
        data: { data: transformedProducts },
        pagination: {
          total: transformedProducts.length,
          page: 1,
          limit: parseInt(limit as string),
        },
      });
    } catch (error) {
      console.error("Get discounted products error:", error);
      res.status(500).json({
        status: "error",
        message: "Failed to fetch discounted products",
      });
    }
  };

  // Compare up to 3 products side by side (Public).
  // Usage: GET /products/compare?ids=1,2,3
  // Returns the products (active only, in the requested order) plus a unified,
  // ordered list of spec keys so the client can align rows across products.
  static async compare(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = req.query.ids;
      const ids = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [])
        .map((v) => parseInt(String(v).trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0);

      const uniqueIds = [...new Set(ids)];

      if (uniqueIds.length < 2) {
        throw new BadRequestError(
          "Provide at least 2 product ids to compare (e.g. ?ids=1,2).",
        );
      }
      if (uniqueIds.length > 3) {
        throw new BadRequestError(
          "You can compare a maximum of 3 products at a time.",
        );
      }

      const products = await prisma.product.findMany({
        where: { id: { in: uniqueIds }, isActive: true },
        include: {
          brand: true,
          category: true,
          specifications: true,
          colors: { orderBy: { displayOrder: "asc" } },
          images: { where: { isPrimary: true }, take: 1 },
        },
      });

      // Preserve the caller's order and drop any missing/inactive ids.
      const byId = new Map(products.map((p) => [p.id, p]));
      const ordered = uniqueIds
        .map((id) => byId.get(id))
        .filter((p): p is (typeof products)[number] => Boolean(p));

      if (ordered.length === 0) {
        throw new NotFoundError("No matching products found to compare.");
      }

      const transformed = ordered.map((p) =>
        ProductController.transformProductResponse(p, false),
      );

      // Union of spec keys in first-seen order — lets the UI render aligned rows.
      const specKeys: string[] = [];
      for (const p of transformed) {
        for (const s of p.specifications ?? []) {
          if (!specKeys.includes(s.key)) specKeys.push(s.key);
        }
      }

      return ResponseUtil.success(
        res,
        { products: transformed, specKeys },
        "Products retrieved for comparison",
      );
    } catch (error) {
      next(error);
    }
  }

  // Resolve a category with its parent chain using a pre-fetched category map
  private static buildCategoryWithParents(
    categoryId: number | null,
    catMap: Map<number, any>,
  ): any {
    if (!categoryId) return null;
    const cat = catMap.get(categoryId);
    if (!cat) return null;
    return {
      ...cat,
      parent: cat.parentId ? ProductController.buildCategoryWithParents(cat.parentId, catMap) : null,
    };
  }

  // Get single product by slug (Public)
  static async getBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;

      const cacheKey = `products:slug:${slug}`;
      const cached = await CacheService.get(cacheKey);
      if (cached) return ResponseUtil.success(res, cached, "Product retrieved successfully");

      // Run all 4 queries in parallel — cuts 6 sequential RTTs down to 1 parallel group
      const [product, allCategories, images, specifications, colors] = await Promise.all([
        prisma.product.findUnique({ where: { slug }, include: { brand: true } }),
        prisma.category.findMany({
          select: { id: true, name: true, slug: true, parentId: true, level: true, description: true, isActive: true },
        }),
        prisma.productImage.findMany({
          where: { product: { slug } },
          orderBy: { displayOrder: "asc" },
        }),
        prisma.productSpecification.findMany({
          where: { product: { slug } },
        }),
        prisma.productColor.findMany({
          where: { product: { slug } },
          orderBy: { displayOrder: "asc" },
        }),
      ]);

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      if (!product.isActive) {
        throw new NotFoundError("Product not available");
      }

      const catMap = new Map(allCategories.map((c) => [c.id, c]));
      const category = ProductController.buildCategoryWithParents(product.categoryId, catMap);

      const fullProduct = { ...product, category, images, specifications, colors };
      const response = ProductController.transformProductResponse(fullProduct, false);

      CacheService.setBackground(cacheKey, response, TTL.PRODUCT_SLUG);
      return ResponseUtil.success(res, response, "Product retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Get single product by ID (Admin)
  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const productId = parseInt(id);

      // Run all queries in parallel
      const [product, allCategories, images, specifications, colors] = await Promise.all([
        prisma.product.findUnique({ where: { id: productId }, include: { brand: true } }),
        prisma.category.findMany({
          select: { id: true, name: true, slug: true, parentId: true, level: true, description: true, isActive: true },
        }),
        prisma.productImage.findMany({
          where: { productId },
          orderBy: { displayOrder: "asc" },
        }),
        prisma.productSpecification.findMany({
          where: { productId },
        }),
        prisma.productColor.findMany({
          where: { productId },
          orderBy: { displayOrder: "asc" },
        }),
      ]);

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      // Vendors may only view their own product's admin detail (superadmin bypasses)
      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      const catMap = new Map(allCategories.map((c) => [c.id, c]));
      const category = ProductController.buildCategoryWithParents(product.categoryId, catMap);

      const fullProduct = { ...product, category, images, specifications, colors };
      const response = ProductController.transformProductResponse(fullProduct, true);

      return ResponseUtil.success(
        res,
        parseProductArrays(response),
        "Product retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // // Update product (Admin only)
  // static async update(req: Request, res: Response, next: NextFunction) {
  //   try {
  //     const { id } = req.params;
  //     const updateData: UpdateProductRequest = req.body;

  //     // Check if product exists
  //     const existingProduct = await prisma.product.findUnique({
  //       where: { id: parseInt(id) },
  //     });

  //     if (!existingProduct) {
  //       throw new NotFoundError("Product not found");
  //     }

  //     // If updating slug, check for conflicts
  //     if (updateData.slug && updateData.slug !== existingProduct.slug) {
  //       const slugExists = await prisma.product.findUnique({
  //         where: { slug: updateData.slug },
  //       });

  //       if (slugExists) {
  //         throw new ConflictError("Slug already exists");
  //       }
  //     }

  //     // If updating SKU, check for conflicts
  //     if (updateData.sku && updateData.sku !== existingProduct.sku) {
  //       const skuExists = await prisma.product.findUnique({
  //         where: { sku: updateData.sku },
  //       });

  //       if (skuExists) {
  //         throw new ConflictError("SKU already exists");
  //       }
  //     }

  //     // Validate brand if provided
  //     if (updateData.brandId) {
  //       const brand = await prisma.brand.findUnique({
  //         where: { id: updateData.brandId },
  //       });
  //       if (!brand) {
  //         throw new NotFoundError("Brand not found");
  //       }
  //     }

  //     // Validate category if provided
  //     if (updateData.categoryId) {
  //       const category = await prisma.category.findUnique({
  //         where: { id: updateData.categoryId },
  //       });
  //       if (!category) {
  //         throw new NotFoundError("Category not found");
  //       }
  //     }

  //     // Convert arrays to JSON strings if provided
  //     const dataToUpdate: any = { ...updateData };

  //     if (updateData.effectiveFor !== undefined) {
  //       dataToUpdate.effectiveFor = JsonUtil.arrayToJson(
  //         updateData.effectiveFor
  //       );
  //     }
  //     if (updateData.features !== undefined) {
  //       dataToUpdate.features = JsonUtil.arrayToJson(updateData.features);
  //     }
  //     if (updateData.certifications !== undefined) {
  //       dataToUpdate.certifications = JsonUtil.arrayToJson(
  //         updateData.certifications
  //       );
  //     }
  //     if (updateData.badges !== undefined) {
  //       dataToUpdate.badges = JsonUtil.arrayToJson(updateData.badges);
  //     }

  //     // Update product
  //     const product = await prisma.product.update({
  //       where: { id: parseInt(id) },
  //       data: dataToUpdate,
  //       include: {
  //         brand: true,
  //         category: {
  //           include: {
  //             parent: {
  //               include: {
  //                 parent: true,
  //               },
  //             },
  //           },
  //         },
  //         images: {
  //           orderBy: { displayOrder: "asc" },
  //         },
  //         specifications: true,
  //       },
  //     });

  //     // Transform response
  //     const response = ProductController.transformProductResponse(
  //       product,
  //       true
  //     );

  //     return ResponseUtil.success(
  //       res,
  //       response,
  //       "Product updated successfully"
  //     );
  //   } catch (error) {
  //     next(error);
  //   }
  // }

  // Delete product (Admin only)
  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const productId = parseInt(id);

      // Fetch product with images (for storage cleanup) and its order-item count
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          images: true,
          _count: { select: { orderItems: true } },
        },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      // Vendors may only delete their own products (superadmin bypasses)
      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      // A product referenced by past orders can't be hard-deleted without losing
      // order history. Archive it instead (deactivate + hide from the store).
      if (product._count.orderItems > 0) {
        await prisma.product.update({
          where: { id: productId },
          data: { isActive: false },
        });

        await CacheService.invalidatePattern("products:*");
        return ResponseUtil.success(
          res,
          { archived: true },
          "Product has existing orders, so it was archived (deactivated) instead of deleted to preserve order history.",
        );
      }

      // No orders reference it — safe to hard-delete. Remove storage images first.
      if (product.images.length > 0) {
        await StorageService.deleteImages(
          product.images.map((img) => img.imageUrl),
        );
      }

      // Delete product — cascade removes images, colors, cart/wishlist rows
      await prisma.product.delete({ where: { id: productId } });

      await CacheService.invalidatePattern("products:*");
      return ResponseUtil.success(
        res,
        { archived: false },
        "Product deleted successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Helper method to transform product response
  private static transformProductResponse(
    product: any,
    includeCostPrice: boolean = false,
  ) {
    // Convert JSON string back to array
    const badges = JsonUtil.jsonToArray(product.badges);

    // Calculate stock status (product.stockQuantity is kept in sync as the
    // aggregate of any color-variant stock, so this stays correct either way).
    let stockStatus: "in_stock" | "low_stock" | "out_of_stock" = "in_stock";
    if (product.stockQuantity === 0) {
      stockStatus = "out_of_stock";
    } else if (product.stockQuantity <= product.lowStockThreshold) {
      stockStatus = "low_stock";
    }

    // Calculate discount percentage if originalPrice exists
    let discountPercentage: number | undefined;
    if (product.originalPrice && product.originalPrice > product.price) {
      discountPercentage = Math.round(
        ((product.originalPrice - product.price) / product.originalPrice) * 100,
      );
    }

    const response: any = {
      ...product,
      badges,
      stockStatus,
      discountPercentage,
    };

    // Hide costPrice from public
    if (!includeCostPrice) {
      delete response.costPrice;
    }

    return response;
  }

  // ==================== PRODUCT IMAGES ====================

  // Add images to product (Admin only)
  static async addImages(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { images }: { images: ProductImageRequest[] } = req.body;

      // Validation
      if (!images || !Array.isArray(images) || images.length === 0) {
        throw new BadRequestError("Images array is required");
      }

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: parseInt(id) },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      // Validate image data
      for (const image of images) {
        if (!image.imageUrl) {
          throw new BadRequestError("Image URL is required for all images");
        }
      }

      // If any image is marked as primary, unset existing primary
      const hasPrimary = images.some((img) => img.isPrimary === true);
      if (hasPrimary) {
        await prisma.productImage.updateMany({
          where: { productId: parseInt(id) },
          data: { isPrimary: false },
        });
      }

      // Create images
      const createdImages = await Promise.all(
        images.map((image, index) =>
          prisma.productImage.create({
            data: {
              productId: parseInt(id),
              imageUrl: image.imageUrl,
              altText: image.altText,
              isPrimary: image.isPrimary || false,
              displayOrder: image.displayOrder ?? index + 1,
            },
          }),
        ),
      );

      return ResponseUtil.success(
        res,
        createdImages,
        "Images added successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // Get product images (Public)
  static async getImages(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: parseInt(id) },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      const images = await prisma.productImage.findMany({
        where: { productId: parseInt(id) },
        orderBy: { displayOrder: "asc" },
      });

      return ResponseUtil.success(res, images, "Images retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  // Update single image (Admin only)
  static async updateImage(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, imageId } = req.params;
      const { imageUrl, altText, isPrimary, displayOrder } = req.body;

      // Parse IDs to integers
      const productId = parseInt(id);
      const imageIdInt = parseInt(imageId);

      // Check if image exists
      const existingImage = await prisma.productImage.findUnique({
        where: { id: imageIdInt }, // ✅ Fixed: use parsed integer
      });

      if (!existingImage || existingImage.productId !== productId) {
        throw new NotFoundError("Image not found");
      }

      await ProductController.assertCanManageProduct(productId, req);

      // If setting as primary, unset other primary images
      if (isPrimary === true) {
        await prisma.productImage.updateMany({
          where: {
            productId: productId,
            id: { not: imageIdInt }, // ✅ Fixed: use parsed integer
          },
          data: { isPrimary: false },
        });
      }

      // Update image
      const image = await prisma.productImage.update({
        where: { id: imageIdInt }, // ✅ Fixed: use parsed integer
        data: {
          imageUrl,
          altText,
          isPrimary,
          displayOrder,
        },
      });

      return ResponseUtil.success(res, image, "Image updated successfully");
    } catch (error) {
      next(error);
    }
  }

  // Delete single image (Admin only)
  static async deleteImage(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, imageId } = req.params;

      const productId = parseInt(id);
      const imageIdInt = parseInt(imageId);

      const image = await prisma.productImage.findUnique({
        where: { id: imageIdInt },
      });

      if (!image || image.productId !== productId) {
        throw new NotFoundError("Image not found");
      }

      await ProductController.assertCanManageProduct(productId, req);

      // Delete from Supabase Storage, then remove DB record
      await StorageService.deleteImage(image.imageUrl);
      await prisma.productImage.delete({ where: { id: imageIdInt } });

      return ResponseUtil.success(res, null, "Image deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  // Set primary image (Admin only)
  static async setPrimaryImage(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, imageId } = req.params;

      // Parse IDs to integers
      const productId = parseInt(id);
      const imageIdInt = parseInt(imageId);

      // Check if image exists and belongs to product
      const image = await prisma.productImage.findUnique({
        where: { id: imageIdInt }, // ✅ Fixed: use parsed integer
      });

      if (!image || image.productId !== productId) {
        throw new NotFoundError("Image not found");
      }

      await ProductController.assertCanManageProduct(productId, req);

      // Unset all primary images for this product
      await prisma.productImage.updateMany({
        where: { productId: productId },
        data: { isPrimary: false },
      });

      // Set this image as primary
      const updatedImage = await prisma.productImage.update({
        where: { id: imageIdInt }, // ✅ Fixed: use parsed integer
        data: { isPrimary: true },
      });

      return ResponseUtil.success(
        res,
        updatedImage,
        "Primary image updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Upload image file to Supabase Storage and attach to product (Admin only)
  static async uploadImage(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const productId = parseInt(id);
      const file = req.file;

      if (!file) {
        throw new BadRequestError("Image file is required");
      }

      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      // Upload to Supabase Storage
      const imageUrl = await StorageService.uploadImage(file, "products");

      // Check if this product has any images yet (first image becomes primary)
      const existingCount = await prisma.productImage.count({
        where: { productId },
      });

      const image = await prisma.productImage.create({
        data: {
          productId,
          imageUrl,
          altText: product.name,
          isPrimary: existingCount === 0,
          displayOrder: existingCount,
        },
      });

      return ResponseUtil.success(res, image, "Image uploaded successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  // Reorder images (Admin only)
  static async reorderImages(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const {
        imageOrders,
      }: { imageOrders: { imageId: number; displayOrder: number }[] } =
        req.body;

      // Parse product ID
      const productId = parseInt(id);

      if (!imageOrders || !Array.isArray(imageOrders)) {
        throw new BadRequestError("imageOrders array is required");
      }

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      // Update all image orders
      await Promise.all(
        imageOrders.map(({ imageId, displayOrder }) =>
          prisma.productImage.updateMany({
            where: {
              id: parseInt(imageId.toString()), // ✅ Fixed: ensure integer
              productId: productId,
            },
            data: { displayOrder: parseInt(displayOrder.toString()) }, // ✅ Fixed: ensure integer
          }),
        ),
      );

      // Get updated images
      const images = await prisma.productImage.findMany({
        where: { productId: productId },
        orderBy: { displayOrder: "asc" },
      });

      return ResponseUtil.success(res, images, "Images reordered successfully");
    } catch (error) {
      next(error);
    }
  }

  // ==================== PRODUCT SPECIFICATIONS ====================

  // Add specifications to product (Admin only)
  static async addSpecifications(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      const {
        specifications,
      }: { specifications: ProductSpecificationRequest[] } = req.body;

      // Parse product ID
      const productId = parseInt(id);

      // Validation
      if (
        !specifications ||
        !Array.isArray(specifications) ||
        specifications.length === 0
      ) {
        throw new BadRequestError("Specifications array is required");
      }

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      // Validate specification data
      for (const spec of specifications) {
        if (!spec.key || !spec.value) {
          throw new BadRequestError(
            "Key and value are required for all specifications",
          );
        }
      }

      // Create specifications
      const createdSpecs = await Promise.all(
        specifications.map((spec) =>
          prisma.productSpecification.create({
            data: {
              productId: productId,
              key: spec.key,
              value: spec.value,
            },
          }),
        ),
      );

      return ResponseUtil.success(
        res,
        createdSpecs,
        "Specifications added successfully",
        201,
      );
    } catch (error) {
      next(error);
    }
  }

  // Get product specifications (Public)
  static async getSpecifications(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      const productId = parseInt(id);

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      const specifications = await prisma.productSpecification.findMany({
        where: { productId: productId },
      });

      return ResponseUtil.success(
        res,
        specifications,
        "Specifications retrieved successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Update single specification (Admin only)
  static async updateSpecification(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, specId } = req.params;
      const { key, value } = req.body;

      // Parse IDs
      const productId = parseInt(id);
      const specIdInt = parseInt(specId);

      // Check if specification exists
      const existingSpec = await prisma.productSpecification.findUnique({
        where: { id: specIdInt },
      });

      if (!existingSpec || existingSpec.productId !== productId) {
        throw new NotFoundError("Specification not found");
      }

      await ProductController.assertCanManageProduct(productId, req);

      // Update specification
      const specification = await prisma.productSpecification.update({
        where: { id: specIdInt },
        data: {
          key,
          value,
        },
      });

      return ResponseUtil.success(
        res,
        specification,
        "Specification updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Delete single specification (Admin only)
  static async deleteSpecification(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id, specId } = req.params;

      // Parse IDs
      const productId = parseInt(id);
      const specIdInt = parseInt(specId);

      // Check if specification exists
      const specification = await prisma.productSpecification.findUnique({
        where: { id: specIdInt },
      });

      if (!specification || specification.productId !== productId) {
        throw new NotFoundError("Specification not found");
      }

      await ProductController.assertCanManageProduct(productId, req);

      // Delete specification
      await prisma.productSpecification.delete({
        where: { id: specIdInt },
      });

      return ResponseUtil.success(
        res,
        null,
        "Specification deleted successfully",
      );
    } catch (error) {
      next(error);
    }
  }

  // Bulk update specifications (Admin only)
  static async bulkUpdateSpecifications(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { id } = req.params;
      const {
        specifications,
      }: { specifications: ProductSpecificationRequest[] } = req.body;

      // Parse product ID
      const productId = parseInt(id);

      if (!specifications || !Array.isArray(specifications)) {
        throw new BadRequestError("Specifications array is required");
      }

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new NotFoundError("Product not found");
      }

      assertOwnership(product.ownerId, (req as any).jwtPayload as JwtPayload);

      // Delete all existing specifications
      await prisma.productSpecification.deleteMany({
        where: { productId: productId },
      });

      // Create new specifications
      const createdSpecs = await Promise.all(
        specifications.map((spec) =>
          prisma.productSpecification.create({
            data: {
              productId: productId,
              key: spec.key,
              value: spec.value,
            },
          }),
        ),
      );

      return ResponseUtil.success(
        res,
        createdSpecs,
        "Specifications updated successfully",
      );
    } catch (error) {
      next(error);
    }
  }
}
