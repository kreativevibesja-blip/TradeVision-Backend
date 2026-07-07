import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  closeMyInstantSignal,
  createDerivInstantSignal,
  createForexInstantSignal,
  getMyActiveInstantSignal,
  getMyInstantSignals,
  refreshMyInstantSignals,
} from '../controllers/instantSignalController';

const router = Router();

router.use(authenticate);
router.post('/instant/forex', createForexInstantSignal);
router.post('/instant/deriv', createDerivInstantSignal);
router.get('/instant', getMyInstantSignals);
router.get('/instant/active', getMyActiveInstantSignal);
router.post('/instant/refresh', refreshMyInstantSignals);
router.post('/instant/:id/close', closeMyInstantSignal);

export default router;
