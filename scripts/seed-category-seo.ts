/**
 * Fills each category's SEO copy from scripts/data/category-seo/*.json:
 *   seoDescription  short intro above the products (also the Google description)
 *   seoContent      buying guide under the products ("## " headings, "- " bullets)
 *   faqs            [{ question, answer }]
 *
 * Only EMPTY fields are filled, so anything written in the admin is kept.
 * --force overwrites them all with the file's text.
 *
 *   npx ts-node scripts/seed-category-seo.ts                 # dry run (report only)
 *   npx ts-node scripts/seed-category-seo.ts --apply         # fill empty fields
 *   npx ts-node scripts/seed-category-seo.ts --apply --force # overwrite everything
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { CacheService } from "../src/services/cache.service";
import { faqsSchema } from "../src/validators/schemas";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

interface Entry {
  slug: string;
  seoDescription: string;
  seoContent: string;
  faqs: { question: string; answer: string }[];
}

const DATA_DIR = path.join(__dirname, "data", "category-seo");

function loadEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith(".json")).sort()) {
    const list = JSON.parse(readFileSync(path.join(DATA_DIR, file), "utf8")) as Entry[];
    for (const e of list) {
      const faqs = faqsSchema.safeParse(e.faqs);
      if (!e.slug || !e.seoDescription || !e.seoContent || !faqs.success) {
        throw new Error(`${file}: invalid entry ${e.slug ?? "(no slug)"}`);
      }
      entries.push(e);
    }
  }
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.slug)) throw new Error(`Duplicate slug in data: ${e.slug}`);
    seen.add(e.slug);
  }
  return entries;
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

async function main() {
  const entries = loadEntries();
  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, seoDescription: true, seoContent: true, faqs: true },
  });
  const bySlug = new Map(categories.map((c) => [c.slug, c]));

  let updated = 0;
  const missing = entries.filter((e) => !bySlug.has(e.slug)).map((e) => e.slug);
  const uncovered = categories.filter((c) => !entries.some((e) => e.slug === c.slug)).map((c) => c.slug);

  for (const e of entries) {
    const c = bySlug.get(e.slug);
    if (!c) continue;
    const data: Prisma.CategoryUpdateInput = {};
    if (FORCE || isEmpty(c.seoDescription)) data.seoDescription = e.seoDescription.trim();
    if (FORCE || isEmpty(c.seoContent)) data.seoContent = e.seoContent.trim();
    if (FORCE || isEmpty(c.faqs)) data.faqs = e.faqs;
    const fields = Object.keys(data);
    if (!fields.length) continue;
    console.log(`${APPLY ? "update" : "would update"} ${e.slug}: ${fields.join(", ")}`);
    if (APPLY) await prisma.category.update({ where: { id: c.id }, data });
    updated++;
  }

  if (missing.length) console.log(`\nIn the data but not in the database (skipped): ${missing.join(", ")}`);
  if (uncovered.length) console.log(`\nCategories with no entry in the data: ${uncovered.join(", ")}`);

  if (!APPLY) {
    console.log(`\n${updated} categor${updated === 1 ? "y" : "ies"} would change. Re-run with --apply to write.`);
    return;
  }
  console.log(`\nUpdated ${updated} categor${updated === 1 ? "y" : "ies"}.`);
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
