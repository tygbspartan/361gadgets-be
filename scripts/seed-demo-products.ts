/**
 * DEMO products for showing the store. Not real stock: every product it makes
 * has a SKU starting "DEMO-", so `--remove` can delete exactly these later.
 *
 * Reads scripts/data/demo-products.json:
 *   vendors   vendor email -> brand slugs that vendor owns (brand.ownerId is set)
 *   products  [categorySlug, brandSlug, name, price, originalPrice|null,
 *              "Key: Value; Key: Value", featured?, homepageFeature?]
 *
 * The vendor accounts must already exist (role "admin", i.e. vendor). Create
 * them in Admin -> Vendors first; this script never stores or sets passwords.
 * Each product gets two generated photos (device drawing on light, then on
 * dark, so the card hover swap shows), saved under UPLOAD_DIR/products/demo/.
 *
 *   npx ts-node scripts/seed-demo-products.ts            # dry run: what would happen
 *   npx ts-node scripts/seed-demo-products.ts --apply    # create them
 *   npx ts-node scripts/seed-demo-products.ts --remove   # dry run of the removal
 *   npx ts-node scripts/seed-demo-products.ts --remove --apply
 */
import "dotenv/config";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { config } from "../src/config/env.config";
import { CacheService } from "../src/services/cache.service";
import { SlugUtil } from "../src/utils/slug.util";
import { ROLES } from "../src/constants/roles.constants";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const REMOVE = process.argv.includes("--remove");
const SKU_PREFIX = "DEMO-";
const IMAGE_DIR = path.join(path.resolve(config.uploadDir), "products", "demo");
const IMAGE_URL = `${config.publicBaseUrl}/uploads/products/demo`;

type Row = [string, string, string, number, number | null, string, number?, number?];
interface DemoData {
  vendors: Record<string, string[]>;
  products: Row[];
}

// ── Generated product photos (shapes only, no text, so no fonts needed) ──────
export type Kind =
  | "phone" | "tablet" | "laptop" | "earbuds" | "headphones" | "speaker" | "soundbar"
  | "watch" | "band" | "ring" | "charger" | "cable" | "powerbank" | "pad" | "case"
  | "glass" | "holder" | "keyboard" | "mouse" | "monitor" | "webcam" | "bag" | "hub"
  | "drive" | "card" | "router" | "console" | "controller" | "mousepad";

const KIND: Record<string, Kind> = {
  "android-phones": "phone", iphones: "phone", "android-tablets": "tablet", ipads: "tablet",
  "phone-chargers": "charger", "charging-cables": "cable", "power-banks": "powerbank",
  "wireless-chargers": "pad", "car-chargers": "charger", "phone-cases": "case",
  "tempered-glass": "glass", "car-phone-holders": "holder", "phone-stands": "holder",
  "selfie-sticks": "holder", "wireless-earbuds": "earbuds", "neckband-earphones": "earbuds",
  "wired-earphones": "earbuds", "wireless-headphones": "headphones", "wired-headphones": "headphones",
  "bluetooth-speakers": "speaker", soundbars: "soundbar", "calling-smart-watches": "watch",
  "kids-smart-watches": "watch", "apple-watch": "watch", "fitness-bands": "band", "smart-rings": "ring",
  "gaming-laptops": "laptop", macbooks: "laptop", "student-office-laptops": "laptop",
  monitors: "monitor", keyboards: "keyboard", mouse: "mouse", webcams: "webcam", "laptop-bags": "bag",
  "usb-hubs": "hub", "pen-drives": "drive", "memory-cards": "card", "external-hard-drives": "drive",
  "external-ssds": "drive", "wifi-routers": "router", "wifi-extenders": "router",
  playstation: "console", xbox: "console", "nintendo-switch": "console",
  "gaming-mouse": "mouse", "gaming-keyboards": "keyboard", "gaming-headsets": "headphones",
  "game-controllers": "controller", "mouse-pads": "mousepad",
};

