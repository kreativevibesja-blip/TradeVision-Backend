// ============================================================
// GoldX — EA Session Authentication Middleware
// ============================================================

import { Request, Response, NextFunction } from 'express';
import { validateSession } from '../services/goldx/licenseService';
import type { GoldxLicense, GoldxAccountState } from '../services/goldx/types';
import rateLimit from 'express-rate-limit';

export interface GoldxSessionRequest extends Request {
  goldxLicense?: GoldxLicense;
  goldxAccountState?: GoldxAccountState;
}

/**
 * Validates a GoldX session token from the Authorization header.
 * Used by the signal endpoint — EA sends Bearer <sessionToken>.
 */
export const authenticateGoldxSession = async (
  req: GoldxSessionRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Session token required' });
  }

  const sessionToken = authHeader.substring(7);
  const result = await validateSession(sessionToken);

  if (!result.valid || !result.license) {
    return res.status(401).json({ error: result.error ?? 'Invalid session' });
  }

  req.goldxLicense = result.license;
  req.goldxAccountState = result.accountState;
  next();
};

/** Rate limiter for license verification (EA heartbeat) */
export const goldxVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12, // 12 verify calls per minute per IP
  message: { error: 'Too many verification attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Rate limiter for signal endpoint */
export const goldxSignalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 signal requests per minute per IP
  message: { error: 'Too many signal requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Rate limiter for realtime config polling */
export const goldxConfigLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many config requests' },
  standardHeaders: true,
  legacyHeaders: false,
});
