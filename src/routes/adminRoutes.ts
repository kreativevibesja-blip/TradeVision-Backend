import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  createPricingPlan,
  getDashboardStats,
  getUsers,
  updateUser,
  getAnalysisLogs,
  getPayments,
  getAnalytics,
  getPricingPlans,
  getPublicPricingPlans,
  updatePricingPlan,
  deletePricingPlan,
  getSystemSettings,
  updateSystemSetting,
  getAnnouncements,
  getActiveAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/adminController';
import { getAdminTickets, getOpenTicketCount, updateAdminTicket } from '../controllers/ticketController';

const router = Router();

router.get('/public-announcements', getActiveAnnouncements);
router.get('/public-pricing-plans', getPublicPricingPlans);

router.use(authenticate, requireAdmin);

router.get('/dashboard', getDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id', updateUser);
router.get('/analyses', getAnalysisLogs);
router.get('/payments', getPayments);
router.get('/analytics', getAnalytics);
router.get('/pricing-plans', getPricingPlans);
router.post('/pricing-plans', createPricingPlan);
router.patch('/pricing-plans/:id', updatePricingPlan);
router.delete('/pricing-plans/:id', deletePricingPlan);
router.get('/settings', getSystemSettings);
router.post('/settings', updateSystemSetting);
router.get('/announcements', getAnnouncements);
router.post('/announcements', createAnnouncement);
router.patch('/announcements/:id', updateAnnouncement);
router.delete('/announcements/:id', deleteAnnouncement);
router.get('/tickets', getAdminTickets);
router.get('/tickets/count', getOpenTicketCount);
router.patch('/tickets/:id', updateAdminTicket);

export default router;
