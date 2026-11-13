import { config } from "../config/env.config";
import {
  EMAIL_COLORS as C,
  button,
  callout,
  detailList,
  emailLayout,
  esc,
  formatRs,
  metaRow,
  panel,
  paragraph,
  sectionTitle,
} from "./emailLayout";

export interface OrderEmailData {
  orderId: number;
  orderNumber: string;
  orderDate: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  subtotal: number;
  shippingCost: number;
  discount: number;
  discountCode: string | null;
  total: number;
  paymentMethod: string;
  transactionNumber: string | null;
  customerNote: string | null;
  // One entry per printed line; blank parts already removed.
  addressLines: string[];
}

const PAYMENT_LABELS: Record<string, string> = {
  cod: "Cash on delivery",
  esewa: "eSewa QR",
  khalti: "Khalti",
  bank_transfer: "Bank transfer",
};

const paymentLabel = (method: string) => PAYMENT_LABELS[method] ?? method;

function itemsTable(items: OrderEmailData["items"]): string {
  const rows = items
    .map(
      (item, i) => `<tr>
        <td valign="top" style="padding:14px 12px 14px 0;${i ? `border-top:1px solid ${C.border};` : ""}">
          <p style="margin:0 0 4px;font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:1.4;color:${C.ink};">${esc(item.name)}</p>
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${C.muted};">Qty ${item.quantity} &times; ${formatRs(item.price)}</p>
        </td>
        <td valign="top" align="right" style="padding:14px 0;${i ? `border-top:1px solid ${C.border};` : ""}font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${C.ink};white-space:nowrap;">${formatRs(item.price * item.quantity)}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">${rows}</table>`;
}

function totalsTable(data: OrderEmailData): string {
  const row = (label: string, value: string) => `<tr>
      <td style="padding:5px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${C.body};">${label}</td>
      <td align="right" style="padding:5px 0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:${C.ink};">${value}</td>
    </tr>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.border};margin:0 0 28px;padding-top:10px;">
    ${row("Subtotal", formatRs(data.subtotal))}
    ${row("Shipping", data.shippingCost > 0 ? formatRs(data.shippingCost) : "Free")}
    ${data.discount > 0 ? row(data.discountCode ? `Discount (${esc(data.discountCode)})` : "Discount", `&minus; ${formatRs(data.discount)}`) : ""}
    <tr>
      <td style="padding:14px 0 0;border-top:1px solid ${C.border};font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${C.ink};">Total</td>
      <td align="right" style="padding:14px 0 0;border-top:1px solid ${C.border};font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:${C.ink};">${formatRs(data.total)}</td>
    </tr>
  </table>`;
}

function addressHtml(data: OrderEmailData): string {
  return `<p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.7;color:${C.body};">
    <strong style="color:${C.ink};">${esc(data.customerName)}</strong><br />
    ${data.addressLines.map(esc).join("<br />")}<br />
    ${esc(data.customerPhone)}
  </p>`;
}

export const generateCustomerOrderEmail = (data: OrderEmailData): string => {
  const orderUrl = `${config.clientUrl}/order-confirmation/${encodeURIComponent(data.orderNumber)}?email=${encodeURIComponent(data.customerEmail)}`;
  const firstName = data.customerName.trim().split(/\s+/)[0] || "there";

  const body = `
    ${paragraph(`Hi ${esc(firstName)}, thanks for shopping with 361 Gadgets. We&rsquo;ve received your order and are getting it ready. Here&rsquo;s a summary for your records.`, 8)}
    ${metaRow([
      ["Order number", esc(data.orderNumber)],
      ["Placed on", esc(data.orderDate)],
      ["Payment", esc(paymentLabel(data.paymentMethod))],
    ])}
    ${sectionTitle("Your items")}
    ${itemsTable(data.items)}
    ${totalsTable(data)}
    ${panel("Delivering to", addressHtml(data))}
    ${sectionTitle("What happens next")}
    ${detailList([
      ["1. Preparation", "We verify your order and pack it for dispatch."],
      ["2. Delivery", "Your order arrives within 2&ndash;3 business days."],
      ["3. Payment", data.paymentMethod === "cod" ? "Pay in cash when your order arrives." : "We confirm your payment before dispatch."],
    ])}
    <div style="height:24px;line-height:24px;">&nbsp;</div>
    ${button("View your order", orderUrl)}
  `;

  return emailLayout({
    preheader: `Order ${data.orderNumber} confirmed — ${formatRs(data.total)}.`,
    eyebrow: "Order confirmed",
    title: "Thank you for your order",
    body,
    footnote: "You&rsquo;re receiving this because an order was placed with this email address at 361 Gadgets.",
  });
};

export const generateAdminOrderNotification = (data: OrderEmailData): string => {
  const adminUrl = `${config.clientUrl}/admin/orders/${data.orderId}`;
  const needsVerification = data.paymentMethod !== "cod";

  const body = `
    ${paragraph(`A new order was placed by <strong style="color:${C.ink};">${esc(data.customerName)}</strong> and is waiting to be processed.`, 8)}
    ${metaRow([
      ["Order number", esc(data.orderNumber)],
      ["Total", formatRs(data.total)],
      ["Payment", esc(paymentLabel(data.paymentMethod))],
    ])}
    ${
      needsVerification
        ? callout(
            `<strong>Payment needs verification.</strong> Transaction number: ${
              data.transactionNumber ? `<strong>${esc(data.transactionNumber)}</strong>` : "<em>not provided</em>"
            }. Confirm it before dispatching.`,
          )
        : ""
    }
    ${panel(
      "Customer",
      detailList([
        ["Name", esc(data.customerName)],
        ["Email", `<a href="mailto:${esc(data.customerEmail)}" style="color:${C.ink};">${esc(data.customerEmail)}</a>`],
        ["Phone", `<a href="tel:${esc(data.customerPhone)}" style="color:${C.ink};">${esc(data.customerPhone)}</a>`],
        ["Placed on", esc(data.orderDate)],
      ]),
    )}
    ${sectionTitle(`Items (${data.items.reduce((n, i) => n + i.quantity, 0)})`)}
    ${itemsTable(data.items)}
    ${totalsTable(data)}
    ${panel("Ship to", addressHtml(data))}
    ${data.customerNote ? panel("Customer note", paragraph(esc(data.customerNote), 0)) : ""}
    ${button("Open in admin panel", adminUrl)}
  `;

  return emailLayout({
    preheader: `${data.customerName} — ${formatRs(data.total)} via ${paymentLabel(data.paymentMethod)}.`,
    eyebrow: "Admin notification",
    title: "New order received",
    body,
    footnote: "Next steps: verify payment if needed, move the order to Processing, then pack and ship.",
  });
};
