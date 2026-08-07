// Typed API errors with a stable code (mirrors docs/05-api-spec.md error codes) + express handler.
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.ts';

export type ErrorCode =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT'
  | 'VERSION_FROZEN' | 'DEPLOY_BLOCKED' | 'INSTANCE_NOT_RESUMABLE' | 'SCRIPT_TIMEOUT' | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422, CONFLICT: 409,
  VERSION_FROZEN: 409, DEPLOY_BLOCKED: 409, INSTANCE_NOT_RESUMABLE: 409, SCRIPT_TIMEOUT: 500, INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
  }
  get status() { return STATUS[this.code]; }
}

export const notFound = (what: string) => new ApiError('NOT_FOUND', `${what} not found`);
export const validation = (message: string, details?: unknown) => new ApiError('VALIDATION_FAILED', message, details);
export const conflict = (message: string, details?: unknown) => new ApiError('CONFLICT', message, details);
export const forbidden = (message: string, details?: unknown) => new ApiError('FORBIDDEN', message, details);
export const authRequired = (message = 'authentication required') => new ApiError('AUTH_REQUIRED', message);

// wrap an async route so thrown errors reach the error middleware
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error(err.message, { code: err.code });
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  logger.error('unhandled error', { err: (err as Error)?.message, stack: (err as Error)?.stack });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
