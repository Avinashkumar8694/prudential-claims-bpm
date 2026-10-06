export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new ApiError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (message: string) => new ApiError(409, message, 'CONFLICT');
export const forbidden = (message: string) => new ApiError(403, message, 'FORBIDDEN');
export const validation = (message: string) => new ApiError(400, message, 'VALIDATION');
export const unauthorized = (message = 'unauthorized') => new ApiError(401, message, 'UNAUTHORIZED');
export const quotaExceeded = (message: string, details?: unknown) => new ApiError(429, message, 'QUOTA_EXCEEDED', details);
