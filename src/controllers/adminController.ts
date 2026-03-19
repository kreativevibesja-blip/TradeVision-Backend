import { Request, Response } from 'express';
import {
  countAnalyses,
  countUsers,
  getAnalyticsBuckets,
  getCompletedRevenue,
  listAllAnalysesPage,
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
} from '../lib/supabase';

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

    const user = await updateUserRecord(id, {
      ...(subscription && { subscription }),
      ...(typeof banned === 'boolean' ? { banned } : {}),
      ...(role && { role }),
    });

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

    const { analyses, total } = await listAllAnalysesPage(page, limit);

    return res.json({ analyses, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin analysis logs error:', error);
    return res.status(500).json({ error: 'Failed to get analysis logs' });
  }
};

export const getPayments = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const { payments, total } = await listAllPaymentsPage(page, limit);

    return res.json({ payments, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin payments error:', error);
    return res.status(500).json({ error: 'Failed to get payments' });
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

export const updatePricingPlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { price, features, dailyLimit, isActive } = req.body;

    const plan = await updatePricingPlanRecord(id, {
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
    const announcements = await listAnnouncements();
    return res.json({ announcements });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get announcements' });
  }
};

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    const { title, content } = req.body;
    const announcement = await createAnnouncementRecord({ title, content });
    return res.json({ announcement });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, isActive } = req.body;
    const announcement = await updateAnnouncementRecord(id, {
      ...(title ? { title } : {}),
      ...(content ? { content } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
    });
    return res.json({ announcement });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update announcement' });
  }
};
