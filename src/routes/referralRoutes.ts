import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getMyReferralCode,
  updateMyReferralCode,
  getReferralDashboard,
  requestPayout,
  validateReferralCode,
  applyReferralCode,
} from '../controllers/referralController';

const router = Router();

router.use(authenticate);

router.get('/my-code', getMyReferralCode);
router.patch('/my-code', updateMyReferralCode);
router.get('/dashboard', getReferralDashboard);
router.post('/request-payout', requestPayout);
router.post('/validate-code', validateReferralCode);
router.post('/apply-code', applyReferralCode);

export default router;
