import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getScannerStatus,
  toggleScanner,
  triggerScan,
  getResults,
  getAlerts,
  markRead,
  getSummary,
  checkProximity,
  expireSession,
} from '../controllers/scannerController';

const router = Router();

router.get('/status', authenticate, getScannerStatus);
router.post('/toggle', authenticate, toggleScanner);
router.post('/scan', authenticate, triggerScan);
router.get('/results', authenticate, getResults);
router.get('/alerts', authenticate, getAlerts);
router.post('/alerts/read', authenticate, markRead);
router.get('/summary', authenticate, getSummary);
router.post('/check-proximity', authenticate, checkProximity);
router.post('/expire', authenticate, expireSession);

export default router;
