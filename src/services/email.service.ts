import { Resend } from "resend";
import { config } from "../config/env.config";
import { logger } from "../utils/logger.util";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

const resend = new Resend(config.resendApiKey);

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

    const mailOptions = {
      from: `"361 Gadgets" <${config.emailFrom}>`,
      to: email,
      subject: "Verify Your Email - 361 Gadgets",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify Your Email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td align="center" style="background:linear-gradient(135deg,#16a34a,#15803d);padding:36px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">361 Gadgets</h1>
              <p style="margin:6px 0 0;color:#bbf7d0;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Premium Gadgets &amp; Electronics</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:600;">Verify your email address</h2>
              <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.7;">
                Thanks for signing up! Click the button below to confirm your email address and activate your account.
              </p>

              <!-- Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center" style="background-color:#16a34a;border-radius:8px;">
                    <a href="${verificationUrl}"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 28px;" />

              <!-- Token box -->
              <p style="margin:0 0 10px;color:#374151;font-size:14px;font-weight:600;">Or enter this token manually in the app:</p>
              <div style="background-color:#f0fdf4;border:1.5px dashed #86efac;border-radius:8px;padding:16px 20px;margin-bottom:10px;">
                <p style="margin:0 0 4px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">Verification Token</p>
                <p style="margin:0;font-family:'Courier New',monospace;font-size:13px;color:#15803d;font-weight:700;word-break:break-all;line-height:1.5;">${token}</p>
              </div>
              <p style="margin:0 0 28px;font-size:12px;color:#9ca3af;">Copy and paste this token on the email verification screen if the button doesn't work.</p>

              <!-- Expiry note -->
              <div style="background-color:#fef9c3;border-left:4px solid #eab308;border-radius:4px;padding:12px 16px;">
                <p style="margin:0;font-size:13px;color:#854d0e;">This link and token will expire in <strong>24 hours</strong>.</p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 48px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                If you didn't create a 361 Gadgets account, you can safely ignore this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    };

    await this.send(mailOptions);
  }

  // Send password reset email
  static async sendPasswordResetEmail(
    email: string,
    token: string
  ): Promise<void> {
    const resetUrl = `${config.clientUrl}/reset-password?token=${token}`;

    const mailOptions = {
      from: `"361 Gadgets" <${config.emailFrom}>`,
      to: email,
      subject: "Reset Your Password - 361 Gadgets",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td align="center" style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:36px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">361 Gadgets</h1>
              <p style="margin:6px 0 0;color:#fecaca;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Password Reset Request</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:600;">Reset your password</h2>
              <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.7;">
                We received a request to reset the password for your 361 Gadgets account. Click the button below to choose a new password.
              </p>

              <!-- Button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center" style="background-color:#dc2626;border-radius:8px;">
                    <a href="${resetUrl}"
                       style="display:inline-block;padding:14px 36px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.3px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 28px;" />

              <!-- Fallback URL -->
              <p style="margin:0 0 8px;color:#374151;font-size:14px;font-weight:600;">Button not working? Copy the link below:</p>
              <div style="background-color:#fef2f2;border:1.5px dashed #fca5a5;border-radius:8px;padding:14px 18px;margin-bottom:28px;">
                <p style="margin:0;font-family:'Courier New',monospace;font-size:12px;color:#b91c1c;word-break:break-all;line-height:1.6;">${resetUrl}</p>
              </div>

              <!-- Expiry + security note -->
              <div style="background-color:#fef9c3;border-left:4px solid #eab308;border-radius:4px;padding:12px 16px;">
                <p style="margin:0;font-size:13px;color:#854d0e;">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, please ignore this email — your password will remain unchanged.</p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 48px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                For security, this link can only be used once. If you need help, contact us at <a href="mailto:${config.adminNotificationEmail}" style="color:#6b7280;">${config.adminNotificationEmail}</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    };

    await this.send(mailOptions);
  }

  // Send welcome email (after verification)
  static async sendWelcomeEmail(
    email: string,
    firstName?: string
  ): Promise<void> {
    const name = firstName || "there";

    const mailOptions = {
      from: `"361 Gadgets" <${config.emailFrom}>`,
      to: email,
      subject: "Welcome to 361 Gadgets!",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Welcome to 361 Gadgets</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td align="center" style="background:linear-gradient(135deg,#16a34a,#15803d);padding:36px 40px;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;">361 Gadgets</h1>
              <p style="margin:6px 0 0;color:#bbf7d0;font-size:13px;letter-spacing:1px;text-transform:uppercase;">Premium Gadgets &amp; Electronics</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 48px 32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:600;">Welcome, ${name}!</h2>
              <p style="margin:0 0 24px;color:#6b7280;font-size:15px;line-height:1.7;">
                Your email has been verified and your account is now active. You're all set to explore our collection of premium gadgets and electronics.
              </p>

              <!-- Features row -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td width="33%" style="padding:16px;background:#f0fdf4;border-radius:8px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:22px;">🛍️</p>
                    <p style="margin:0;font-size:12px;color:#374151;font-weight:600;">Shop</p>
                    <p style="margin:0;font-size:11px;color:#9ca3af;">Premium products</p>
                  </td>
                  <td width="4%"></td>
                  <td width="33%" style="padding:16px;background:#f0fdf4;border-radius:8px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:22px;">🚚</p>
                    <p style="margin:0;font-size:12px;color:#374151;font-weight:600;">Deliver</p>
                    <p style="margin:0;font-size:11px;color:#9ca3af;">Fast to your door</p>
                  </td>
                  <td width="4%"></td>
                  <td width="33%" style="padding:16px;background:#f0fdf4;border-radius:8px;text-align:center;">
                    <p style="margin:0 0 4px;font-size:22px;">⭐</p>
                    <p style="margin:0;font-size:12px;color:#374151;font-weight:600;">Review</p>
                    <p style="margin:0;font-size:11px;color:#9ca3af;">Share your experience</p>
                  </td>
                </tr>
              </table>

              <div style="background-color:#f0fdf4;border-left:4px solid #16a34a;border-radius:4px;padding:14px 18px;">
                <p style="margin:0;font-size:13px;color:#15803d;font-weight:500;">
                  Start browsing — your next gadget is waiting.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 48px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                Thank you for choosing 361 Gadgets. Questions? Reply to this email or reach us at <a href="mailto:${config.adminNotificationEmail}" style="color:#6b7280;">${config.adminNotificationEmail}</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    };

    await this.send(mailOptions);
  }
}
