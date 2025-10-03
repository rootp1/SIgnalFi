import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

function keyFromReq(req: Request): string {
  // Prefer body userId / traderId / telegramUserId; fallback to IP.
  const id = (req.body && (req.body.userId || req.body.traderId || req.body.telegramUserId))
    || (req.params && (req.params.telegramUserId))
    || (req.query && (req.query.traderId as string))
    || undefined;
  return id ? String(id) : (req.ip || 'unknown');
}

export const globalLimiter = rateLimit({
  windowMs: Number(process.env.RL_GLOBAL_WINDOW_MS || 5 * 60 * 1000),
  max: Number(process.env.RL_GLOBAL_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyFromReq
});

export const followLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: { error: { code: 'RATE_LIMIT_FOLLOW', message: 'Too many follow attempts. Try later.' } },
  keyGenerator: keyFromReq
});

export const signalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT_SIGNAL', message: 'Signal broadcast rate exceeded.' } },
  keyGenerator: keyFromReq
});

export const walletLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { error: { code: 'RATE_LIMIT_WALLET', message: 'Too many wallet attempts.' } },
  keyGenerator: keyFromReq
});
