import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { debugBindLicenseHandler, debugGoldxHmacHandler } from '../controllers/goldxController';

const router = Router();

router.post('/bind-license', authenticate, requireAdmin, debugBindLicenseHandler);
router.post('/goldx-hmac', authenticate, requireAdmin, debugGoldxHmacHandler);

export default router;