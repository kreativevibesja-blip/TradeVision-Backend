import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateCoupon } from '../controllers/couponController';

const router = Router();

router.post('/validate', authenticate, validateCoupon);

export default router;
