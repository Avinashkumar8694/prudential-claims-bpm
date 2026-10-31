// Throw-away mailbox providers refused at self-registration (AUTH_BLOCK_DISPOSABLE_EMAILS), like the Identity Server does.
// Not exhaustive by nature; AUTH_ALLOWED_EMAIL_DOMAINS is the strict alternative for enterprises.
const DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com', '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'yopmail.net', 'trashmail.com', 'trashmail.net', 'getnada.com', 'dispostable.com', 'throwawaymail.com', 'maildrop.cc', 'fakeinbox.com', 'mailnesia.com',
  'mintemail.com', 'spamgourmet.com', 'tempinbox.com', 'mohmal.com', 'emailondeck.com', 'burnermail.io', 'moakt.com', 'tmpmail.org', 'mytemp.email', 'discard.email', 'mailcatch.com',
]);
export function isDisposableEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return !!domain && (DOMAINS.has(domain) || [...DOMAINS].some((d) => domain.endsWith(`.${d}`)));
}
