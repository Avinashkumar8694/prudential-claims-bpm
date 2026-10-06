// SSRF protection for the HTTP (service) node's author-supplied ABSOLUTE URLs only — a relative URL
// (appended to the deployment's own operator-configured integration base URL) is trusted and never
// gated here; only a process author typing a full http(s):// URL directly is subject to this check,
// since that's the only path where arbitrary/attacker-influenced hosts could ever reach this server's
// own network.
import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTS = new Set(['localhost', '169.254.169.254', 'metadata.google.internal']);

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true;
    if (a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b! >= 16 && b! <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80');
  return false;
}

export async function assertOutboundAllowed(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`unsupported protocol "${parsed.protocol}"`);
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) throw new Error(`outbound request to "${host}" is blocked`);
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`outbound request to private/link-local address "${host}" is blocked`);
    return;
  }
  let addrs: string[];
  try { addrs = (await dns.lookup(host, { all: true })).map((a) => a.address); }
  catch { return; } // unresolvable host — let fetch() itself fail naturally, not our concern here
  for (const ip of addrs) if (isPrivateIp(ip)) throw new Error(`"${host}" resolves to a private/link-local address (${ip}) — blocked`);
}
