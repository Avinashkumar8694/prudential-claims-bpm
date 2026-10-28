// Shared per-request accessors — factored out so a new routes file (e.g. workflow-instances.ts)
// doesn't have to redeclare these two one-liners; routes.ts keeps using them the same way it always
// has, just imported instead of locally declared.
import type { Request } from 'express';
import type { AppContext } from '../context.ts';

export const ctxOf = (req: Request): AppContext => (req as any).ctx;
export const actorOf = (req: Request): string => (req as any).actor;
