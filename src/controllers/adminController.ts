import { Request, Response } from 'express';
import {
  countAnalyses,
  countUsers,
  createPricingPlan as createPricingPlanRecord,
  deleteAnnouncementRecord,
  deleteAnnouncementRecords,
  deletePricingPlan as deletePricingPlanRecord,
  getAnalysisById,
  getAnalyticsBuckets,
  getCompletedRevenue,
  getPaymentById,
  listAllAnalysesPage,
  listActiveAnnouncements,
  listAllPaymentsPage,
  listAnnouncements,
  listPricingPlans,
  listSystemSettings,
  listUsersPage,
  updateAnnouncementRecord,
  updatePricingPlan as updatePricingPlanRecord,
  updateUser as updateUserRecord,
  upsertSystemSetting,
  createAnnouncementRecord,
  type AnnouncementContentPayload,
  type AnnouncementRecord,
  type PaymentMethod,
  updatePaymentById,
} from '../lib/supabase';
import { serializeAnalysis } from './analysisController';
import { setBillingStateFromAdmin } from '../services/billing';
import { setBillingStateFromPayment } from '../services/billing';
import { processReferralPayment } from '../services/referralService';

const ANNOUNCEMENT_CONTENT_VERSION = 1;

const parseAnnouncementContent = (content: string): AnnouncementContentPayload => {
  try {
    const parsed = JSON.parse(content) as { version?: number; body?: unknown; expiresAt?: unknown };

    if (parsed.version === ANNOUNCEMENT_CONTENT_VERSION && typeof parsed.body === 'string') {
      return {
        body: parsed.body,
        expiresAt: typeof parsed.expiresAt === 'string' && parsed.expiresAt.trim().length > 0 ? parsed.expiresAt : null,
      };
    }
  } catch {
  }

  return {
    body: content,
    expiresAt: null,
  };
};

const serializeAnnouncementContent = (payload: AnnouncementContentPayload) =>
  JSON.stringify({
    version: ANNOUNCEMENT_CONTENT_VERSION,
    body: payload.body,
    expiresAt: payload.expiresAt,
  });

const mapAnnouncementRecord = (announcement: AnnouncementRecord) => {
  const parsedContent = parseAnnouncementContent(announcement.content);
  const expiresAt = parsedContent.expiresAt;
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  return {
    ...announcement,
    content: parsedContent.body,
    expiresAt,
    isExpired,
  };
};

const cleanupExpiredAnnouncements = async (announcements: AnnouncementRecord[]) => {
  const expiredIds = announcements
    .filter((announcement) => {
      const { expiresAt } = parseAnnouncementContent(announcement.content);
      return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());
    })
    .map((announcement) => announcement.id);

  if (expiredIds.length > 0) {
    await deleteAnnouncementRecords(expiredIds);
  }

  return announcements.filter((announcement) => !expiredIds.includes(announcement.id));
};

