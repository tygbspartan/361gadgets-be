import { Request, Response, NextFunction } from "express";
import prisma from "../config/database.config";
import { ResponseUtil } from "../utils/response.util";
import { BadRequestError } from "../utils/customError.util";
import { EmailService } from "../services/email.service";
import { JwtPayload } from "../types/auth.types";
import { config } from "../config/env.config";

const VALID_TYPES = ["brand", "category"] as const;
type RequestType = (typeof VALID_TYPES)[number];

// Simple notification email for a vendor's catalog request.
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
    ["Requested by", `${input.vendorLabel} (${input.vendorEmail}, vendor #${input.vendorId})`],
    ["Type", input.type],
    ["Requested name", input.name],
  ];
  if (input.type === "category" && input.parentName) {
    rows.push(["Parent category", input.parentName]);
  }
  if (input.note) rows.push(["Note", input.note]);

  const rowsHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 12px;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td>
        <td style="padding:8px 12px;color:#111827;font-size:14px;font-weight:600;">${value}</td>
      </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td align="center" style="background:linear-gradient(135deg,#16a34a,#15803d);padding:32px 40px;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">361 Gadgets</h1>
          <p style="margin:6px 0 0;color:#bbf7d0;font-size:12px;letter-spacing:1px;text-transform:uppercase;">Catalog Request</p>
        </td></tr>
        <tr><td style="padding:36px 40px 28px;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:20px;">New ${input.type} requested</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.7;">
            A vendor has requested that you create a new ${input.type} in the catalog.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
            ${rowsHtml}
          </table>
          <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
            Review the request and, if approved, create the ${input.type} from the admin panel.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
