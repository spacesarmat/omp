/** Sends the code by SMTP when the panel has a server configured. A missing package or host returns false. */
export async function sendMail(settings, { to, subject, text }) {
  if (!settings || !settings.smtpHost || !to) return false;
  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch (e) {
    return false;
  }
  const port = Number(settings.smtpPort) || 587;
  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port,
    // 465 is implicit TLS; any other port must upgrade via STARTTLS and fail rather than
    // fall back to plaintext (requireTLS), so credentials and codes are never sent in clear.
    secure: port === 465,
    requireTLS: port !== 465,
    auth: settings.smtpUser ? { user: settings.smtpUser, pass: settings.smtpPass } : undefined,
  });
  await transport.sendMail({ from: settings.smtpFrom || settings.smtpUser, to, subject, text });
  return true;
}
