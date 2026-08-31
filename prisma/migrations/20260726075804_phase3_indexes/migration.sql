-- CreateIndex
CREATE INDEX "cart_items_user_id_idx" ON "cart_items"("user_id");

-- CreateIndex
CREATE INDEX "orders_user_id_idx" ON "orders"("user_id");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_owner_id_idx" ON "products"("owner_id");

-- CreateIndex
CREATE INDEX "products_is_active_idx" ON "products"("is_active");
