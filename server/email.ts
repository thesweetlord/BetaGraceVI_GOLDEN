import nodemailer from "nodemailer";

// ── GDPR Article 17 Email Notifications ─────────────────────────────────────
// Configure all values via environment variables.
// When forking this project, set the following in your environment:
//   ADMIN_EMAIL   — address that receives deletion request notifications
//   SMTP_FROM     — "From" address shown on outbound emails
//   SMTP_HOST     — your SMTP server hostname (e.g. smtp.gmail.com)
//   SMTP_PORT     — SMTP port (default: 587 for STARTTLS, 465 for SSL)
//   SMTP_USER     — SMTP authentication username
//   SMTP_PASS     — SMTP authentication password / app password
//
// If none are set the system logs a warning and skips email — the deletion
// request is still persisted to the database regardless.

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
const SMTP_FROM   = process.env.SMTP_FROM   || "";
const SMTP_HOST   = process.env.SMTP_HOST   || "";
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER   = process.env.SMTP_USER   || "";
const SMTP_PASS   = process.env.SMTP_PASS   || "";

function createTransport(): nodemailer.Transporter | null {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // Prevent hanging the HTTP response if SMTP server is unreachable.
    // connectionTimeout: time to establish TCP connection (default: 2 min — dangerously long)
    // socketTimeout:     idle time on an open socket before giving up
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

export interface DeletionEmailData {
  requestId:    string;
  sessionId:    string;
  requestedAt:  string;
  reason:       string;
  userMessage?: string | null;
}

export async function sendDeletionRequestEmail(
  data: DeletionEmailData
): Promise<{ sent: boolean; reason?: string }> {
  if (!ADMIN_EMAIL || !SMTP_HOST) {
    console.warn(
      "[EMAIL] SMTP not configured — deletion request logged to DB only. " +
      "Set ADMIN_EMAIL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM to enable email notifications."
    );
    return { sent: false, reason: "SMTP not configured" };
  }

  const transport = createTransport();
  if (!transport) {
    console.warn("[EMAIL] Could not create SMTP transport.");
    return { sent: false, reason: "Could not create SMTP transport" };
  }

  const subject = `[BetaGrace] GDPR Art. 17 Deletion Request — ${data.requestId}`;

  const textBody = [
    "GDPR Article 17 — Right to Erasure — Deletion Request",
    "======================================================",
    "",
    `Request ID   : ${data.requestId}`,
    `Session ID   : ${data.sessionId}`,
    `Requested At : ${data.requestedAt}`,
    `Reason       : ${data.reason}`,
    data.userMessage ? `User Message : ${data.userMessage}` : "",
    "",
    "Action required:",
    "  1. Verify the request is legitimate.",
    "  2. Use the admin API (PATCH /api/admin/deletion-requests/:id)",
    "     to set status → 'processing' then 'completed'.",
    "  3. Confirm all data has been erased within 30 days (GDPR Art. 17(1)).",
    "",
    "— BetaGrace vI automated notification",
  ].filter(Boolean).join("\n");

  const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a;">
  <h2 style="color:#dc2626;border-bottom:2px solid #dc2626;padding-bottom:8px;">
    GDPR Article 17 — Right to Erasure
  </h2>
  <p>A user has submitted a formal data deletion request.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <tr style="background:#f3f4f6;">
      <td style="padding:8px 12px;font-weight:600;width:140px;">Request ID</td>
      <td style="padding:8px 12px;font-family:monospace;">${data.requestId}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;font-weight:600;">Session ID</td>
      <td style="padding:8px 12px;font-family:monospace;">${data.sessionId}</td>
    </tr>
    <tr style="background:#f3f4f6;">
      <td style="padding:8px 12px;font-weight:600;">Requested At</td>
      <td style="padding:8px 12px;">${data.requestedAt}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;font-weight:600;">Reason</td>
      <td style="padding:8px 12px;">${data.reason}</td>
    </tr>
    ${data.userMessage ? `
    <tr style="background:#f3f4f6;">
      <td style="padding:8px 12px;font-weight:600;">User Message</td>
      <td style="padding:8px 12px;">${data.userMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>
    </tr>` : ""}
  </table>
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-top:16px;">
    <strong style="color:#dc2626;">Action Required</strong>
    <ol style="margin:8px 0 0;padding-left:20px;color:#374151;">
      <li>Verify the request is legitimate.</li>
      <li>Process via admin API: <code>PATCH /api/admin/deletion-requests/${data.requestId}</code></li>
      <li>Complete erasure within 30 days (GDPR Art. 17(1)).</li>
    </ol>
  </div>
  <p style="color:#6b7280;font-size:12px;margin-top:24px;">— BetaGrace vI automated notification</p>
</body>
</html>`;

  try {
    await transport.sendMail({
      from: SMTP_FROM || SMTP_USER,
      to: ADMIN_EMAIL,
      subject,
      text: textBody,
      html: htmlBody,
    });
    console.log(`[EMAIL] Deletion request notification sent for ${data.requestId}`);
    return { sent: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[EMAIL] Failed to send deletion request email:", msg);
    return { sent: false, reason: msg };
  }
}
