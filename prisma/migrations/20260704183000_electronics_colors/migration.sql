-- Electronics platform: drop skincare fields, replace sizes with per-color variants.

-- 1. New per-color variant table
CREATE TABLE "product_colors" (
    "id" SERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "hex_code" TEXT,
    "sku" TEXT,
    "image_url" TEXT,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_colors_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "product_colors" ADD CONSTRAINT "product_colors_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. products: remove skincare attributes and sizes
ALTER TABLE "products" DROP COLUMN IF EXISTS "sizes";
ALTER TABLE "products" DROP COLUMN IF EXISTS "skin_type";
ALTER TABLE "products" DROP COLUMN IF EXISTS "skin_concern";

-- 3. cart_items: size -> color variant reference
ALTER TABLE "cart_items" DROP COLUMN IF EXISTS "size";
ALTER TABLE "cart_items" ADD COLUMN "color_id" INTEGER;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_color_id_fkey"
    FOREIGN KEY ("color_id") REFERENCES "product_colors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. order_items: product_size -> color snapshot (+ optional variant reference)
ALTER TABLE "order_items" DROP COLUMN IF EXISTS "product_size";
ALTER TABLE "order_items" ADD COLUMN "color_name" TEXT;
ALTER TABLE "order_items" ADD COLUMN "color_id" INTEGER;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_color_id_fkey"
    FOREIGN KEY ("color_id") REFERENCES "product_colors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
