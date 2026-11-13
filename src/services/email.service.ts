import { Resend } from "resend";
import { config } from "../config/env.config";
import { logger } from "../utils/logger.util";
import {
  EMAIL_COLORS as C,
  button,
  emailLayout,
  esc,
  panel,
  paragraph,
} from "../templates/emailLayout";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

const resend = new Resend(config.resendApiKey);

// The raw link or token, in a monospace box, for when the button doesn't work.
const codeBox = (label: string, value: string) =>
  panel(
    label,
    `<p style="margin:0;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:12px;line-height:1.6;color:${C.ink};word-break:break-all;">${esc(value)}</p>`,
  );

export class EmailService {
  // Central send via Resend. `from` must use a domain verified in Resend
  // (or onboarding@resend.dev for testing). Configured via EMAIL_FROM.
  private static async send(mail: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const { data, error } = await resend.emails.send({
      from: `361 Gadgets <${config.emailFrom}>`,
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
    });

    if (error) {
      logger.warn({ to: mail.to, err: error.message }, "email send failed");
      throw new Error(`Failed to send email: ${error.message}`);
    }

    logger.debug({ to: mail.to }, "email sent");
  }

  // Generic send used across the app.
  static async sendEmail(options: EmailOptions): Promise<void> {
    await this.send(options);
  }

  // Resend has no persistent connection to "verify" — confirm the key is set.
  static async testConnection(): Promise<boolean> {
    if (!config.resendApiKey) {
      console.error("❌ RESEND_API_KEY is not set");
      return false;
    }
    console.log("✅ Email service (Resend) configured");
    return true;
  }

  // Send verification email
  static async sendVerificationEmail(
    email: string,
    token: string
  ): Promise<void> {
    const verificationUrl = `${config.clientUrl}/verify-email?token=${token}`;

    await this.send({
      to: email,
      subject: "Verify your email - 361 Gadgets",
      html: emailLayout({
        preheader: "Confirm your email to activate your 361 Gadgets account.",
        eyebrow: "Account",
        title: "Verify your email",
        body: `
          ${paragraph("Thanks for signing up. Confirm your email address to activate your account and start shopping.", 24)}
          ${button("Verify email address", verificationUrl)}
          <div style="height:28px;line-height:28px;">&nbsp;</div>
          ${paragraph("Button not working? Enter this token on the verification screen:", 10)}
          ${codeBox("Verification token", token)}
        `,
        footnote: "This link and token expire in 24 hours. If you didn&rsquo;t create a 361 Gadgets account, you can ignore this email.",
      }),
    });
  }

  // Send password reset email
  static async sendPasswordResetEmail(
    email: string,
    token: string
  ): Promise<void> {
    const resetUrl = `${config.clientUrl}/reset-password?token=${token}`;

    await this.send({
      to: email,
      subject: "Reset your password - 361 Gadgets",
      html: emailLayout({
        preheader: "Use this link to choose a new password. It expires in 1 hour.",
        eyebrow: "Security",
        title: "Reset your password",
        body: `
          ${paragraph("We received a request to reset the password for your 361 Gadgets account. Choose a new one using the button below.", 24)}
          ${button("Reset password", resetUrl)}
          <div style="height:28px;line-height:28px;">&nbsp;</div>
          ${paragraph("Button not working? Copy this link into your browser:", 10)}
          ${codeBox("Reset link", resetUrl)}
        `,
        footnote: "This link expires in 1 hour and can only be used once. If you didn&rsquo;t ask for a reset, ignore this email &mdash; your password stays the same.",
      }),
    });
  }

  // Send welcome email (after verification)
  static async sendWelcomeEmail(
    email: string,
    firstName?: string
  ): Promise<void> {
    const name = firstName?.trim() || "there";
    const pillar = (title: string, text: string) => `<td width="33%" valign="top" style="padding:16px 14px;border:1px solid ${C.border};">
        <p style="margin:0 0 4px;font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:${C.ink};">${title}</p>
        <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${C.body};">${text}</p>
      </td>`;

    await this.send({
      to: email,
      subject: "Welcome to 361 Gadgets",
      html: emailLayout({
        preheader: "Your account is active. Here's what to expect from us.",
        eyebrow: "Welcome",
        title: `Welcome, ${name}`,
        body: `
          ${paragraph("Your email is verified and your account is ready. Every product we sell is original &mdash; no fakes, no compromises.", 24)}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 28px;">
            <tr>
              ${pillar("Genuine", "Original products from trusted brands.")}
              ${pillar("Fast delivery", "2&ndash;3 business days, nationwide.")}
              ${pillar("Real reviews", "Only verified buyers can review.")}
            </tr>
          </table>
          ${button("Start shopping", `${config.clientUrl}/products`)}
        `,
      }),
    });
  }
}
