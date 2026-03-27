import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import {
  createPricingPlan,
  getDashboardStats,
  getAdminAnalysisById,
  getUsers,
  updateUser,
  getAnalysisLogs,
  getPayments,
  updatePaymentStatus,
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
import { getAdminTickets, getOpenTicketCount, updateAdminTicket, replyToTicket } from '../controllers/ticketController';
import { getCoupons, createCoupon, toggleCoupon, deleteCoupon } from '../controllers/couponController';
import {
  getAdminReferralDashboard,
  getAdminReferrals,
  getAdminCommissions,
  updateAdminCommission,
  getAdminPayouts,
  updateAdminPayout,
  updateReferralSettings,
} from '../controllers/adminReferralController';
import {
  getEmailCampaigns,
  getEmailCampaignById,
  createEmailCampaign,
  sendEmailCampaign,
  sendTestCampaignEmail,
  retryFailedEmails,
  getEmailTemplates,
  previewEmailTemplate,
  searchUsers,
} from '../controllers/emailCampaignController';

const router = Router();

router.get('/public-announcements', getActiveAnnouncements);
router.get('/public-pricing-plans', getPublicPricingPlans);

router.use(authenticate, requireAdmin);

router.get('/dashboard', getDashboardStats);
router.get('/users', getUsers);
router.patch('/users/:id', updateUser);
router.get('/analyses', getAnalysisLogs);
router.get('/analyses/:id', getAdminAnalysisById);
router.get('/payments', getPayments);
router.patch('/payments/:id', updatePaymentStatus);
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
router.post('/tickets/:id/reply', replyToTicket);
router.get('/coupons', getCoupons);
router.post('/coupons', createCoupon);
router.patch('/coupons/:id/toggle', toggleCoupon);
router.delete('/coupons/:id', deleteCoupon);

// Referral admin
router.get('/referrals/dashboard', getAdminReferralDashboard);
router.get('/referrals/list', getAdminReferrals);
router.get('/referrals/commissions', getAdminCommissions);
router.patch('/referrals/commissions/:id', updateAdminCommission);
router.get('/referrals/payouts', getAdminPayouts);
router.patch('/referrals/payouts/:id', updateAdminPayout);
router.post('/referrals/settings', updateReferralSettings);

// Email campaigns
router.get('/email-campaigns', getEmailCampaigns);
router.post('/email-campaigns', createEmailCampaign);
router.post('/email-campaigns/test', sendTestCampaignEmail);
router.get('/email-campaigns/:id', getEmailCampaignById);
router.post('/email-campaigns/:id/send', sendEmailCampaign);
router.post('/email-campaigns/:id/retry', retryFailedEmails);
router.get('/email-templates', getEmailTemplates);
router.get('/email-templates/:key/preview', previewEmailTemplate);
router.get('/users/search', searchUsers);

export default router;
