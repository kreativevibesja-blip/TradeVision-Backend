// ============================================================
// GoldX — Controller
// ============================================================

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
  getGoldxPlan,
  adminGetAllLicenses,
  adminGetAllSubscriptions,
  adminRevokeLicense,
  adminExtendLicense,
  adminGetAuditLogs,
  adminGetDashboardStats,
  adminUpdateSettings,
  adminGetSettings,
  adminGetTradeHistory,
  insertAuditLog,
} from '../services/goldx/licenseService';
import { generateSignal, recordTrade } from '../services/goldx/strategyEngine';
import { createOrder, captureOrder } from '../services/paypalService';
import type { GoldxVerifyRequest, GoldxMode } from '../services/goldx/types';

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
    const signature = req.headers['x-goldx-signature'] as string;

    if (!body.licenseKey || !body.mt5Account || !body.deviceId || !body.timestamp || !body.nonce) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!signature) {
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
    };

    if (!candles?.length || !bid || !ask) {
      return res.status(400).json({ error: 'Market data required (candles, bid, ask)' });
    }

    const signal = await generateSignal(
      accountState,
      candles,
      bid,
      ask,
      accountBalance ?? 10000,
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
    const sub = await getUserSubscription(req.user.id);
    const license = await getUserLicense(req.user.id);
    const accountState = await getUserAccountState(req.user.id);

    res.json({
      subscription: sub,
      license: license
        ? { id: license.id, status: license.status, mt5Account: license.mt5Account, expiresAt: license.expiresAt }
        : null,
      accountState,
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

export const cancelMyGoldxSubscription = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    const sub = await getUserSubscription(req.user.id);
    if (!sub) return res.status(404).json({ error: 'No active subscription' });
    await cancelSubscription(sub.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[GoldX] cancelSubscription error:', err);
    res.status(500).json({ error: 'Internal error' });
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
