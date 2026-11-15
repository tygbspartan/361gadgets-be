/**
 * Replaces "361gadgets" with the store's real name, "361 Gadgets", in each
 * brand's Meta Title, Meta Description and Brand page copy. Only those
 * fields, only that word; everything else is left as typed.
 *
 *   npx ts-node scripts/fix-brand-store-name.ts           # dry run: lists what would change
 *   npx ts-node scripts/fix-brand-store-name.ts --apply   # write the changes
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { CacheService } from "../src/services/cache.service";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const WRONG = /\b361gadgets\b/gi;
const FIELDS = ["metaTitle", "metaDescription", "seoDescription"] as const;

async function main() {
  const brands = await prisma.brand.findMany({
    select: { id: true, name: true, metaTitle: true, metaDescription: true, seoDescription: true },
    orderBy: { name: "asc" },
  });

  let changed = 0;
  for (const b of brands) {
    const data: Partial<Record<(typeof FIELDS)[number], string>> = {};
    for (const f of FIELDS) {
      const v = b[f];
      if (v && WRONG.test(v)) data[f] = v.replace(WRONG, "361 Gadgets");
      WRONG.lastIndex = 0;
    }
    const fields = Object.keys(data);
    if (!fields.length) continue;
    changed++;
    console.log(`${APPLY ? "update" : "would update"} ${b.name}: ${fields.join(", ")}`);
    if (APPLY) await prisma.brand.update({ where: { id: b.id }, data });
  }

  if (!APPLY) {
    console.log(`\n${changed} brand${changed === 1 ? "" : "s"} would change. Re-run with --apply to write.`);
    return;
  }
  console.log(`\nUpdated ${changed} brand${changed === 1 ? "" : "s"}.`);
  await CacheService.invalidatePattern("brands:*");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
