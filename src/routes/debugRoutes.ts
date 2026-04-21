import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { debugBindLicenseHandler } from '../controllers/goldxController';

const router = Router();

router.post('/bind-license', authenticate, requireAdmin, debugBindLicenseHandler);

export default router;