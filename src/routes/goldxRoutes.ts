// ============================================================
// GoldX — Routes
// ============================================================

import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  authenticateGoldxSession,
  goldxConfigLimiter,
  goldxVerifyLimiter,
  goldxSignalLimiter,
} from '../middleware/goldxAuth';
import {
  // Public
  getGoldxPlanPublic,
  // EA
  verifyLicenseHandler,
  getRealtimeConfigHandler,
  getSignalHandler,
  // User
  getMyGoldxSubscription,
  setMyGoldxMode,
  setMyGoldxLotSize,
  setMyGoldxSessionMode,
  downloadGoldxEa,
  createGoldxSetupRequest,
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
  adminGetGoldxSetupRequests,
  adminUpdateGoldxSetupRequest,
  adminGrantGoldxAccessToUser,
} from '../controllers/goldxController';

const router = Router();

// ── Public ──────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'goldx',
    endpoints: {
      plan: '/api/goldx/plan',
      verifyLicense: '/api/goldx/license/verify',
      signal: '/api/goldx/signal',
      me: '/api/goldx/me',
      downloadEa: '/api/goldx/download-ea',
      setupRequest: '/api/goldx/setup-request',
      createPayment: '/api/goldx/payment/create',
      capturePayment: '/api/goldx/payment/capture',
      adminDashboard: '/api/goldx/admin/dashboard',
    },
  });
});

router.get('/plan', getGoldxPlanPublic);

// ── EA Endpoints (HMAC-signed, no Supabase auth) ────────────
router.post('/license/verify', goldxVerifyLimiter, verifyLicenseHandler);
router.get('/config', goldxConfigLimiter, authenticateGoldxSession, getRealtimeConfigHandler);
router.post('/signal', goldxSignalLimiter, authenticateGoldxSession, getSignalHandler);

// ── User Endpoints (Supabase auth) ──────────────────────────
router.get('/me', authenticate, getMyGoldxSubscription);
router.post('/me/mode', authenticate, setMyGoldxMode);
router.post('/settings/lot-size', authenticate, setMyGoldxLotSize);
router.post('/set-session-mode', authenticate, setMyGoldxSessionMode);
router.get('/download-ea', authenticate, downloadGoldxEa);
router.post('/setup-request', authenticate, createGoldxSetupRequest);
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
router.get('/admin/setup-requests', authenticate, requireAdmin, adminGetGoldxSetupRequests);
router.post('/admin/setup-requests/:requestId', authenticate, requireAdmin, adminUpdateGoldxSetupRequest);
router.post('/admin/users/:userId/grant', authenticate, requireAdmin, adminGrantGoldxAccessToUser);

export default router;
