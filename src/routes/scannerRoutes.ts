import { Router } from 'express';
import { authenticate, requireTopTier } from '../middleware/auth';
import {
  getScannerStatus,
  toggleScanner,
  triggerScan,
  getResults,
  getAlerts,
  markRead,
  getSummary,
  getPotentials,
  getReplay,
  streamScannerPanels,
  checkProximity,
  expireSession,
} from '../controllers/scannerController';

const router = Router();

router.use(authenticate, requireTopTier);

router.get('/status', getScannerStatus);
router.post('/toggle', toggleScanner);
router.post('/scan', triggerScan);
router.get('/results', getResults);
router.get('/alerts', getAlerts);
router.post('/alerts/read', markRead);
router.get('/summary', getSummary);
router.get('/potentials', getPotentials);
router.get('/results/:scanResultId/replay', getReplay);
router.get('/stream', streamScannerPanels);
router.post('/check-proximity', checkProximity);
router.post('/expire', expireSession);

export default router;
