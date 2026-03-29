import { Router } from 'express';
import { authenticate } from '../middleware/auth';
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

// MT5 Connection
router.get('/connection', authenticate, getConnection);
router.post('/connection', authenticate, connectMt5);
router.post('/disconnect', authenticate, disconnectMt5);
router.post('/heartbeat', authenticate, heartbeat);

// Trade Signals
router.post('/signals', authenticate, createSignal);
router.get('/signals', authenticate, getSignals);
router.get('/signals/pending', authenticate, getPendingSignals);
router.post('/signals/:id/approve', authenticate, approveSignal);
router.post('/signals/:id/confirm', authenticate, confirmExecution);
router.post('/signals/:id/cancel', authenticate, cancelSignal);

// Risk Settings
router.get('/settings', authenticate, getSettings);
router.patch('/settings', authenticate, updateSettings);
router.post('/kill-switch', authenticate, toggleKillSwitchHandler);

export default router;