export function shape(kind: Kind, d: string, a: string, bg: string): string {
  const r = (x: number, y: number, w: number, h: number, rx = 0, f = d) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}"/>`;
  const c = (x: number, y: number, rad: number, f = d) => `<circle cx="${x}" cy="${y}" r="${rad}" fill="${f}"/>`;
  switch (kind) {
    case "phone": return r(290, 140, 220, 440, 36) + r(306, 160, 188, 400, 24, a) + c(400, 182, 7, d);
    case "tablet": return r(200, 170, 400, 460, 30) + r(220, 190, 360, 420, 16, a);
    case "laptop": return r(200, 220, 400, 260, 18) + r(218, 238, 364, 224, 8, a) + r(150, 480, 500, 34, 12);
    case "monitor": return r(170, 180, 460, 290, 16) + r(186, 196, 428, 258, 6, a) + r(380, 470, 40, 90) + r(300, 556, 200, 22, 10);
    case "earbuds": return r(260, 300, 280, 200, 90) + r(278, 318, 244, 164, 74, a) + c(345, 400, 40) + c(455, 400, 40);
    case "headphones": return `<path d="M250 450 V380 A150 150 0 0 1 550 380 V450" fill="none" stroke="${d}" stroke-width="34" stroke-linecap="round"/>` + r(212, 420, 90, 150, 40) + r(498, 420, 90, 150, 40) + r(232, 450, 50, 90, 22, a) + r(518, 450, 50, 90, 22, a);
    case "speaker": return r(240, 260, 320, 280, 140) + c(330, 400, 70, a) + c(470, 400, 70, a) + c(330, 400, 30) + c(470, 400, 30);
    case "soundbar": return r(130, 360, 540, 90, 45) + [190, 260, 330, 400, 470, 540, 610].map((x) => c(x, 405, 14, a)).join("");
    case "watch": return r(345, 160, 110, 480, 30) + r(300, 270, 200, 260, 56) + r(318, 288, 164, 224, 42, a);
    case "band": return r(370, 150, 60, 500, 30) + r(335, 290, 130, 220, 50) + r(350, 305, 100, 190, 40, a);
    case "ring": return `<circle cx="400" cy="400" r="140" fill="none" stroke="${d}" stroke-width="60"/><circle cx="400" cy="400" r="140" fill="none" stroke="${a}" stroke-width="14"/>`;
    case "charger": return r(300, 260, 200, 230, 30) + r(340, 200, 22, 70, 6) + r(438, 200, 22, 70, 6) + r(370, 400, 60, 22, 8, a);
    case "cable": return `<path d="M260 560 C260 300 540 500 540 240" fill="none" stroke="${d}" stroke-width="26" stroke-linecap="round"/>` + r(225, 540, 70, 90, 14, a) + r(505, 170, 70, 90, 14, a);
    case "powerbank": return r(290, 170, 220, 460, 36) + r(370, 210, 60, 10, 5, a) + [300, 340, 380, 420].map((y) => r(330, y + 200, 140, 18, 9, a)).join("");
    case "pad": return c(400, 410, 190) + c(400, 410, 160, a) + c(400, 410, 50);
    case "case": return r(285, 140, 230, 460, 46) + r(305, 160, 190, 420, 34, bg) + r(320, 180, 70, 90, 20, a);
    case "glass": return r(290, 150, 220, 450, 34, a) + r(300, 160, 200, 430, 28) + `<path d="M330 260 L450 180 M330 360 L470 250" stroke="${a}" stroke-width="10" stroke-linecap="round"/>`;
    case "holder": return r(300, 170, 200, 330, 28) + r(316, 186, 168, 298, 18, a) + r(385, 500, 30, 90) + r(310, 580, 180, 26, 13);
    case "keyboard": return r(140, 300, 520, 220, 22) + Array.from({ length: 4 }, (_, row) => Array.from({ length: 10 }, (_, col) => r(165 + col * 48, 322 + row * 46, 38, 34, 6, a)).join("")).join("");
    case "mouse": return r(300, 210, 200, 330, 100) + r(392, 250, 16, 70, 8, a);
    case "webcam": return r(260, 260, 280, 200, 100) + c(400, 360, 72, a) + c(400, 360, 34) + r(370, 460, 60, 120) + r(300, 570, 200, 24, 12);
    case "bag": return `<path d="M330 270 V230 A70 70 0 0 1 470 230 V270" fill="none" stroke="${d}" stroke-width="24"/>` + r(240, 260, 320, 360, 50) + r(290, 420, 220, 140, 24, a);
    case "hub": return r(220, 330, 360, 140, 36) + [270, 340, 410, 480].map((x) => r(x, 380, 46, 26, 6, a)).join("") + r(560, 385, 120, 30, 15);
    case "drive": return r(330, 220, 140, 340, 24) + r(355, 160, 90, 80, 10, a) + r(370, 300, 60, 160, 12, a);
    case "card": return `<path d="M310 180 H470 L510 220 V610 H310 Z" fill="${d}"/>` + [340, 380, 420, 460].map((x) => r(x, 200, 22, 60, 4, a)).join("");
    case "router": return r(200, 400, 400, 130, 30) + r(250, 220, 22, 190, 11) + r(528, 220, 22, 190, 11) + [280, 340, 400, 460, 520].map((x) => c(x, 465, 10, a)).join("");
    case "console": return r(290, 150, 220, 480, 60) + r(330, 190, 140, 400, 40, a) + r(385, 330, 30, 120, 15);
    case "controller": return `<path d="M230 340 Q240 280 320 280 H480 Q560 280 570 340 L600 500 Q605 560 550 545 L480 470 H320 L250 545 Q195 560 200 500 Z" fill="${d}"/>` + c(320, 360, 30, a) + c(480, 360, 30, a) + c(360, 430, 22, a) + c(440, 430, 22, a);
    case "mousepad": return r(150, 260, 500, 300, 30) + r(170, 280, 460, 260, 22, a) + r(450, 340, 110, 160, 55);
  }
}

