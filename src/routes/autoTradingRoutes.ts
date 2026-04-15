import { Router } from 'express';
import { authenticate, requireVipAutoTrader } from '../middleware/auth';
import {
  getAutoSettings,
  updateAutoSettings,
  getOAuthUrl,
  connectCTrader,
  selectCTraderAccount,
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

// ── User endpoints (VIP Auto Trader required) ──
router.use(authenticate, requireVipAutoTrader);

// Settings
router.get('/settings', getAutoSettings);
router.patch('/settings', updateAutoSettings);

// cTrader connection (OAuth)
router.get('/oauth-url', getOAuthUrl);
router.post('/connect', connectCTrader);
router.post('/select-account', selectCTraderAccount);
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
