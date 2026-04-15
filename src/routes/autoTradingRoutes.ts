import { Router } from 'express';
import { authenticate, requireTopTier } from '../middleware/auth';
import {
  getAutoSettings,
  updateAutoSettings,
  connectCTrader,
  disconnectCTrader,
  getBalance,
  getTrades,
  getActiveTrades,
  getPending,
  approvePendingTrade,
  closeTradeFn,
  emergencyStopHandler,
  getLogs,
  getPerformance,
  getLivePositions,
  adminGetOverview,
  adminGetUserDetail,
  adminDisableUser,
} from '../controllers/autoTradingController';

const router = Router();

// ── User endpoints (TOP_TIER required) ──
router.use(authenticate, requireTopTier);

// Settings
router.get('/settings', getAutoSettings);
router.patch('/settings', updateAutoSettings);

// cTrader connection
router.post('/connect', connectCTrader);
router.post('/disconnect', disconnectCTrader);
router.get('/balance', getBalance);

// Trades
router.get('/trades', getTrades);
router.get('/trades/active', getActiveTrades);
router.get('/trades/pending', getPending);
router.post('/trades/:id/approve', approvePendingTrade);
router.post('/trades/:id/close', closeTradeFn);

// Live positions from cTrader
router.get('/positions', getLivePositions);

// Emergency stop
router.post('/emergency-stop', emergencyStopHandler);

// Logs
router.get('/logs', getLogs);

// Performance
router.get('/performance', getPerformance);

export default router;
