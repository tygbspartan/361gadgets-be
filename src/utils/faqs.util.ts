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
