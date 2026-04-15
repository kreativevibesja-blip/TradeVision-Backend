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
  getLivePlatformMetrics,
  getPaymentById,
  getSystemSetting,
  getUserById,
  listAllAnalysesPage,
  listActiveAnnouncements,
  listAllPaymentsPage,
  listAnnouncements,
  listPricingPlans,
  listSystemSettings,
  listTicketsForUser,
  listUsersPage,
  updateAnnouncementRecord,
  updatePricingPlan as updatePricingPlanRecord,
  updateUser as updateUserRecord,
  upsertSystemSetting,
  createAnnouncementRecord,
  type AnnouncementContentPayload,
  type AnnouncementRecord,
  type AnnouncementType,
  type PaymentMethod,
  updatePaymentById,
} from '../lib/supabase';
import { serializeAnalysis } from './analysisController';
import { setBillingStateFromAdmin } from '../services/billing';
import { getBillingSummaryForUser } from '../services/billing';
import { setBillingStateFromPayment } from '../services/billing';
import { processReferralPayment } from '../services/referralService';
import { sendPaymentReminderEmail } from '../services/paymentReminderEmail';

const ANNOUNCEMENT_CONTENT_VERSION = 1;
const DEFAULT_SUPPORT_WHATSAPP_NUMBER = '18762797956';
const DEFAULT_SUPPORT_WHATSAPP_MESSAGE = 'Hi TradeVision AI, I need support.';

const VALID_ANNOUNCEMENT_TYPES: AnnouncementType[] = ['update', 'maintenance', 'discount', 'new_feature', 'security', 'event'];

const parseAnnouncementContent = (content: string): AnnouncementContentPayload => {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    if (parsed.version === ANNOUNCEMENT_CONTENT_VERSION && typeof parsed.body === 'string') {
      return {
        body: parsed.body,
        expiresAt: typeof parsed.expiresAt === 'string' && parsed.expiresAt.trim().length > 0 ? parsed.expiresAt : null,
        type: VALID_ANNOUNCEMENT_TYPES.includes(parsed.type as AnnouncementType) ? (parsed.type as AnnouncementType) : undefined,
        couponCode: typeof parsed.couponCode === 'string' && parsed.couponCode.trim().length > 0 ? parsed.couponCode : null,
        targetPlan: parsed.targetPlan === 'PRO' || parsed.targetPlan === 'TOP_TIER' ? parsed.targetPlan : null,
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
    type: payload.type || null,
    couponCode: payload.couponCode || null,
    targetPlan: payload.targetPlan || null,
  });

const JAMAICA_UTC_OFFSET_HOURS = 5;

const getJamaicaTodayDate = () => {
  const now = new Date(Date.now() - JAMAICA_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
};

const getJamaicaDayStartIso = (dateValue = getJamaicaTodayDate()) => {
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, JAMAICA_UTC_OFFSET_HOURS, 0, 0, 0)).toISOString();
};

const getActiveVisitorSinceIso = () => new Date(Date.now() - 5 * 60 * 1000).toISOString();

const mapAnnouncementRecord = (announcement: AnnouncementRecord) => {
  const parsedContent = parseAnnouncementContent(announcement.content);
  const expiresAt = parsedContent.expiresAt;
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  return {
    ...announcement,
    content: parsedContent.body,
    expiresAt,
    isExpired,
    type: parsedContent.type || 'update',
    couponCode: parsedContent.couponCode || null,
    targetPlan: parsedContent.targetPlan || null,
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
    const jamaicaToday = getJamaicaTodayDate();
    const [totalUsers, proSubscribers, topTierSubscribers, totalAnalyses, payments, liveMetrics] = await Promise.all([
      countUsers(),
      countUsers('PRO'),
      countUsers('TOP_TIER'),
      countAnalyses(),
      getCompletedRevenue(),
      getLivePlatformMetrics(jamaicaToday, getJamaicaDayStartIso(jamaicaToday), getActiveVisitorSinceIso()),
    ]);

    return res.json({
      totalUsers,
      activeSubscribers: proSubscribers + topTierSubscribers,
      totalAnalyses,
      totalRevenue: payments || 0,
      liveMetrics,
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
    const subscription = req.query.subscription === 'FREE' || req.query.subscription === 'PRO' || req.query.subscription === 'TOP_TIER' || req.query.subscription === 'VIP_AUTO_TRADER'
      ? req.query.subscription
      : undefined;
    const createdFrom = typeof req.query.createdFrom === 'string' && req.query.createdFrom.trim().length > 0
      ? req.query.createdFrom
      : undefined;
    const createdTo = typeof req.query.createdTo === 'string' && req.query.createdTo.trim().length > 0
      ? req.query.createdTo
      : undefined;

    const { users, total } = await listUsersPage(search, page, limit, {
      subscription,
      createdFrom,
      createdTo,
    });

    return res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ error: 'Failed to get users' });
  }
};

