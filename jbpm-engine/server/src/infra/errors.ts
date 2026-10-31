// Typed API errors with a stable code (mirrors docs/05-api-spec.md error codes) + express handler.
import type { Request, Response, NextFunction } from 'express';
import { logger } from './logger.ts';

export type ErrorCode =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'CONFLICT'
  | 'VERSION_FROZEN' | 'DEPLOY_BLOCKED' | 'INSTANCE_NOT_RESUMABLE' | 'SCRIPT_TIMEOUT' | 'INTERNAL'
  | 'QUOTA_EXCEEDED' | 'RATE_LIMITED' | 'JBPM_EXPORT_DENIED' | 'PLAN_EXPIRED';

const STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_FAILED: 422, CONFLICT: 409,
  VERSION_FROZEN: 409, DEPLOY_BLOCKED: 409, INSTANCE_NOT_RESUMABLE: 409, SCRIPT_TIMEOUT: 500, INTERNAL: 500,
  QUOTA_EXCEEDED: 429, RATE_LIMITED: 429, JBPM_EXPORT_DENIED: 422, PLAN_EXPIRED: 402,
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
export const quotaExceeded = (message: string, details?: unknown) => new ApiError('QUOTA_EXCEEDED', message, details);
/** the workspace's trial/plan has lapsed: reads keep working, anything that creates or runs work is refused (402) */
export const planExpired = (message: string, details?: unknown) => new ApiError('PLAN_EXPIRED', message, details);
export const rateLimited = (message = 'too many requests') => new ApiError('RATE_LIMITED', message);
export const jbpmExportDenied = (message: string, details?: unknown) => new ApiError('JBPM_EXPORT_DENIED', message, details);

// wrap an async route so thrown errors reach the error middleware
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(next); };

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error(err.message, { code: err.code });
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // body-parser / http-errors client faults (payload too large, malformed JSON, bad charset…) are the CALLER's mistake:
  // answer with their own 4xx instead of a misleading 500
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500 && (err as { expose?: boolean }).expose !== false) {
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : status === 400 ? 'BAD_REQUEST' : 'REQUEST_REJECTED';
    return res.status(status).json({ error: { code, message: status === 413 ? 'request body too large' : status === 400 ? 'malformed request body' : 'request rejected' } });
  }
  logger.error('unhandled error', { err: (err as Error)?.message, stack: (err as Error)?.stack });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}
