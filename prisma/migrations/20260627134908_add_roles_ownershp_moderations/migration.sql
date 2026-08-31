-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_user_id_fkey";

-- DropForeignKey
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_parent_review_id_fkey";

-- DropIndex
DROP INDEX "reviews_product_id_user_id_key";

-- AlterTable
ALTER TABLE "discounts" ADD COLUMN     "owner_id" INTEGER;

-- AlterTable
ALTER TABLE "hero_images" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "owner_id" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "created_by_id" INTEGER,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_parent_review_id_fkey" FOREIGN KEY ("parent_review_id") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;
