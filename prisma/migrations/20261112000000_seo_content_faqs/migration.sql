-- Optional SEO copy + FAQ for category pages, and FAQ for product pages.
ALTER TABLE "categories" ADD COLUMN "seo_content" TEXT;
ALTER TABLE "categories" ADD COLUMN "faqs" JSONB;
ALTER TABLE "products" ADD COLUMN "faqs" JSONB;
