/**
 * Creates the storefront's category tree from scripts/data/categories.json
 * (5 main categories, their subcategories and product groups).
 *
 * Only MISSING categories are created, matched by slug. Existing categories
 * are never changed, so it is safe to run on a database that already has some.
 * Everything is written in one transaction: either all missing categories are
 * created or none are.
 *
 *   npx ts-node scripts/seed-categories.ts           # dry run (report only)
 *   npx ts-node scripts/seed-categories.ts --apply   # create the missing ones
 *
 * Then fill their buying guides / FAQs:
 *   npx ts-node scripts/seed-category-seo.ts --apply
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { CacheService } from "../src/services/cache.service";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface Entry {
  slug: string;
  name: string;
  parent: string | null;
  level: 1 | 2 | 3;
  displayOrder: number;
  isActive: boolean;
  description: string | null;
}

function loadEntries(): Entry[] {
  const file = path.join(__dirname, "data", "categories.json");
  const entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];
  const bySlug = new Map<string, Entry>();
  for (const e of entries) {
    if (!e.slug || !e.name || ![1, 2, 3].includes(e.level)) throw new Error(`Invalid entry: ${JSON.stringify(e)}`);
    if (bySlug.has(e.slug)) throw new Error(`Duplicate slug in data: ${e.slug}`);
    bySlug.set(e.slug, e);
  }
  for (const e of entries) {
    if (e.level === 1 ? e.parent !== null : bySlug.get(e.parent ?? "")?.level !== e.level - 1) {
      throw new Error(`Bad parent for ${e.slug}: ${e.parent}`);
    }
  }
  // Parents before children.
  return [...entries].sort((a, b) => a.level - b.level);
}

async function main() {
  const entries = loadEntries();
  const existing = await prisma.category.findMany({ select: { id: true, slug: true, level: true } });
  const idBySlug = new Map(existing.map((c) => [c.slug, c.id]));

  // A category that already exists at a different level would get the new
  // children attached in the wrong place. Refuse rather than build a broken tree.
  const levelBySlug = new Map(existing.map((c) => [c.slug, c.level]));
  const conflicts = entries.filter((e) => levelBySlug.has(e.slug) && levelBySlug.get(e.slug) !== e.level);
  if (conflicts.length) {
    console.log(
      `These slugs already exist at a different level: ${conflicts
        .map((e) => `${e.slug} (is ${levelBySlug.get(e.slug)}, data says ${e.level})`)
        .join(", ")}`
    );
    if (APPLY) throw new Error("Level conflicts: fix or rename those categories first. Nothing was written.");
  }

  const missing = entries.filter((e) => !idBySlug.has(e.slug));
  const present = entries.length - missing.length;
  console.log(`${entries.length} categories in the data; ${present} already exist; ${missing.length} to create.`);
  for (const level of [1, 2, 3]) {
    const names = missing.filter((e) => e.level === level).map((e) => e.name);
    if (names.length) console.log(`  level ${level} (${names.length}): ${names.join(", ")}`);
  }

  if (!missing.length) return;
  if (!APPLY) {
    console.log("\nDry run: nothing written. Re-run with --apply to create them.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const e of missing) {
      const parentId = e.parent ? idBySlug.get(e.parent) : null;
      if (e.parent && !parentId) throw new Error(`Parent ${e.parent} of ${e.slug} not found`);
      const created = await tx.category.create({
        data: {
          slug: e.slug,
          name: e.name,
          description: e.description,
          level: e.level,
          parentId: parentId ?? null,
          displayOrder: e.displayOrder,
          isActive: e.isActive,
        },
        select: { id: true },
      });
      idBySlug.set(e.slug, created.id);
    }
  }, { timeout: 60_000 });
  console.log(`\nCreated ${missing.length} categories.`);
  await CacheService.invalidatePattern("categories:*");
  console.log("Invalidated categories:* cache.");
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
