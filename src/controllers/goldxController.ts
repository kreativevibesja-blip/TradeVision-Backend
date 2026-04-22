// ============================================================
// GoldX — Controller
// ============================================================

import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { GoldxSessionRequest } from '../middleware/goldxAuth';
import {
  verifyLicense,
  createSubscriptionAndLicense,
  cancelSubscription,
  getUserSubscription,
  getUserLicense,
  getUserAccountState,
  setUserMode,
  setUserSessionMode,
  getGoldxPlan,
  adminGrantGoldxAccess,
  adminGetAllLicenses,
  adminGetAllSubscriptions,
  adminRevokeLicense,
  adminExtendLicense,
  adminGetAuditLogs,
  adminGetDashboardStats,
  adminUpdateSettings,
  adminGetSettings,
  adminGetTradeHistory,
  getOnboardingState,
  updateOnboardingState,
  getLatestSetupRequest,
  createSetupRequest,
  adminGetSetupRequests,
  adminUpdateSetupRequest,
  getEaDownloadUrl,
  insertAuditLog,
  consumePendingDashboardGrant,
  debugBindLicense,
  DEBUG_MODE,
  SKIP_HMAC,
} from '../services/goldx/licenseService';
import { computeHmac, getHmacSecret } from '../services/goldx/crypto';
import { generateSignal, getCurrentSessionStatus, recordTrade } from '../services/goldx/strategyEngine';
import { createOrder, captureOrder } from '../services/paypalService';
import type { GoldxVerifyRequest, GoldxMode, GoldxSessionMode, GoldxRuntimeTradeState } from '../services/goldx/types';

// ── Public ──────────────────────────────────────────────────

