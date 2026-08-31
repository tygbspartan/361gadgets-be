-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "owner_id" INTEGER;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
