import { Prisma } from "@prisma/client";
import { faqsSchema } from "../validators/schemas";
import { BadRequestError } from "./customError.util";

export type Faq = { question: string; answer: string };

/**
 * FAQ list -> value for a Prisma Json? column.
 *   undefined          -> undefined (leave unchanged)
 *   null / [] / blanks -> DbNull (clear it)
 *   list               -> the cleaned list
 * Accepts raw request input too (validated here), for routes without a body schema.
 */
export function faqsForDb(input: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (input === undefined) return undefined;
  if (input === null) return Prisma.DbNull;
  const parsed = faqsSchema.safeParse(input);
  if (!parsed.success) {
    throw new BadRequestError(parsed.error.issues[0]?.message ?? "Invalid FAQs");
  }
  return parsed.data.length ? parsed.data : Prisma.DbNull;
}

/**
 * Drops the long SEO fields from a category (and its parent / children) in
 * list and tree responses, which never show them.
 */
export function withoutLongCategoryFields<T extends Record<string, any>>(category: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { seoContent, faqs, ...rest } = category as Record<string, any>;
  if (rest.parent && typeof rest.parent === "object") rest.parent = withoutLongCategoryFields(rest.parent);
  if (Array.isArray(rest.children)) rest.children = rest.children.map(withoutLongCategoryFields);
  return rest as T;
}

/**
 * Optional long text from a request body -> DB value.
 *   undefined -> undefined (leave unchanged); null / blank -> null; else trimmed.
 */
export function optionalTextForDb(input: unknown, label: string, max = 20000): string | null | undefined {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "string") throw new BadRequestError(`${label} must be text`);
  const value = input.trim();
  if (value.length > max) throw new BadRequestError(`${label} must be at most ${max} characters`);
  return value || null;
}

/** Drops a brand's long SEO fields from list responses, which never show them. */
export function withoutLongBrandFields<T extends Record<string, any>>(brand: T): T {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { seoContent, faqs, ...rest } = brand as Record<string, any>;
  return rest as T;
}
