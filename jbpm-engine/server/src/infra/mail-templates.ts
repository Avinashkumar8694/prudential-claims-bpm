// Every transactional email the product sends, as HTML + plain text. All interpolated values are HTML-escaped
// (workspace and people names are user input), links are built from DASHBOARD_URL only, and one-time tokens
// appear solely in the link of the message meant for their owner.
import { config } from './config.ts';
import type { Mail } from './mailer.ts';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const url = (path: string, params: Record<string, string> = {}) => `${config.dashboardUrl}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;

function layout(title: string, bodyHtml: string, cta?: { label: string; href: string }, footer = ''): string {
  const app = esc(config.appName);
  return `<!doctype html><html><body style="margin:0;background:#f4f4f8;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1f2430">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border-radius:14px;padding:32px">
<tr><td style="font-weight:700;font-size:15px;color:#7c3aed">${app}</td></tr>
<tr><td style="padding-top:16px;font-size:20px;font-weight:700">${esc(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:14px;line-height:1.6;color:#3b4252">${bodyHtml}</td></tr>
${cta ? `<tr><td style="padding-top:22px"><a href="${esc(cta.href)}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;font-size:14px;display:inline-block">${esc(cta.label)}</a></td></tr>
<tr><td style="padding-top:14px;font-size:12px;color:#8a90a2;word-break:break-all">Or paste this link into your browser:<br>${esc(cta.href)}</td></tr>` : ''}
<tr><td style="padding-top:26px;font-size:12px;color:#8a90a2;border-top:1px solid #eee;margin-top:20px">${footer || `You are receiving this because of activity on your ${app} account.`}</td></tr>
</table></td></tr></table></body></html>`;
}

function build(to: string, subject: string, title: string, lines: string[], cta?: { label: string; href: string }, footer?: string): Mail {
  const text = `${title}\n\n${lines.join('\n\n')}${cta ? `\n\n${cta.label}: ${cta.href}` : ''}\n\n— ${config.appName}`;
  const html = layout(title, lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join(''), cta, footer);
  return { to, subject, text, html };
}

const ignore = 'If you did not expect this, you can safely ignore this message.';

export const templates = {
  tempPassword: (to: string, p: { name: string; tempPassword: string; hours: number }) =>
    build(to, `Your ${config.appName} temporary password`, 'Confirm your email to get started',
      [`Hi ${p.name}, thanks for registering. Use the temporary password below to sign in with ${to} — that confirms your email and creates your account.`, `Temporary password: ${p.tempPassword}`, `It is valid for ${p.hours} hours and you will be asked to choose your own password the first time you sign in. ${ignore}`], { label: 'Sign in', href: url('/login') }),

  alreadyRegistered: (to: string) =>
    build(to, `You already have a ${config.appName} account`, 'You already have an account', [`Someone (hopefully you) tried to register ${to}, but an account already exists for it.`, 'Sign in, or reset your password if you have forgotten it. If this was not you, no action is needed.'], { label: 'Sign in', href: url('/login') }),

  otp: (to: string, p: { code: string; minutes: number }) =>
    build(to, `Your ${config.appName} sign-in code: ${p.code}`, 'Your sign-in code', [`Use this code to sign in: ${p.code}`, `It expires in ${p.minutes} minutes and works once. Never share it. If you did not try to sign in, ignore this message.`]),

  verification: (to: string, token: string) =>
    build(to, `Verify your email for ${config.appName}`, 'Confirm your email address', [`Welcome to ${config.appName}. Confirm this address to activate your account.`, `The link expires in 24 hours. ${ignore}`], { label: 'Verify email', href: url('/verify-email', { token }) }),

  passwordReset: (to: string, token: string) =>
    build(to, `Reset your ${config.appName} password`, 'Reset your password', ['We received a request to reset your password. Choose a new one with the button below.', `The link expires in 1 hour and works once. If you did not ask for this, ignore this message — your password is unchanged.`], { label: 'Choose a new password', href: url('/reset-password', { token }) }),

  passwordChanged: (to: string, how: 'reset' | 'changed' | 'admin') =>
    build(to, `Your ${config.appName} password was changed`, 'Your password was changed', [`Your password was ${how === 'reset' ? 'reset using an emailed link' : how === 'admin' ? 'changed by an administrator' : 'changed from your account settings'}. You were signed out of other sessions.`, 'If this was not you, reset your password immediately and contact your administrator.'], { label: 'Sign in', href: url('/login') }),

  accountLocked: (to: string, minutes: number) =>
    build(to, `Your ${config.appName} account is temporarily locked`, 'Account temporarily locked', [`There were too many failed sign-in attempts. The account is locked for ${minutes} minutes.`, 'If this was not you, reset your password.'], { label: 'Reset password', href: url('/forgot-password') }),

  welcome: (to: string, name: string) =>
    build(to, `Welcome to ${config.appName}`, `Welcome, ${name}`, [`Your ${config.appName} account is ready. Create a workspace for your team, or accept an invitation you received.`], { label: 'Open dashboard', href: url('/home') }),

  workspaceCreated: (to: string, workspaceName: string, trialDays?: number | null) =>
    build(to, `Your workspace “${workspaceName}” is ready`, 'Your workspace is ready', [`“${workspaceName}” has been created and you are its owner.${trialDays ? ` Your ${trialDays}-day trial has started.` : ''}`, 'Invite your team from Team → Invite someone, then model your first workflow.'], { label: 'Open workspace', href: url('/home') }),

  invitation: (to: string, p: { workspaceName: string; inviterName: string; role: string; token: string; expiresAt: string }) =>
    build(to, `${p.inviterName} invited you to ${p.workspaceName}`, `Join ${p.workspaceName}`, [`${p.inviterName} invited you to the workspace “${p.workspaceName}” as ${p.role}.`, `Sign in with this email address (${to}) to accept. The invitation expires on ${p.expiresAt.slice(0, 10)}. ${ignore}`], { label: 'Accept invitation', href: url('/accept-invite', { token: p.token }) }),

  invitationAccepted: (to: string, p: { workspaceName: string; memberEmail: string; role: string }) =>
    build(to, `${p.memberEmail} joined ${p.workspaceName}`, 'A new member joined', [`${p.memberEmail} accepted the invitation to “${p.workspaceName}” as ${p.role}.`], { label: 'View team', href: url('/team') }),

  roleChanged: (to: string, p: { workspaceName: string; role: string }) =>
    build(to, `Your role in ${p.workspaceName} changed`, 'Your role changed', [`Your role in “${p.workspaceName}” is now ${p.role}. Your access updates immediately.`], { label: 'Open workspace', href: url('/home') }),

  memberSuspended: (to: string, p: { workspaceName: string; suspended: boolean }) =>
    build(to, p.suspended ? `Your access to ${p.workspaceName} was suspended` : `Your access to ${p.workspaceName} was restored`, p.suspended ? 'Access suspended' : 'Access restored',
      [p.suspended ? `An administrator suspended your access to “${p.workspaceName}”. Contact them if you think this is a mistake.` : `Your access to “${p.workspaceName}” has been restored.`]),

  removed: (to: string, p: { workspaceName: string }) =>
    build(to, `You were removed from ${p.workspaceName}`, 'Removed from workspace', [`You no longer have access to “${p.workspaceName}”. Contact the workspace owner if you think this is a mistake.`]),

  ownershipTransferred: (to: string, p: { workspaceName: string; newOwner: string; becameOwner: boolean }) =>
    build(to, p.becameOwner ? `You are now the owner of ${p.workspaceName}` : `Ownership of ${p.workspaceName} was transferred`, p.becameOwner ? 'You are the new owner' : 'Ownership transferred',
      [p.becameOwner ? `You are now the owner of “${p.workspaceName}”. You can manage billing, the team and every setting.` : `${p.newOwner} is now the owner of “${p.workspaceName}”. Your role is admin.`], { label: 'Open workspace', href: url('/home') }),
};
