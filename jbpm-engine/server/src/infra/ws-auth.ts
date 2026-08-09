// WS upgrade-handshake auth: same JWT the REST API requires (see http/auth-middleware.ts's
// requireAuth), passed as a query param since browsers can't set an Authorization header during the
// WebSocket handshake itself.
import type { IncomingMessage } from 'node:http';
import { verifyToken } from './auth.ts';

export function authenticateWsUpgrade(req: IncomingMessage): boolean {
  const token = new URL(req.url || '', 'http://internal').searchParams.get('token');
  try {
    verifyToken(token || '');
    return true;
  } catch {
    return false;
  }
}
