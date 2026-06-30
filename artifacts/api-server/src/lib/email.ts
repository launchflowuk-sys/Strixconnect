import { logger } from "./logger";

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

export type EmailResult =
  | { delivered: true }
  | { delivered: false; reason: "smtp_not_configured" | "transport_error"; error?: unknown };

let transporter: any = null;

async function getTransporter() {
  if (transporter) return transporter;

  const host = process.env["SMTP_HOST"];
  const port = Number(process.env["SMTP_PORT"] || "587");
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];
  const from = process.env["SMTP_FROM"] || "noreply@complianceos.local";

  if (!host || !user || !pass) {
    return null;
  }

  const nodemailer = await import("nodemailer");
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  (transporter as any)._from = from;
  return transporter;
}

export async function sendEmail(opts: SendEmailOptions): Promise<EmailResult> {
  const t = await getTransporter();
  if (!t) {
    return { delivered: false, reason: "smtp_not_configured" };
  }

  try {
    await t.sendMail({
      from: t._from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { delivered: true };
  } catch (err) {
    logger.warn({ err, to: opts.to }, "email: send failed");
    return { delivered: false, reason: "transport_error", error: err };
  }
}
