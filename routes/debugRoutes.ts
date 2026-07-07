import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { debugBindLicenseHandler, debugGoldxHmacHandler } from '../controllers/goldxController';
import { getClientEgressMetrics, ingestClientEgressMetrics } from '../controllers/debugTelemetryController';

const router = Router();

router.post('/bind-license', authenticate, requireAdmin, debugBindLicenseHandler);
router.post('/goldx-hmac', authenticate, requireAdmin, debugGoldxHmacHandler);
router.post('/client-egress', authenticate, ingestClientEgressMetrics);
router.get('/client-egress', authenticate, requireAdmin, getClientEgressMetrics);

export default router;