export const getUserDetails = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [billingSummary, ticketData] = await Promise.all([
      getBillingSummaryForUser(user.id, user.subscription),
      listTicketsForUser(user.id, 1, 20),
    ]);

    const openTickets = ticketData.tickets
      .filter((ticket) => ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED')
      .slice(0, 5);

    return res.json({
      user: {
        id: user.id,
        billing: {
          currentPlan: billingSummary.currentPlan,
          status: billingSummary.status,
          expiresAt: billingSummary.expiresAt,
          lastPaymentAt: billingSummary.lastPaymentAt,
          canceledAt: billingSummary.canceledAt,
          recentPayments: billingSummary.recentPayments,
        },
        openTickets,
        openTicketCount: openTickets.length,
      },
    });
  } catch (error) {
    console.error('Admin user details error:', error);
    return res.status(500).json({ error: 'Failed to get user details' });
  }
};

export const resetUserUsage = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const now = new Date().toISOString();
    const updatedUser = await updateUserRecord(id, {
      lastUsageReset: now,
      ...(user.subscription === 'FREE' ? { dailyUsage: 0 } : {}),
    });

    return res.json({ user: updatedUser, resetAt: now });
  } catch (error) {
    console.error('Admin reset user usage error:', error);
    return res.status(500).json({ error: 'Failed to reset user usage' });
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

    if (subscription === 'FREE' || subscription === 'PRO' || subscription === 'TOP_TIER' || subscription === 'VIP_AUTO_TRADER') {
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
    const scope = req.query.scope === 'COMPLETED_CHECKOUTS' || req.query.scope === 'BANK_TRANSFERS' || req.query.scope === 'ALL_PAYMENTS'
      ? req.query.scope
      : undefined;
    const plan = req.query.plan === 'FREE' || req.query.plan === 'PRO' || req.query.plan === 'TOP_TIER' || req.query.plan === 'VIP_AUTO_TRADER' ? req.query.plan : undefined;
    const requestedStatus = req.query.status === 'PENDING' || req.query.status === 'COMPLETED' || req.query.status === 'FAILED' || req.query.status === 'REFUNDED'
      ? req.query.status
      : undefined;
    const requestedPaymentMethod = req.query.paymentMethod === 'PAYPAL' || req.query.paymentMethod === 'CARD' || req.query.paymentMethod === 'BANK_TRANSFER' || req.query.paymentMethod === 'COUPON'
      ? req.query.paymentMethod as PaymentMethod
      : undefined;
    const dateRange = typeof req.query.dateRange === 'string' ? req.query.dateRange : 'all';

    const status = scope === 'COMPLETED_CHECKOUTS' ? 'COMPLETED' : requestedStatus;
    const paymentMethod = scope === 'BANK_TRANSFERS' ? 'BANK_TRANSFER' : scope === 'ALL_PAYMENTS' ? undefined : requestedPaymentMethod;
    const paymentMethods = scope === 'COMPLETED_CHECKOUTS' ? ['PAYPAL', 'CARD'] as PaymentMethod[] : undefined;

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
      paymentMethods,
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
      await setBillingStateFromPayment(payment.userId, now, payment.plan === 'TOP_TIER' ? 'TOP_TIER' : 'PRO');
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

export const sendPaymentReminder = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { couponCode, discountLabel } = req.body as { couponCode?: string; discountLabel?: string };

    const payment = await getPaymentById(id);
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status !== 'PENDING') {
      return res.status(400).json({ error: 'Can only send reminders for pending payments' });
    }

    const user = await getUserById(payment.userId);
    if (!user?.email) {
      return res.status(400).json({ error: 'User email not found' });
    }

    const result = await sendPaymentReminderEmail({
      to: user.email,
      userName: user.name || 'Trader',
      plan: payment.plan,
      amount: payment.amount,
      couponCode: couponCode || undefined,
      discountLabel: discountLabel || undefined,
      isBankTransfer: payment.paymentMethod === 'BANK_TRANSFER',
    });

    if (!result.ok) {
      return res.status(502).json({ error: result.error || 'Failed to send email' });
    }

    return res.json({ success: true, message: `Reminder sent to ${user.email}` });
  } catch (error) {
    console.error('Admin send payment reminder error:', error);
    return res.status(500).json({ error: 'Failed to send reminder' });
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

    const jamaicaToday = getJamaicaTodayDate();
    const [{ userGrowth, analysesPerDay, revenueData }, liveMetrics] = await Promise.all([
      getAnalyticsBuckets(fromDate.toISOString(), toDate.toISOString()),
      getLivePlatformMetrics(jamaicaToday, getJamaicaDayStartIso(jamaicaToday), getActiveVisitorSinceIso()),
    ]);

    return res.json({
      userGrowth,
      analysesPerDay,
      revenueData,
      liveMetrics,
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

export const getPublicSupportSettings = async (_req: Request, res: Response) => {
  try {
    const [numberSetting, messageSetting] = await Promise.all([
      getSystemSetting('support_whatsapp_number'),
      getSystemSetting('support_whatsapp_message'),
    ]);

    return res.json({
      whatsappNumber: typeof numberSetting?.value === 'string' && numberSetting.value.trim().length > 0
        ? numberSetting.value.trim()
        : DEFAULT_SUPPORT_WHATSAPP_NUMBER,
      whatsappMessage: typeof messageSetting?.value === 'string' && messageSetting.value.trim().length > 0
        ? messageSetting.value.trim()
        : DEFAULT_SUPPORT_WHATSAPP_MESSAGE,
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get support settings' });
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
    const { title, content, durationValue, durationUnit, type, couponCode, targetPlan } = req.body;
    const announcementType = VALID_ANNOUNCEMENT_TYPES.includes(type) ? type : 'update';
    const announcement = await createAnnouncementRecord({
      title,
      content: serializeAnnouncementContent({
        body: content,
        expiresAt: getExpiryFromRequest(durationValue, durationUnit),
        type: announcementType,
        couponCode: announcementType === 'discount' && typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : null,
        targetPlan: announcementType === 'discount' && (targetPlan === 'PRO' || targetPlan === 'TOP_TIER') ? targetPlan : null,
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
    const { title, content, isActive, durationValue, durationUnit, clearExpiry, type, couponCode, targetPlan } = req.body;
    const announcementType = VALID_ANNOUNCEMENT_TYPES.includes(type) ? type : undefined;
    const nextContent =
      typeof content === 'string' || durationValue !== undefined || clearExpiry || announcementType
        ? serializeAnnouncementContent({
            body: typeof content === 'string' ? content : '',
            expiresAt: clearExpiry ? null : getExpiryFromRequest(durationValue, durationUnit),
            type: announcementType,
            couponCode: announcementType === 'discount' && typeof couponCode === 'string' ? couponCode.trim().toUpperCase() : null,
            targetPlan: announcementType === 'discount' && (targetPlan === 'PRO' || targetPlan === 'TOP_TIER') ? targetPlan : null,
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
