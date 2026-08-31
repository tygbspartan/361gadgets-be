/**
 * One-off cleanup for legacy brand↔product ownership.
 *
 * The old product-create code auto-claimed brands for whichever vendor first
 * used them. Under the new rules a vendor's product must sit under a brand that
 * vendor OWNS. This script finds vendor-owned products whose brand is owned by
 * someone else / unassigned / missing, and (with --apply) releases them the same
 * way a brand transfer does: isActive=false, ownerId=null — NEVER deleted, so
 * order/cart/wishlist foreign keys stay intact. Superadmin can still edit them.
 *
 *   npx ts-node scripts/cleanup-brand-ownership.ts           # dry run (report only)
 *   npx ts-node scripts/cleanup-brand-ownership.ts --apply   # apply the changes
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  // Products owned by a vendor (role "admin"). Superadmin-owned products are
  // exempt — the superadmin may use any brand.
  const products = await prisma.product.findMany({
    where: { owner: { role: "admin" } },
    select: {
      id: true,
      name: true,
      isActive: true,
      ownerId: true,
      brandId: true,
      owner: { select: { companyName: true, email: true } },
      brand: { select: { name: true, ownerId: true } },
    },
    orderBy: { id: "asc" },
  });

  const violations = products.filter(
    (p) => !p.brandId || p.brand?.ownerId !== p.ownerId,
  );

  console.log(
    `\nScanned ${products.length} vendor-owned product(s). Found ${violations.length} inconsistent with the new rules.\n`,
  );

  if (violations.length === 0) {
    console.log("Nothing to clean up. ✅");
    return;
  }

  for (const p of violations) {
    const reason = !p.brandId
      ? "no brand"
      : p.brand?.ownerId == null
        ? "brand is unassigned"
        : "brand owned by another vendor";
    console.log(
      `  #${p.id} "${p.name}" — owner=${p.owner?.companyName || p.owner?.email} — ${reason} — currently ${p.isActive ? "ACTIVE" : "inactive"}`,
    );
  }

  console.log(
    `\nWould set these ${violations.length} product(s) to: isActive=false, ownerId=null (brandId kept).`,
  );

  if (!APPLY) {
    console.log("\nDRY RUN — no changes made. Re-run with --apply to apply.\n");
    return;
  }

  const ids = violations.map((p) => p.id);
  const result = await prisma.product.updateMany({
    where: { id: { in: ids } },
    data: { isActive: false, ownerId: null },
  });
  console.log(`\nApplied. Updated ${result.count} product(s). ✅\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
