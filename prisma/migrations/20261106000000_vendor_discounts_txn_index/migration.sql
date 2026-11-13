-- Vendor-funded discounts: each order line's share of a discount its vendor
-- pays for. Existing rows default to 0 (all past discounts were platform-paid).
ALTER TABLE "order_items" ADD COLUMN "vendor_discount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- One payment reference per live order. Case- and space-insensitive; cancelled
-- orders release their number. Not representable in schema.prisma (partial,
-- expression index), so it lives only here.
CREATE UNIQUE INDEX "orders_transaction_number_active_key"
  ON "orders" (lower(btrim("transaction_number")))
  WHERE "transaction_number" IS NOT NULL AND "status" <> 'cancelled';
