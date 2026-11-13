import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { BadRequestError } from "../utils/customError.util";
import { EmailService } from "../services/email.service";
import { JwtPayload } from "../types/auth.types";
import { config } from "../config/env.config";
import {
  button,
  detailList,
  emailLayout,
  esc,
  panel,
  paragraph,
} from "../templates/emailLayout";

const VALID_TYPES = ["brand", "category"] as const;
type RequestType = (typeof VALID_TYPES)[number];

// Notification email to the platform admin for a vendor's catalog request.
// Every value here is vendor-supplied, so it's escaped before interpolation.
function generateCatalogRequestEmail(input: {
  vendorLabel: string;
  vendorEmail: string;
  vendorId: number;
  type: RequestType;
  name: string;
  parentName?: string;
  note?: string;
}): string {
  const rows: [string, string][] = [
    ["Type", input.type === "brand" ? "Brand" : "Category"],
    ["Requested name", `<strong>${esc(input.name)}</strong>`],
  ];
  if (input.type === "category" && input.parentName) {
    rows.push(["Parent category", esc(input.parentName)]);
  }
  rows.push([
    "Requested by",
    `${esc(input.vendorLabel)}<br /><a href="mailto:${esc(input.vendorEmail)}" style="color:#111111;">${esc(input.vendorEmail)}</a> &middot; vendor #${input.vendorId}`,
  ]);

  const adminPath = input.type === "brand" ? "brands" : "categories";

  return emailLayout({
    preheader: `${input.vendorLabel} requested a new ${input.type}: ${input.name}.`,
    eyebrow: "Catalog request",
    title: `New ${input.type} requested`,
    body: `
      ${paragraph(`A vendor has asked you to add a ${input.type} to the catalog.`, 20)}
      ${panel("Request", detailList(rows))}
      ${input.note ? panel("Vendor note", paragraph(esc(input.note), 0)) : ""}
      ${button(`Open ${adminPath}`, `${config.clientUrl}/admin/${adminPath}`)}
    `,
    footnote: "If you approve it, create the entry from the admin panel. The vendor isn&rsquo;t notified automatically.",
  });
}

export class CatalogRequestController {
  // Vendor requests the creation of a new brand or category.
  // Sends a notification email to the platform admin. Not persisted.
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const jwtPayload = (req as any).jwtPayload as JwtPayload;
      const { type, name, note, parentName } = req.body as {
        type?: string;
        name?: string;
        note?: string;
        parentName?: string;
      };

      if (!type || !VALID_TYPES.includes(type as RequestType)) {
        throw new BadRequestError('type is required and must be "brand" or "category"');
      }
      if (!name || !name.trim()) {
        throw new BadRequestError("name is required");
      }

      const vendor = await prisma.user.findUnique({
        where: { id: jwtPayload.userId },
        select: {
          id: true,
          email: true,
          companyName: true,
          firstName: true,
          lastName: true,
        },
      });

      const vendorLabel =
        vendor?.companyName ||
        [vendor?.firstName, vendor?.lastName].filter(Boolean).join(" ") ||
        vendor?.email ||
        `Vendor #${jwtPayload.userId}`;

      // Send to the platform admin's inbox.
      const adminEmail = config.adminNotificationEmail;

      const html = generateCatalogRequestEmail({
        vendorLabel,
        vendorEmail: vendor?.email || jwtPayload.email,
        vendorId: jwtPayload.userId,
        type: type as RequestType,
        name: name.trim(),
        parentName: parentName?.trim() || undefined,
        note: note?.trim() || undefined,
      });

      await EmailService.sendEmail({
        to: adminEmail,
        subject: `Catalog request: new ${type} "${name.trim()}"`,
        html,
      });

      return ResponseUtil.success(
        res,
        { type, name: name.trim() },
        "Your request has been sent to the platform admin.",
        201,
      );
    } catch (error) {
      next(error);
    }
  }
}
