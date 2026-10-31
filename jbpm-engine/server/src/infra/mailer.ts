// Outbound mail, configuration-based (same knobs as zero-rules-manager / zero-payment-ms):
//   SMTP_HOST/PORT/SECURE/USER/PASSWORD (aliases EMAIL_*, SMTP_PASS)  → real SMTP via nodemailer
//   MAIL_WEBHOOK_URL                                                    → JSON relay {from,to,subject,text,html}
//   neither                                                             → logged only (dev); in production the body is never logged
// A delivery failure never fails the request that triggered it (the invitation / reset is still saved).
// MAIL_CAPTURE=true (tests) keeps the last messages in memory.
import nodemailer, { type Transporter } from 'nodemailer';
import { config } from './config.ts';
import { logger } from './logger.ts';

export interface Mail { to: string; subject: string; text: string; html?: string }
export const outbox: Array<Mail & { at: string }> = [];

let transporter: Transporter | undefined;
const smtp = () => {
  const c = config.mail.smtp;
  if (!c) return undefined;
  return (transporter ??= nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, ...(c.user ? { auth: { user: c.user, pass: c.pass } } : {}), connectionTimeout: 8000, socketTimeout: 15000 }));
};

/** true when a message can actually leave the building (so callers know whether to surface a manual link). */
export const mailEnabled = () => !!config.mail.smtp || !!config.mail.webhookUrl;

/** subject/recipient must be a single header line */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export async function sendMail(m: Mail): Promise<boolean> {
  const mail = { ...m, to: oneLine(m.to), subject: oneLine(m.subject) };
  if (config.mail.capture) { outbox.push({ ...mail, at: new Date().toISOString() }); if (outbox.length > 200) outbox.shift(); }
  try {
    const t = smtp();
    if (t) { await t.sendMail({ from: config.mail.from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }); return true; }
    if (config.mail.webhookUrl) {
      const res = await fetch(config.mail.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: config.mail.from, ...mail }), signal: AbortSignal.timeout(5000) });
      if (!res.ok) { logger.warn('mail webhook rejected the message', { status: res.status, to: mail.to }); return false; }
      return true;
    }
  } catch (e) { logger.warn('mail delivery failed', { to: mail.to, subject: mail.subject, err: (e as Error).message }); return false; }
  if (config.isProduction) logger.warn('mail not delivered: no SMTP_HOST / MAIL_WEBHOOK_URL configured', { to: mail.to, subject: mail.subject });
  else logger.info('mail (no transport configured — dev log only)', { to: mail.to, subject: mail.subject, text: mail.text });
  return false;
}
