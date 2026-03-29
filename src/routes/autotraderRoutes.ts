import { Router } from 'express';
import { authenticate, requireTopTier } from '../middleware/auth';
import {
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