export const getGoldxPlanPublic = async (_req: Request, res: Response) => {
  try {
    const plan = await getGoldxPlan();
    if (!plan) return res.status(404).json({ error: 'No active plan' });
    res.json(plan);
  } catch (err) {
    console.error('[GoldX] getGoldxPlanPublic error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

// ── EA Endpoints ────────────────────────────────────────────

export const verifyLicenseHandler = async (req: Request, res: Response) => {
  try {
    const body = req.body as GoldxVerifyRequest;
    const signature = (req.headers['x-goldx-signature'] as string | undefined) ?? '';

    if (!body.licenseKey || !body.mt5Account || !body.deviceId || !body.timestamp || !body.nonce) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!signature && !SKIP_HMAC) {
      return res.status(400).json({ error: 'Missing HMAC signature header' });
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? null;
    const result = await verifyLicense(body, signature, ip);

    if (!result.valid) {
      return res.status(403).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('[GoldX] verifyLicense error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const debugBindLicenseHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!DEBUG_MODE) {
      return res.status(404).json({ error: 'Debug license binding is disabled' });
    }

    const { licenseKey, mt5Account } = req.body as { licenseKey?: string; mt5Account?: string };
    if (!licenseKey || !mt5Account) {
      return res.status(400).json({ error: 'licenseKey and mt5Account are required' });
    }

    const license = await debugBindLicense(licenseKey, mt5Account);
    res.json({
      success: true,
      license: {
        id: license.id,
        mt5Account: license.mt5Account,
        status: license.status,
        expiresAt: license.expiresAt,
      },
    });
  } catch (err: any) {
    console.error('[GoldX Debug] bindLicense error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
};

export const debugGoldxHmacHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!DEBUG_MODE) {
      return res.status(404).json({ error: 'GoldX HMAC debug is disabled' });
    }

    const body = req.body as Partial<GoldxVerifyRequest> & { payload?: string };
    const rawPayload = typeof body.payload === 'string' ? body.payload : null;
    const hasFields = typeof body.licenseKey === 'string'
      && typeof body.mt5Account === 'string'
      && typeof body.deviceId === 'string'
      && typeof body.timestamp === 'number'
      && typeof body.nonce === 'string';

    if (!rawPayload && !hasFields) {
      return res.status(400).json({
        error: 'Provide either payload or licenseKey, mt5Account, deviceId, timestamp, nonce',
      });
    }

    const payloadCandidates = rawPayload
      ? [rawPayload]
      : Array.from(new Set([
          `${body.licenseKey}:${body.mt5Account}:${body.deviceId}:${body.timestamp}:${body.nonce}`,
          `${body.licenseKey!.trim()}:${body.mt5Account!.trim()}:${body.deviceId!.trim()}:${body.timestamp}:${body.nonce!.trim()}`,
          `${body.licenseKey!.trim()}:${body.mt5Account!.trim()}:${body.deviceId!.trim()}:${body.timestamp! < 1e12 ? body.timestamp : Math.trunc(body.timestamp! / 1000)}:${body.nonce!.trim()}`,
          `${body.licenseKey!.trim()}:${body.mt5Account!.trim()}:${body.deviceId!.trim()}:${body.timestamp! < 1e12 ? body.timestamp! * 1000 : body.timestamp}:${body.nonce!.trim()}`,
        ]));

    const secretFingerprint = crypto
      .createHash('sha256')
      .update(getHmacSecret())
      .digest('hex')
      .slice(0, 16);

    res.json({
      ok: true,
      secretFingerprint,
      candidates: payloadCandidates.map((payload) => ({
        payload,
        signature: computeHmac(payload),
      })),
    });
  } catch (err: any) {
    console.error('[GoldX Debug] hmac error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
};

export const getSignalHandler = async (req: GoldxSessionRequest, res: Response) => {
  try {
    const license = req.goldxLicense;
    const accountState = req.goldxAccountState;

    if (!license || !accountState) {
      return res.status(401).json({ error: 'Session context missing' });
    }

    // In production, candles and prices would come from a market data feed.
    // The EA sends current market data in the request body.
    const { candles, bid, ask, accountBalance } = req.body as {
      candles?: { time: number; open: number; high: number; low: number; close: number; volume: number }[];
      bid?: number;
      ask?: number;
      accountBalance?: number;
      currentOpenTrades?: number;
      tradesOpenedLastMinute?: number;
      profitToday?: number;
      lastBatchClosedAt?: string | null;
      losingBatchesInRow?: number;
    };

    if (!candles?.length || !bid || !ask) {
      return res.status(400).json({ error: 'Market data required (candles, bid, ask)' });
    }

    const runtimeTradeState: GoldxRuntimeTradeState = {
      currentOpenTrades: typeof req.body.currentOpenTrades === 'number' ? req.body.currentOpenTrades : undefined,
      tradesOpenedLastMinute: typeof req.body.tradesOpenedLastMinute === 'number' ? req.body.tradesOpenedLastMinute : undefined,
      profitToday: typeof req.body.profitToday === 'number' ? req.body.profitToday : undefined,
      lastBatchClosedAt: typeof req.body.lastBatchClosedAt === 'string' || req.body.lastBatchClosedAt === null
        ? req.body.lastBatchClosedAt
        : undefined,
      losingBatchesInRow: typeof req.body.losingBatchesInRow === 'number' ? req.body.losingBatchesInRow : undefined,
    };

    const signal = await generateSignal(
      accountState,
      candles,
      bid,
      ask,
      accountBalance ?? 10000,
      runtimeTradeState,
    );

    // Record trade if signal is actionable
    if (signal.action !== 'none' && license.mt5Account) {
      await recordTrade(license.id, license.mt5Account, signal);
    }

    res.json(signal);
  } catch (err) {
    console.error('[GoldX] getSignal error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

// ── User (Authenticated) ───────────────────────────────────

export const getMyGoldxSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const [sub, license, accountState, latestGrant] = await Promise.all([
      getUserSubscription(req.user.id),
      getUserLicense(req.user.id),
      getUserAccountState(req.user.id),
      consumePendingDashboardGrant(req.user.id),
    ]);
    const [onboardingState, latestSetupRequest] = await Promise.all([
      getOnboardingState(req.user.id),
      getLatestSetupRequest(req.user.id),
    ]);
    const sessionStatus = accountState
      ? await getCurrentSessionStatus(accountState.sessionMode ?? 'hybrid')
      : null;

    res.json({
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      license: license
        ? {
            id: license.id,
            status: license.status,
            mt5Account: license.mt5Account,
            expiresAt: license.expiresAt,
            createdAt: license.createdAt,
          }
        : null,
      accountState: accountState
        ? {
            ...accountState,
            sessionStatus,
          }
        : null,
      onboardingState,
      setupRequest: latestSetupRequest
        ? {
            id: latestSetupRequest.id,
            server: latestSetupRequest.server,
            email: latestSetupRequest.email,
            status: latestSetupRequest.status,
            createdAt: latestSetupRequest.createdAt,
            updatedAt: latestSetupRequest.updatedAt,
          }
        : null,
      latestGrant,
    });
  } catch (err) {
    console.error('[GoldX] getMySubscription error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const setMyGoldxMode = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { mode } = req.body as { mode: GoldxMode };
    if (!['fast', 'prop', 'hybrid'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode' });
    }
    await setUserMode(req.user.id, mode);
    res.json({ success: true, mode });
  } catch (err: any) {
    console.error('[GoldX] setMode error:', err);
    res.status(400).json({ error: err.message ?? 'Failed to set mode' });
  }
};

export const setMyGoldxSessionMode = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { sessionMode } = req.body as { sessionMode: GoldxSessionMode };
    if (!['day', 'night', 'hybrid', 'all'].includes(sessionMode)) {
      return res.status(400).json({ error: 'Invalid session mode' });
    }
    await setUserSessionMode(req.user.id, sessionMode);
    const sessionStatus = await getCurrentSessionStatus(sessionMode);
    res.json({ success: true, sessionMode, sessionStatus });
  } catch (err: any) {
    console.error('[GoldX] setSessionMode error:', err);
    res.status(400).json({ error: err.message ?? 'Failed to set session mode' });
  }
};

export const cancelMyGoldxSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const sub = await getUserSubscription(req.user.id);
    if (!sub || sub.status !== 'active') return res.status(404).json({ error: 'No active subscription' });
    await cancelSubscription(sub.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[GoldX] cancelSubscription error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const downloadGoldxEa = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const subscription = await getUserSubscription(req.user.id);
    if (!subscription) {
      return res.status(403).json({ error: 'Active GoldX access required' });
    }

    const downloadUrl = await getEaDownloadUrl();
    if (!downloadUrl) {
      return res.status(404).json({ error: 'EA download is not configured yet. Request assisted setup or contact support.' });
    }

    await updateOnboardingState(req.user.id, { hasDownloadedEa: true });
    await insertAuditLog('goldx_ea_download_requested', {
      userId: req.user.id,
      meta: { delivery: 'url' },
    });

    res.json({ success: true, downloadUrl });
  } catch (err: any) {
    console.error('[GoldX] downloadEA error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
};

export const createGoldxSetupRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const subscription = await getUserSubscription(req.user.id);
    if (!subscription) {
      return res.status(403).json({ error: 'GoldX access required' });
    }

    const { mt5Login, server, email, note } = req.body as {
      mt5Login?: string;
      server?: string;
      email?: string;
      note?: string;
    };

    if (!mt5Login?.trim() || !server?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'mt5Login, server, and email are required' });
    }

    await createSetupRequest(req.user.id, {
      mt5Login,
      server,
      email,
      note,
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('[GoldX] setupRequest error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
};

// ── Payment / Subscription ──────────────────────────────────

export const createGoldxPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });

    const plan = await getGoldxPlan();
    if (!plan) return res.status(404).json({ error: 'No active plan' });

    // Check if already subscribed
    const existingSub = await getUserSubscription(req.user.id);
    if (existingSub) {
      return res.status(400).json({ error: 'Already subscribed to GoldX' });
    }

    const order = await createOrder(plan.price.toString(), `GoldX - ${plan.name}`);
    res.json({ orderId: order.id, planId: plan.id });
  } catch (err) {
    console.error('[GoldX] createPayment error:', err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
};

export const captureGoldxPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { orderId, planId } = req.body as { orderId: string; planId: string };

    if (!orderId || !planId) {
      return res.status(400).json({ error: 'orderId and planId required' });
    }

    // Capture PayPal payment
    const capture = await captureOrder(orderId);
    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    // Create subscription + license
    const { subscriptionId, rawLicenseKey } = await createSubscriptionAndLicense(
      req.user.id,
      planId,
      orderId,
    );

    res.json({
      success: true,
      subscriptionId,
      licenseKey: rawLicenseKey,
      message: 'Save your license key — it will only be shown once.',
    });
  } catch (err) {
    console.error('[GoldX] capturePayment error:', err);
    res.status(500).json({ error: 'Failed to process payment' });
  }
};

// ── Admin ───────────────────────────────────────────────────

export const adminGetGoldxDashboard = async (_req: AuthRequest, res: Response) => {
  try {
    const stats = await adminGetDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error('[GoldX Admin] dashboard error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminGetGoldxLicenses = async (_req: AuthRequest, res: Response) => {
  try {
    const licenses = await adminGetAllLicenses();
    res.json(licenses);
  } catch (err) {
    console.error('[GoldX Admin] getLicenses error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminGetGoldxSubscriptions = async (_req: AuthRequest, res: Response) => {
  try {
    const subs = await adminGetAllSubscriptions();
    res.json(subs);
  } catch (err) {
    console.error('[GoldX Admin] getSubscriptions error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminRevokeGoldxLicense = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { licenseId } = req.params;
    await adminRevokeLicense(licenseId, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[GoldX Admin] revokeLicense error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminExtendGoldxLicense = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { licenseId } = req.params;
    const { days } = req.body as { days: number };
    if (!days || days < 1) return res.status(400).json({ error: 'days must be >= 1' });
    await adminExtendLicense(licenseId, days, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[GoldX Admin] extendLicense error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminGetGoldxAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const logs = await adminGetAuditLogs(Math.min(limit, 500), offset);
    res.json(logs);
  } catch (err) {
    console.error('[GoldX Admin] getAuditLogs error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminGetGoldxSettings = async (_req: AuthRequest, res: Response) => {
  try {
    const settings = await adminGetSettings();
    res.json(settings);
  } catch (err) {
    console.error('[GoldX Admin] getSettings error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminUpdateGoldxSettings = async (req: AuthRequest, res: Response) => {
  try {
    const { key, value } = req.body as { key: string; value: Record<string, unknown> };
    if (!key || !value) return res.status(400).json({ error: 'key and value required' });
    await adminUpdateSettings(key, value);
    if (req.user) {
      await insertAuditLog('settings_updated', { userId: req.user.id, meta: { key } });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[GoldX Admin] updateSettings error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminGetGoldxTradeHistory = async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const trades = await adminGetTradeHistory(Math.min(limit, 500), offset);
    res.json(trades);
  } catch (err) {
    console.error('[GoldX Admin] getTradeHistory error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminGetGoldxSetupRequests = async (_req: AuthRequest, res: Response) => {
  try {
    const requests = await adminGetSetupRequests();
    res.json(requests);
  } catch (err) {
    console.error('[GoldX Admin] setup requests error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
};

export const adminUpdateGoldxSetupRequest = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { requestId } = req.params;
    const { status, internalNotes } = req.body as {
      status?: 'pending' | 'in_progress' | 'completed';
      internalNotes?: string | null;
    };

    if (!requestId) return res.status(400).json({ error: 'requestId required' });
    if (status && !['pending', 'in_progress', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await adminUpdateSetupRequest(requestId, req.user.id, { status, internalNotes });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[GoldX Admin] update setup request error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
};

export const adminGrantGoldxAccessToUser = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const result = await adminGrantGoldxAccess(userId, req.user.id);
    res.json({
      success: true,
      created: result.created,
      licenseKey: result.rawLicenseKey,
      message: result.rawLicenseKey
        ? 'GoldX access granted. Save the license key because it is only shown once.'
        : 'User already has active GoldX access.',
    });
  } catch (err: any) {
    console.error('[GoldX Admin] grantUserAccess error:', err);
    res.status(500).json({ error: err?.message ?? 'Internal error' });
  }
};
