/**
 * Fills each brand's buying guide and FAQ from scripts/data/brand-seo.json:
 *   seoContent  "Buy <Brand> in Nepal" guide under the products ("## " headings, "- " bullets)
 *   faqs        [{ question, answer }]
 *
 * Brands are matched by slug, then by name (so a brand whose slug was never
 * set properly, e.g. "test", is still found). Only EMPTY fields are filled,
 * so anything written in the admin is kept. --force overwrites them.
 *
 *   npx ts-node scripts/seed-brand-seo.ts                 # dry run (report only)
 *   npx ts-node scripts/seed-brand-seo.ts --apply         # fill empty fields
 *   npx ts-node scripts/seed-brand-seo.ts --apply --force # overwrite everything
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { CacheService } from "../src/services/cache.service";
import { faqsSchema } from "../src/validators/schemas";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

interface Entry {
  slug: string;
  name: string;
  seoContent: string;
  faqs: { question: string; answer: string }[];
}

function loadEntries(): Entry[] {
  const entries = JSON.parse(readFileSync(path.join(__dirname, "data", "brand-seo.json"), "utf8")) as Entry[];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.slug || !e.name || !e.seoContent || !faqsSchema.safeParse(e.faqs).success) {
      throw new Error(`Invalid entry: ${e.slug ?? e.name ?? "(unknown)"}`);
    }
    if (seen.has(e.slug)) throw new Error(`Duplicate slug in data: ${e.slug}`);
    seen.add(e.slug);
  }
  return entries;
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

async function main() {
  const entries = loadEntries();
  const brands = await prisma.brand.findMany({
    select: { id: true, slug: true, name: true, seoContent: true, faqs: true },
  });
  const bySlug = new Map(brands.map((b) => [b.slug, b]));
  const byName = new Map(brands.map((b) => [b.name.trim().toLowerCase(), b]));

  let updated = 0;
  const missing: string[] = [];
  const matched = new Set<number>();

  for (const e of entries) {
    const b = bySlug.get(e.slug) ?? byName.get(e.name.trim().toLowerCase());
    if (!b) {
      missing.push(e.name);
      continue;
    }
    matched.add(b.id);
    const data: Prisma.BrandUpdateInput = {};
    if (FORCE || isEmpty(b.seoContent)) data.seoContent = e.seoContent.trim();
    if (FORCE || isEmpty(b.faqs)) data.faqs = e.faqs;
    const fields = Object.keys(data);
    if (!fields.length) continue;
    const via = b.slug === e.slug ? "" : ` (matched by name; slug is "${b.slug}")`;
    console.log(`${APPLY ? "update" : "would update"} ${b.name}: ${fields.join(", ")}${via}`);
    if (APPLY) await prisma.brand.update({ where: { id: b.id }, data });
    updated++;
  }

  if (missing.length) console.log(`\nIn the data but not in the database (skipped): ${missing.join(", ")}`);
  const uncovered = brands.filter((b) => !matched.has(b.id)).map((b) => b.name);
  if (uncovered.length) console.log(`\nBrands with no entry in the data: ${uncovered.join(", ")}`);

  if (!APPLY) {
    console.log(`\n${updated} brand${updated === 1 ? "" : "s"} would change. Re-run with --apply to write.`);
    return;
  }
  console.log(`\nUpdated ${updated} brand${updated === 1 ? "" : "s"}.`);
  await CacheService.invalidatePattern("brands:*");
  console.log("Invalidated brands:* cache.");
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