const getExpiryFromRequest = (durationValue: unknown, durationUnit: unknown) => {
  if (durationValue === undefined || durationValue === null || durationValue === '') {
    return null;
  }

  const parsedValue = Number(durationValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  const unit = typeof durationUnit === 'string' && durationUnit.toLowerCase() === 'days' ? 'days' : 'hours';
  const expiresAt = new Date();

  if (unit === 'days') {
    expiresAt.setHours(expiresAt.getHours() + parsedValue * 24);
  } else {
    expiresAt.setHours(expiresAt.getHours() + parsedValue);
  }

  return expiresAt.toISOString();
};

export const getDashboardStats = async (_req: Request, res: Response) => {
  try {
    const [totalUsers, activeSubscribers, totalAnalyses, payments] = await Promise.all([
      countUsers(),
      countUsers('PRO'),
      countAnalyses(),
      getCompletedRevenue(),
    ]);

    return res.json({
      totalUsers,
      activeSubscribers,
      totalAnalyses,
      totalRevenue: payments || 0,
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    return res.status(500).json({ error: 'Failed to get stats' });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { users, total } = await listUsersPage(search, page, limit);

    return res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Failed to get users' });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { subscription, banned, role } = req.body;

    let user = await updateUserRecord(id, {
      ...(subscription && { subscription }),
      ...(typeof banned === 'boolean' ? { banned } : {}),
      ...(role && { role }),
    });

    if (subscription === 'FREE' || subscription === 'PRO') {
      await setBillingStateFromAdmin(id, subscription);
      user = {
        ...user,
        subscription,
      };
    }

    return res.json({ user });
  } catch (error) {
    console.error('Admin update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
};

export const getAnalysisLogs = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const { analyses, total } = await listAllAnalysesPage(page, limit, search);

    return res.json({ analyses, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin analysis logs error:', error);
    return res.status(500).json({ error: 'Failed to get analysis logs' });
  }
};

export const getAdminAnalysisById = async (req: Request, res: Response) => {
  try {
    const analysis = await getAnalysisById(req.params.id);

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    return res.json({ analysis: serializeAnalysis(analysis) });
  } catch (error) {
    console.error('Admin analysis detail error:', error);
    return res.status(500).json({ error: 'Failed to get analysis' });
  }
};

export const getPayments = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const plan = req.query.plan === 'FREE' || req.query.plan === 'PRO' ? req.query.plan : undefined;
    const status = req.query.status === 'PENDING' || req.query.status === 'COMPLETED' || req.query.status === 'FAILED' || req.query.status === 'REFUNDED'
      ? req.query.status
      : undefined;
    const paymentMethod = req.query.paymentMethod === 'PAYPAL' || req.query.paymentMethod === 'CARD' || req.query.paymentMethod === 'BANK_TRANSFER' || req.query.paymentMethod === 'COUPON'
      ? req.query.paymentMethod as PaymentMethod
      : undefined;
    const dateRange = typeof req.query.dateRange === 'string' ? req.query.dateRange : 'all';

    const createdAfter = (() => {
      if (dateRange === 'all') {
        return undefined;
      }

      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : null;
      if (!days) {
        return undefined;
      }

      const since = new Date();
      since.setDate(since.getDate() - days);
      return since.toISOString();
    })();

    const { payments, total } = await listAllPaymentsPage(page, limit, {
      plan,
      status,
      paymentMethod,
      createdAfter,
    });

    return res.json({ payments, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin payments error:', error);
    return res.status(500).json({ error: 'Failed to get payments' });
  }
};

export const updatePaymentStatus = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (status !== 'COMPLETED' && status !== 'FAILED') {
      return res.status(400).json({ error: 'Invalid payment status' });
    }

    const existingPayment = await getPaymentById(id);
    if (!existingPayment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const now = new Date().toISOString();
    const payment = await updatePaymentById(id, {
      status,
      verifiedAt: status === 'COMPLETED' ? now : null,
    });

    if (existingPayment.status !== 'COMPLETED' && status === 'COMPLETED') {
      await setBillingStateFromPayment(payment.userId, now);
      await processReferralPayment(payment.userId, payment.amount ?? 0).catch((error) => {
        console.error('Failed to process referral payment from admin approval:', error);
      });
    }

    return res.json({ payment });
  } catch (error) {
    console.error('Admin payment update error:', error);
    return res.status(500).json({ error: 'Failed to update payment' });
  }
};

const parseDateRange = (value: unknown, endOfDay = false) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = new Date(value.includes('T') ? value : `${value}${suffix}`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const fromQuery = parseDateRange(req.query.from, false);
    const toQuery = parseDateRange(req.query.to, true);

    const defaultFrom = new Date();
    defaultFrom.setDate(defaultFrom.getDate() - 30);
    defaultFrom.setHours(0, 0, 0, 0);

    const fromDate = fromQuery || defaultFrom;
    const toDate = toQuery || new Date();

    if (fromDate > toDate) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    const { userGrowth, analysesPerDay, revenueData } = await getAnalyticsBuckets(fromDate.toISOString(), toDate.toISOString());

    return res.json({
      userGrowth,
      analysesPerDay,
      revenueData,
      range: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
    });
  } catch (error) {
    console.error('Admin analytics error:', error);
    return res.status(500).json({ error: 'Failed to get analytics' });
  }
};

export const getPricingPlans = async (_req: Request, res: Response) => {
  try {
    const plans = await listPricingPlans();
    return res.json({ plans });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get pricing plans' });
  }
};

export const getPublicPricingPlans = async (_req: Request, res: Response) => {
  try {
    const plans = await listPricingPlans();
    return res.json({ plans: plans.filter((plan) => plan.isActive) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get pricing plans' });
  }
};

export const updatePricingPlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, tier, price, features, dailyLimit, isActive } = req.body;

    const plan = await updatePricingPlanRecord(id, {
      ...(name ? { name } : {}),
      ...(tier ? { tier } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(features ? { features } : {}),
      ...(dailyLimit !== undefined ? { dailyLimit } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    });

    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update pricing plan' });
  }
};

export const createPricingPlan = async (req: Request, res: Response) => {
  try {
    const { name, tier, price, features, dailyLimit, isActive } = req.body;

    const plan = await createPricingPlanRecord({
      name,
      tier,
      price,
      features: Array.isArray(features) ? features : [],
      dailyLimit,
      isActive: typeof isActive === 'boolean' ? isActive : true,
    });

    return res.status(201).json({ plan });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create pricing plan' });
  }
};

export const deletePricingPlan = async (req: Request, res: Response) => {
  try {
    await deletePricingPlanRecord(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete pricing plan' });
  }
};

export const getSystemSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await listSystemSettings();
    return res.json({ settings });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get settings' });
  }
};

export const updateSystemSetting = async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    const setting = await upsertSystemSetting(key, value);
    return res.json({ setting });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update setting' });
  }
};

export const getAnnouncements = async (_req: Request, res: Response) => {
  try {
    const announcements = await cleanupExpiredAnnouncements(await listAnnouncements());
    return res.json({ announcements: announcements.map(mapAnnouncementRecord) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get announcements' });
  }
};

export const getActiveAnnouncements = async (_req: Request, res: Response) => {
  try {
    const announcements = await cleanupExpiredAnnouncements(await listActiveAnnouncements());
    return res.json({ announcements: announcements.map(mapAnnouncementRecord) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get active announcements' });
  }
};

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    const { title, content, durationValue, durationUnit } = req.body;
    const announcement = await createAnnouncementRecord({
      title,
      content: serializeAnnouncementContent({
        body: content,
        expiresAt: getExpiryFromRequest(durationValue, durationUnit),
      }),
    });
    return res.json({ announcement: mapAnnouncementRecord(announcement) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, isActive, durationValue, durationUnit, clearExpiry } = req.body;
    const nextContent =
      typeof content === 'string' || durationValue !== undefined || clearExpiry
        ? serializeAnnouncementContent({
            body: typeof content === 'string' ? content : '',
            expiresAt: clearExpiry ? null : getExpiryFromRequest(durationValue, durationUnit),
          })
        : undefined;
    const announcement = await updateAnnouncementRecord(id, {
      ...(title ? { title } : {}),
      ...(nextContent ? { content: nextContent } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    });
    return res.json({ announcement: mapAnnouncementRecord(announcement) });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update announcement' });
  }
};

export const deleteAnnouncement = async (req: Request, res: Response) => {
  try {
    await deleteAnnouncementRecord(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete announcement' });
  }
};
