import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  adminGetOverview,
  adminGetUserDetail,
  adminDisableUser,
} from '../controllers/autoTradingController';

const router = Router();

router.use(authenticate);

// Admin must be checked in the admin middleware already mounted upstream
router.get('/overview', adminGetOverview);
router.get('/users/:userId', adminGetUserDetail);
router.post('/users/:userId/disable', adminDisableUser);

export default router;
