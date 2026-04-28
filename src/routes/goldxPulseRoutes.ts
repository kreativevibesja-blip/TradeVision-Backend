import { Router } from 'express';
import { authenticate, requireGoldxPulseAccess } from '../middleware/auth';
import {
  connectGoldxPulseHandler,
  disconnectGoldxPulseHandler,
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

export default router;
