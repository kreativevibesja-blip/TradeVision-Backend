import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  getDashboardStats,
  getUsers,
  updateUser,
  getAnalysisLogs,
  getPayments,
  getAnalytics,
  getPricingPlans,
  updatePricingPlan,
  getSystemSettings,
  updateSystemSetting,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
} from '../controllers/adminController';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/dashboard', getDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id', updateUser);
router.get('/analyses', getAnalysisLogs);
router.get('/payments', getPayments);
router.get('/analytics', getAnalytics);
router.get('/pricing-plans', getPricingPlans);
router.patch('/pricing-plans/:id', updatePricingPlan);
router.get('/settings', getSystemSettings);
router.post('/settings', updateSystemSetting);
router.get('/announcements', getAnnouncements);
router.post('/announcements', createAnnouncement);
router.patch('/announcements/:id', updateAnnouncement);

export default router;
