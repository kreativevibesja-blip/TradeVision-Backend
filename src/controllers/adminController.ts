import { Request, Response } from 'express';
import prisma from '../config/database';

export const getDashboardStats = async (_req: Request, res: Response) => {
  try {
    const [totalUsers, activeSubscribers, totalAnalyses, payments] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { subscription: 'PRO' } }),
      prisma.analysis.count(),
      prisma.payment.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
    ]);

    return res.json({
      totalUsers,
      activeSubscribers,
      totalAnalyses,
      totalRevenue: payments._sum.amount || 0,
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
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          subscription: true,
          banned: true,
          dailyUsage: true,
          createdAt: true,
          _count: { select: { analyses: true, payments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

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

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(subscription && { subscription }),
        ...(typeof banned === 'boolean' && { banned }),
        ...(role && { role }),
      },
      select: { id: true, email: true, subscription: true, banned: true, role: true },
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
    const skip = (page - 1) * limit;

    const [analyses, total] = await Promise.all([
      prisma.analysis.findMany({
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.analysis.count(),
    ]);

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
    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        include: { user: { select: { email: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.payment.count(),
    ]);

    return res.json({ payments, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Admin payments error:', error);
    return res.status(500).json({ error: 'Failed to get payments' });
  }
};

export const getAnalytics = async (_req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [userGrowth, analysesPerDay, revenueData] = await Promise.all([
      prisma.user.groupBy({
        by: ['createdAt'],
        _count: true,
        where: { createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.analysis.groupBy({
        by: ['createdAt'],
        _count: true,
        where: { createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.payment.groupBy({
        by: ['createdAt'],
        _sum: { amount: true },
        where: { createdAt: { gte: thirtyDaysAgo }, status: 'COMPLETED' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return res.json({ userGrowth, analysesPerDay, revenueData });
  } catch (error) {
    console.error('Admin analytics error:', error);
    return res.status(500).json({ error: 'Failed to get analytics' });
  }
};

export const getPricingPlans = async (_req: Request, res: Response) => {
  try {
    const plans = await prisma.pricingPlan.findMany({ orderBy: { price: 'asc' } });
    return res.json({ plans });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get pricing plans' });
  }
};

export const updatePricingPlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { price, features, dailyLimit, isActive } = req.body;

    const plan = await prisma.pricingPlan.update({
      where: { id },
      data: {
        ...(price !== undefined && { price }),
        ...(features && { features }),
        ...(dailyLimit !== undefined && { dailyLimit }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });

    return res.json({ plan });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update pricing plan' });
  }
};

export const getSystemSettings = async (_req: Request, res: Response) => {
  try {
    const settings = await prisma.systemSettings.findMany();
    return res.json({ settings });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get settings' });
  }
};

export const updateSystemSetting = async (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    const setting = await prisma.systemSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    return res.json({ setting });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update setting' });
  }
};

export const getAnnouncements = async (_req: Request, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: 'desc' } });
    return res.json({ announcements });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to get announcements' });
  }
};

export const createAnnouncement = async (req: Request, res: Response) => {
  try {
    const { title, content } = req.body;
    const announcement = await prisma.announcement.create({ data: { title, content } });
    return res.json({ announcement });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create announcement' });
  }
};

export const updateAnnouncement = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, content, isActive } = req.body;
    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        ...(title && { title }),
        ...(content && { content }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });
    return res.json({ announcement });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update announcement' });
  }
};
