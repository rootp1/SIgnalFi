import type { Response, Request, NextFunction } from 'express';

// Backwards-compatible success: duplicates fields at root and also nested under data.
export function respondSuccess<T extends Record<string, any>>(res: Response, payload: T, status = 200) {
  return res.status(status).json({ ...payload, data: payload });
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: any;
}

export function respondError(res: Response, error: ApiErrorShape, status = 400) {
  return res.status(status).json({ error, data: null });
}

// Express error-handling middleware
export function errorMiddleware(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;
  console.error('[unhandled]', err);
  respondError(res, { code: 'INTERNAL', message: 'Internal error' }, 500);
}

// Simple request id middleware (if no logging lib yet)
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  (req as any).requestId = cryptoRandom();
  next();
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 10);
}
