import { Router } from 'express';
import { authenticate, requireTopTier } from '../middleware/auth';
import {
  getConnection,
  connectMt5,
  disconnectMt5,
  heartbeat,
  createSignal,
  getSignals,
  getPendingSignals,
  approveSignal,
  confirmExecution,
  cancelSignal,
  getSettings,
  updateSettings,
  toggleKillSwitchHandler,
} from '../controllers/autotraderController';

const router = Router();

router.use(authenticate, requireTopTier);

// MT5 Connection
router.get('/connection', getConnection);
router.post('/connection', connectMt5);
router.post('/disconnect', disconnectMt5);
router.post('/heartbeat', heartbeat);

// Trade Signals
router.post('/signals', createSignal);
router.get('/signals', getSignals);
router.get('/signals/pending', getPendingSignals);
router.post('/signals/:id/approve', approveSignal);
router.post('/signals/:id/confirm', confirmExecution);
router.post('/signals/:id/cancel', cancelSignal);

// Risk Settings
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);
router.post('/kill-switch', toggleKillSwitchHandler);

export default router;
