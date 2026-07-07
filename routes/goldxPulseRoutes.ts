import { Router } from 'express';
import { authenticate, requireGoldxPulseAccess } from '../middleware/auth';
import {
  acceptGoldxPulseAgreementHandler,
  clearGoldxPulseTradesHandler,
  connectGoldxPulseHandler,
  disconnectGoldxPulseHandler,
  getGoldxPulseAgreementStatusHandler,
  getGoldxPulseAccessHandler,
  getGoldxPulseSessionHandler,
  goldxPulseStreamHandler,
  placeGoldxPulseTradeHandler,
  updateGoldxPulseSettingsHandler,
} from '../controllers/goldxPulseController';

const router = Router();

router.get('/access', authenticate, getGoldxPulseAccessHandler);
router.get('/session', authenticate, requireGoldxPulseAccess, getGoldxPulseSessionHandler);
router.get('/stream', authenticate, requireGoldxPulseAccess, goldxPulseStreamHandler);
router.post('/connect', authenticate, requireGoldxPulseAccess, connectGoldxPulseHandler);
router.post('/disconnect', authenticate, requireGoldxPulseAccess, disconnectGoldxPulseHandler);
router.post('/settings', authenticate, requireGoldxPulseAccess, updateGoldxPulseSettingsHandler);
router.post('/trade', authenticate, requireGoldxPulseAccess, placeGoldxPulseTradeHandler);
router.post('/clear-results', authenticate, requireGoldxPulseAccess, clearGoldxPulseTradesHandler);
router.get('/agreement', authenticate, requireGoldxPulseAccess, getGoldxPulseAgreementStatusHandler);
router.post('/agreement', authenticate, requireGoldxPulseAccess, acceptGoldxPulseAgreementHandler);

export default router;
