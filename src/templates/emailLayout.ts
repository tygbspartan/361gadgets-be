import { config } from "../config/env.config";

/*
 * Shared building blocks for every transactional email, styled after the
 * storefront: white page, near-black chrome header, monochrome type, and the
 * deep crimson accent used sparingly (the full stop after each title, as in
 * the site's hero).
 *
 * Email clients ignore <style> blocks and most modern CSS, so everything is
 * table layout with inline styles. The wordmark is text rather than the logo
 * image because images are often blocked by default and a localhost URL in
 * dev wouldn't load anyway.
 *
 * Anything that came from a user (names, addresses, notes, product names) must
 * go through esc() before it is interpolated.
 */

export const EMAIL_COLORS = {
  ink: "#111111",
  body: "#555555",
  muted: "#8a8a8a",
  border: "#e5e5e5",
  page: "#f4f4f4",
  panel: "#fafafa",
  chrome: "#0f0f0f",
  accent: "#a4133c",
} as const;

const C = EMAIL_COLORS;
const HEADING_FONT = "Montserrat,'Helvetica Neue',Helvetica,Arial,sans-serif";
const BODY_FONT = "Inter,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif";

const STORE_PHONE = { label: "+977 976-8988420", tel: "+9779768988420" };

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatRs(amount: number): string {
  return `Rs ${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

// Small uppercase label above a title or a value, like the site's eyebrows.
export function eyebrow(text: string, marginBottom = 8): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-family:${BODY_FONT};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${text}</p>`;
}

export function paragraph(html: string, marginBottom = 16): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-family:${BODY_FONT};font-size:15px;line-height:1.65;color:${C.body};">${html}</p>`;
}

export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;">
  <tr>
    <td bgcolor="${C.ink}" style="background:${C.ink};border-radius:3px;">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;font-family:${BODY_FONT};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${label} &rarr;</a>
    </td>
  </tr>
</table>`;
}

// Hairline-ruled row of label/value pairs (order number, date, payment...).
export function metaRow(cells: Array<[label: string, valueHtml: string]>): string {
  // The first cell (usually the order number) gets the extra width.
  const rest = Math.floor(60 / Math.max(cells.length - 1, 1));
  const tds = cells
    .map(
      ([label, value], i) => `<td width="${i ? rest : 40}%" valign="top" style="padding:16px 12px 16px 0;">
        ${eyebrow(label, 6)}
        <p style="margin:0;font-family:${HEADING_FONT};font-size:14px;font-weight:600;color:${C.ink};word-break:break-word;">${value}</p>
      </td>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.border};border-bottom:1px solid ${C.border};margin:8px 0 28px;">
  <tr>${tds}</tr>
</table>`;
}

// Two-column label/value list, for details panels.
export function detailList(rows: Array<[label: string, valueHtml: string]>): string {
  const trs = rows
    .map(
      ([label, value], i) => `<tr>
        <td valign="top" style="padding:10px 16px 10px 0;${i ? `border-top:1px solid ${C.border};` : ""}font-family:${BODY_FONT};font-size:13px;color:${C.muted};white-space:nowrap;">${label}</td>
        <td valign="top" style="padding:10px 0;${i ? `border-top:1px solid ${C.border};` : ""}font-family:${BODY_FONT};font-size:14px;color:${C.ink};word-break:break-word;">${value}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs}</table>`;
}

// A light grey box with a section label, used for addresses, notes, etc.
export function panel(label: string, innerHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
  <tr>
    <td bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.border};border-radius:4px;padding:18px 20px;">
      ${eyebrow(label, 10)}
      ${innerHtml}
    </td>
  </tr>
</table>`;
}

// Left-ruled callout in the accent colour, for things that need action.
export function callout(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
  <tr>
    <td style="border-left:3px solid ${C.accent};background:#fbf3f5;padding:14px 16px;font-family:${BODY_FONT};font-size:14px;line-height:1.6;color:${C.ink};">${html}</td>
  </tr>
</table>`;
}

export function sectionTitle(text: string): string {
  return `<p style="margin:0 0 12px;font-family:${HEADING_FONT};font-size:15px;font-weight:700;color:${C.ink};">${text}</p>`;
}

interface LayoutOptions {
  // Hidden inbox preview text.
  preheader: string;
  eyebrow: string;
  // Plain text; the accent full stop is added here.
  title: string;
  body: string;
  // Small print under the body, above the store footer.
  footnote?: string;
}

export function emailLayout(opts: LayoutOptions): string {
  const year = new Date().getFullYear();
  const shopUrl = esc(config.clientUrl);
  const contactEmail = esc(config.adminNotificationEmail);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${C.border};">

          <tr>
            <td align="center" bgcolor="${C.chrome}" style="background:${C.chrome};background-image:linear-gradient(to right,${C.chrome},#333333,${C.chrome});padding:28px 32px;">
              <a href="${shopUrl}" style="text-decoration:none;">
                <span style="font-family:${HEADING_FONT};font-size:22px;font-weight:800;letter-spacing:4px;color:#ffffff;">361&nbsp;GADGETS</span>
              </a>
              <p style="margin:8px 0 0;font-family:${BODY_FONT};font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#9a9a9a;">Premium tech. Zero compromise.</p>
            </td>
          </tr>

          <tr>
            <td style="padding:40px 40px 32px;">
              ${eyebrow(esc(opts.eyebrow), 10)}
              <h1 style="margin:0 0 18px;font-family:${HEADING_FONT};font-size:26px;line-height:1.2;font-weight:700;letter-spacing:-0.3px;color:${C.ink};">${esc(opts.title)}<span style="color:${C.accent};">.</span></h1>
              ${opts.body}
              ${opts.footnote ? `<p style="margin:28px 0 0;font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:${C.muted};">${opts.footnote}</p>` : ""}
            </td>
          </tr>

          <tr>
            <td bgcolor="${C.panel}" style="background:${C.panel};border-top:1px solid ${C.border};padding:24px 40px;">
              <p style="margin:0 0 6px;font-family:${BODY_FONT};font-size:12px;line-height:1.6;color:${C.body};">
                Need help? <a href="mailto:${contactEmail}" style="color:${C.ink};text-decoration:underline;">${contactEmail}</a>
                &nbsp;&middot;&nbsp;<a href="tel:${STORE_PHONE.tel}" style="color:${C.ink};text-decoration:underline;white-space:nowrap;">${STORE_PHONE.label}</a>
              </p>
              <p style="margin:0;font-family:${BODY_FONT};font-size:11px;color:${C.muted};">Kalopul, Kathmandu &middot; &copy; ${year} 361 Gadgets</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
