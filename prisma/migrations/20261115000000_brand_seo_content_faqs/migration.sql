-- Optional buying guide + FAQ for brand pages (same as categories).
ALTER TABLE "brands" ADD COLUMN "seo_content" TEXT;
ALTER TABLE "brands" ADD COLUMN "faqs" JSONB;