async function makeImages(kind: Kind, slug: string): Promise<string[]> {
  const variants = [
    { bg: "#ececec", d: "#111111", a: "#8b0000" },
    { bg: "#141414", d: "#e5e5e5", a: "#8b0000" },
  ];
  const urls: string[] = [];
  for (const [i, v] of variants.entries()) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="${v.bg}"/>${shape(kind, v.d, v.a, v.bg)}</svg>`;
    const file = `${slug}-${i + 1}.png`;
    await sharp(Buffer.from(svg)).png().toFile(path.join(IMAGE_DIR, file));
    urls.push(`${IMAGE_URL}/${file}`);
  }
  return urls;
}

// ── Seed ─────────────────────────────────────────────────────────────────────
function parseSpecs(text: string) {
  return text.split(";").map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf(":");
    return { key: p.slice(0, i).trim(), value: p.slice(i + 1).trim() };
  });
}

async function seed() {
  const data = JSON.parse(readFileSync(path.join(__dirname, "data", "demo-products.json"), "utf8")) as DemoData;

  // Vendors
  const vendorIdByBrand = new Map<string, number>();
  for (const [email, brandSlugs] of Object.entries(data.vendors)) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
    if (!user) throw new Error(`Vendor ${email} not found. Create it in Admin -> Vendors first.`);
    if (user.role !== ROLES.ADMIN) throw new Error(`${email} has role "${user.role}", expected a vendor ("admin").`);
    for (const b of brandSlugs) vendorIdByBrand.set(b, user.id);
  }

  // Brands (by slug, then by name, e.g. Samsung whose slug may still be "test")
  const brands = await prisma.brand.findMany({ select: { id: true, slug: true, name: true, ownerId: true } });
  const brandFor = (key: string) =>
    brands.find((b) => b.slug === key) ?? brands.find((b) => SlugUtil.generateSlug(b.name) === key);

  console.log("Brand ownership:");
  for (const [key, vendorId] of vendorIdByBrand) {
    const b = brandFor(key);
    if (!b) { console.log(`  ${key}: brand not found, its products are skipped`); continue; }
    if (b.ownerId && b.ownerId !== vendorId) {
      console.log(`  ${b.name}: owned by another vendor (user ${b.ownerId}); left as is, its products are skipped`);
      continue;
    }
    console.log(`  ${b.name} -> vendor ${vendorId}${b.ownerId === vendorId ? " (already)" : ""}`);
    if (APPLY && b.ownerId !== vendorId) await prisma.brand.update({ where: { id: b.id }, data: { ownerId: vendorId } });
  }

  const categories = await prisma.category.findMany({ select: { id: true, slug: true, level: true } });
  const existing = await prisma.product.findMany({ select: { slug: true, sku: true } });
  const takenSlugs = existing.map((p) => p.slug);
  const takenSkus = new Set(existing.map((p) => p.sku));

  if (APPLY) mkdirSync(IMAGE_DIR, { recursive: true });

  let created = 0;
  const skipped: string[] = [];
  for (const [i, row] of data.products.entries()) {
    const [catSlug, brandKey, name, price, originalPrice, specs, featured, homepage] = row;
    const sku = `${SKU_PREFIX}${String(i + 1).padStart(3, "0")}`;
    if (takenSkus.has(sku)) { skipped.push(`${name} (already seeded)`); continue; }
    const cat = categories.find((c) => c.slug === catSlug && c.level === 3);
    const brand = brandFor(brandKey);
    const ownerId = vendorIdByBrand.get(brandKey);
    if (!cat || !brand || !ownerId || (brand.ownerId && brand.ownerId !== ownerId)) {
      skipped.push(`${name} (${!cat ? `no category ${catSlug}` : !brand ? `no brand ${brandKey}` : "brand owned by someone else"})`);
      continue;
    }
    const slug = SlugUtil.makeUniqueSlug(SlugUtil.generateSlug(name), takenSlugs);
    takenSlugs.push(slug);
    created++;
    if (!APPLY) continue;

    const urls = await makeImages(KIND[catSlug] ?? "phone", slug);
    await prisma.product.create({
      data: {
        name,
        slug,
        sku,
        ownerId,
        brandId: brand.id,
        categoryId: cat.id,
        price,
        originalPrice: originalPrice ?? undefined,
        stockQuantity: 10 + ((i * 7) % 40),
        longDescription: `${name}, genuine and brand new, available in Nepal at 361 Gadgets with cash on delivery and delivery to every district.`,
        isActive: true,
        isFeatured: Boolean(featured),
        homepageFeature: Boolean(homepage),
        images: {
          create: urls.map((imageUrl, n) => ({ imageUrl, altText: name, isPrimary: n === 0, displayOrder: n })),
        },
        specifications: { create: parseSpecs(specs) },
      },
    });
  }

  if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);
  console.log(`\n${APPLY ? "Created" : "Would create"} ${created} demo products.${APPLY ? "" : " Re-run with --apply to create them."}`);
  if (APPLY) await CacheService.invalidatePattern("products:*");
}

async function remove() {
  const demo = await prisma.product.findMany({
    where: { sku: { startsWith: SKU_PREFIX } },
    select: { id: true, name: true, _count: { select: { orderItems: true } } },
  });
  // Products that appear in an order can't be deleted without breaking that
  // order's history, so those are hidden (deactivated) instead.
  const ordered = demo.filter((p) => p._count.orderItems > 0);
  const deletable = demo.filter((p) => p._count.orderItems === 0);
  console.log(`${demo.length} demo products: ${deletable.length} to delete, ${ordered.length} in orders (to deactivate instead).`);
  if (!APPLY) {
    console.log("Dry run. Re-run with --remove --apply to do it.");
    return;
  }
  await prisma.product.deleteMany({ where: { id: { in: deletable.map((p) => p.id) } } });
  if (ordered.length) {
    await prisma.product.updateMany({ where: { id: { in: ordered.map((p) => p.id) } }, data: { isActive: false } });
  }
  if (!ordered.length) rmSync(IMAGE_DIR, { recursive: true, force: true });
  await CacheService.invalidatePattern("products:*");
  console.log(`Deleted ${deletable.length}, deactivated ${ordered.length}.${ordered.length ? " Images kept (deactivated products still use them)." : " Images removed."}`);
}

if (require.main === module) (REMOVE ? remove() : seed())
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
