// ============================================================
// GoldX — Routes
// ============================================================

import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  authenticateGoldxSession,
  goldxVerifyLimiter,
  goldxSignalLimiter,
} from '../middleware/goldxAuth';
import {
  // Public
  getGoldxPlanPublic,
  // EA
  verifyLicenseHandler,
  getSignalHandler,
  // User
  getMyGoldxSubscription,
  setMyGoldxMode,
  cancelMyGoldxSubscription,
  createGoldxPayment,
  captureGoldxPayment,
  // Admin
  adminGetGoldxDashboard,
  adminGetGoldxLicenses,
  adminGetGoldxSubscriptions,
  adminRevokeGoldxLicense,
  adminExtendGoldxLicense,
  adminGetGoldxAuditLogs,
  adminGetGoldxSettings,
  adminUpdateGoldxSettings,
  adminGetGoldxTradeHistory,
  adminGrantGoldxAccessToUser,
} from '../controllers/goldxController';

const router = Router();

// ── Public ──────────────────────────────────────────────────
router.get('/plan', getGoldxPlanPublic);

// ── EA Endpoints (HMAC-signed, no Supabase auth) ────────────
router.post('/license/verify', goldxVerifyLimiter, verifyLicenseHandler);
router.post('/signal', goldxSignalLimiter, authenticateGoldxSession, getSignalHandler);

// ── User Endpoints (Supabase auth) ──────────────────────────
router.get('/me', authenticate, getMyGoldxSubscription);
router.post('/me/mode', authenticate, setMyGoldxMode);
router.post('/me/cancel', authenticate, cancelMyGoldxSubscription);
router.post('/payment/create', authenticate, createGoldxPayment);
router.post('/payment/capture', authenticate, captureGoldxPayment);

// ── Admin Endpoints ─────────────────────────────────────────
router.get('/admin/dashboard', authenticate, requireAdmin, adminGetGoldxDashboard);
router.get('/admin/licenses', authenticate, requireAdmin, adminGetGoldxLicenses);
router.get('/admin/subscriptions', authenticate, requireAdmin, adminGetGoldxSubscriptions);
router.post('/admin/licenses/:licenseId/revoke', authenticate, requireAdmin, adminRevokeGoldxLicense);
router.post('/admin/licenses/:licenseId/extend', authenticate, requireAdmin, adminExtendGoldxLicense);
router.get('/admin/audit-logs', authenticate, requireAdmin, adminGetGoldxAuditLogs);
router.get('/admin/settings', authenticate, requireAdmin, adminGetGoldxSettings);
router.post('/admin/settings', authenticate, requireAdmin, adminUpdateGoldxSettings);
router.get('/admin/trade-history', authenticate, requireAdmin, adminGetGoldxTradeHistory);
router.post('/admin/users/:userId/grant', authenticate, requireAdmin, adminGrantGoldxAccessToUser);

export default router;
