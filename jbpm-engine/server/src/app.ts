import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import type { AppContext } from './context.ts';
import { createRouter } from './http/routes.ts';
import { ApiError } from './infra/errors.ts';

export function createApp(makeCtx: (tenantId: string) => AppContext): Express {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });
  app.use(express.json());
  app.use('/api', createRouter(makeCtx));
  app.use((_req, res) => { res.status(404).json({ error: 'not found' }); });
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) { res.status(err.status).json({ error: err.message, code: err.code, details: err.details }); return; }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });
  return app;
}
