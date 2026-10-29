/**
 * Dev-data helper: gives every product that has NO images a pair of
 * category-appropriate stock photos from Unsplash (images.unsplash.com is
 * already whitelisted in the frontend's next.config remotePatterns).
 *
 * Products that already have at least one image are left untouched, so this is
 * safe to re-run. Products in the same category get the pool rotated so the
 * grid doesn't show the same primary photo twice in a row.
 *
 *   npx ts-node scripts/seed-product-images.ts           # dry run (report only)
 *   npx ts-node scripts/seed-product-images.ts --apply   # write the images
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { CacheService } from "../src/services/cache.service";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const IMAGES_PER_PRODUCT = 2;

const unsplash = (id: string) =>
  `https://images.unsplash.com/photo-${id}?w=1000&q=80&auto=format&fit=crop`;

// Category name -> pool of Unsplash photo ids (each checked by eye).
const POOLS: Record<string, string[]> = {
  "Android Phones": ["1610945265064-0e34e5519bbf", "1598327105666-5b89351aff97", "1600087626014-e652e18bbff2", "1601784551446-20c9e07cdbdb"],
  iPhones: ["1695048133142-1a20484d2569", "1632661674596-df8be070a5c5", "1592899677977-9c10ca588bbd", "1511707171634-5f897ff02aa9"],
  "Android Tablets": ["1561154464-82e9adf32764", "1585790050230-5dd28404ccb9", "1544244015-0df4b3ffc6b0"],
  iPads: ["1544244015-0df4b3ffc6b0", "1585790050230-5dd28404ccb9", "1561154464-82e9adf32764"],
  "Smart Watches": ["1523275335684-37898b6baf30", "1617043786394-f977fa12eddf", "1546868871-7041f2a55e12", "1508685096489-7aacd43bd3b1"],
  "TWS Earbuds": ["1606220588913-b3aacb4d2f46", "1600294037681-c80b4cb5b434", "1590658268037-6bf12165a8df", "1572569511254-d8f925fe2cbb"],
  Chargers: ["1583863788434-e58a36330cf0", "1600490722773-35753aea6332", "1615526675159-e248c3021d3f"],
  Cables: ["1600490722773-35753aea6332", "1583863788434-e58a36330cf0"],
  "Power Banks": ["1633381638729-27f730955c23", "1615526675159-e248c3021d3f", "1609091839311-d5365f9ff1c5"],
  "Phone Holders": ["1600087626014-e652e18bbff2", "1586953208448-b95a79798f07"],
  Cases: ["1601593346740-925612772716", "1606293459339-aa5d34a7b0e1"],
  "Screen Protectors": ["1544866092-1935c5ef2a8f", "1586953208448-b95a79798f07"],
  Laptops: ["1496181133206-80ce9b88a853", "1603302576837-37561b2e2302", "1593642702821-c8da6771f0c6", "1525547719571-a2d4ac8945e2", "1618424181497-157f25b6ddd5", "1629131726692-1accd0c53ce0", "1618410320928-25228d811631", "1517336714731-489689fd1ca8"],
  Monitors: ["1527443224154-c4a3942d3acf", "1585792180666-f7347c490ee2", "1619953942547-233eab5a70d6"],
  Mouse: ["1615663245857-ac93bb7c39e7", "1527864550417-7fd91fc51a46", "1586816879360-004f5b0c51e5"],
  Keyboards: ["1587829741301-dc798b83add3", "1618384887929-16ec33fab9ef", "1595225476474-87563907a212"],
  Webcams: ["1623949556303-b0d17d198863", "1619953942547-233eab5a70d6"],
  SSD: ["1597872200969-2b65d56bd16b", "1531492746076-161ca9bcad58"],
  RAM: ["1562976540-1502c2145186", "1541029071515-84cc54f84dc5"],
  "Docking Stations": ["1588508065123-287b28e013da", "1619953942547-233eab5a70d6"],
  "Laptop Bags": ["1553062407-98eeb64c6a62", "1622560480605-d83c853bc5c3"],
  "Home Speakers": ["1608043152269-423dbba4e7e1", "1589003077984-894e133dabab", "1545454675-3531b543be5d"],
  Headphones: ["1505740420928-5e560c06d30e", "1618366712010-f4ae9c647dcb", "1583394838336-acd977736f90", "1585298723682-7115561c51b7"],
  Microphones: ["1590602847861-f357a9332bbc", "1598488035139-bdbb2231ce04"],
  Drones: ["1473968512647-3e447244af8f", "1507582020474-9a35b7d455d9", "1579829366248-204fe8413f31"],
  Gimbals: ["1600087626014-e652e18bbff2", "1564466809058-bf4114d55352"],
  "Action Cameras": ["1564466809058-bf4114d55352", "1502982720700-bfff97f2ecac"],
  "Gaming Keyboard": ["1612198188060-c7c2a3b66eae", "1595225476474-87563907a212", "1587829741301-dc798b83add3"],
  "Gaming Mouse": ["1613141411244-0e4ac259d217", "1629429408209-1f912961dbd8", "1615663245857-ac93bb7c39e7"],
  "Gaming Headsets": ["1599669454699-248893623440", "1612444530582-fc66183b16f7", "1618366712010-f4ae9c647dcb"],
  Controllers: ["1592840496694-26d035b52b48", "1606318801954-d46d46d3360a", "1606144042614-b2417e99c4e3"],
  Mousepads: ["1616588589676-62b3bd4ff6d2", "1586816879360-004f5b0c51e5", "1629429408209-1f912961dbd8"],
};

// Used when a product's category isn't in POOLS (e.g. added after this script).
const FALLBACK = ["1468495244123-6c6c332eeece", "1519389950473-47ba0277781c"];

async function main() {
  const products = await prisma.product.findMany({
    where: { images: { none: {} } },
    select: { id: true, name: true, category: { select: { name: true } } },
    orderBy: { id: "asc" },
  });

  console.log(`${products.length} product(s) without images${APPLY ? "" : " (dry run)"}\n`);

  const seenPerCategory = new Map<string, number>();
  const rows: { productId: number; imageUrl: string; altText: string; isPrimary: boolean; displayOrder: number }[] = [];

  for (const p of products) {
    const cat = p.category?.name ?? "";
    const pool = POOLS[cat] ?? FALLBACK;
    const offset = seenPerCategory.get(cat) ?? 0;
    seenPerCategory.set(cat, offset + 1);

    const count = Math.min(IMAGES_PER_PRODUCT, pool.length);
    const picks = Array.from({ length: count }, (_, i) => pool[(offset + i) % pool.length]);

    console.log(`#${p.id} ${p.name} [${cat || "no category"}]${POOLS[cat] ? "" : " (fallback)"}`);
    picks.forEach((id, i) =>
      rows.push({ productId: p.id, imageUrl: unsplash(id), altText: p.name, isPrimary: i === 0, displayOrder: i }),
    );
  }

  if (!APPLY) {
    console.log(`\nWould insert ${rows.length} image row(s). Re-run with --apply to write.`);
    return;
  }

  const { count } = await prisma.productImage.createMany({ data: rows });
  console.log(`\nInserted ${count} image row(s).`);

  await CacheService.invalidatePattern("products:*");
  console.log("Invalidated products:* cache.");
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
