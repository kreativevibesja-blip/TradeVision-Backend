"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAnnouncement = exports.createAnnouncement = exports.getAnnouncements = exports.updateSystemSetting = exports.getSystemSettings = exports.updatePricingPlan = exports.getPricingPlans = exports.getAnalytics = exports.getPayments = exports.getAnalysisLogs = exports.updateUser = exports.getUsers = exports.getDashboardStats = void 0;
const database_1 = __importDefault(require("../config/database"));
const getDashboardStats = async (_req, res) => {
    try {
        const [totalUsers, activeSubscribers, totalAnalyses, payments] = await Promise.all([
            database_1.default.user.count(),
            database_1.default.user.count({ where: { subscription: 'PRO' } }),
            database_1.default.analysis.count(),
            database_1.default.payment.aggregate({
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
    }
    catch (error) {
        console.error('Admin dashboard error:', error);
        return res.status(500).json({ error: 'Failed to get stats' });
    }
};
exports.getDashboardStats = getDashboardStats;
const getUsers = async (req, res) => {
    try {
        const search = req.query.search;
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = (page - 1) * limit;
        const where = search
            ? {
                OR: [
                    { email: { contains: search, mode: 'insensitive' } },
                    { name: { contains: search, mode: 'insensitive' } },
                ],
            }
            : {};
        const [users, total] = await Promise.all([
            database_1.default.user.findMany({
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
            database_1.default.user.count({ where }),
        ]);
        return res.json({ users, total, page, pages: Math.ceil(total / limit) });
    }
    catch (error) {
        console.error('Admin users error:', error);
        return res.status(500).json({ error: 'Failed to get users' });
    }
};
exports.getUsers = getUsers;
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { subscription, banned, role } = req.body;
        const user = await database_1.default.user.update({
            where: { id },
            data: {
                ...(subscription && { subscription }),
                ...(typeof banned === 'boolean' && { banned }),
                ...(role && { role }),
            },
            select: { id: true, email: true, subscription: true, banned: true, role: true },
        });
        return res.json({ user });
    }
    catch (error) {
        console.error('Admin update user error:', error);
        return res.status(500).json({ error: 'Failed to update user' });
    }
};
exports.updateUser = updateUser;
const getAnalysisLogs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = (page - 1) * limit;
        const [analyses, total] = await Promise.all([
            database_1.default.analysis.findMany({
                include: { user: { select: { email: true, name: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            database_1.default.analysis.count(),
        ]);
        return res.json({ analyses, total, page, pages: Math.ceil(total / limit) });
    }
    catch (error) {
        console.error('Admin analysis logs error:', error);
        return res.status(500).json({ error: 'Failed to get analysis logs' });
    }
};
exports.getAnalysisLogs = getAnalysisLogs;
const getPayments = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const skip = (page - 1) * limit;
        const [payments, total] = await Promise.all([
            database_1.default.payment.findMany({
                include: { user: { select: { email: true, name: true } } },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            database_1.default.payment.count(),
        ]);
        return res.json({ payments, total, page, pages: Math.ceil(total / limit) });
    }
    catch (error) {
        console.error('Admin payments error:', error);
        return res.status(500).json({ error: 'Failed to get payments' });
    }
};
exports.getPayments = getPayments;
const getAnalytics = async (_req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const [userGrowth, analysesPerDay, revenueData] = await Promise.all([
            database_1.default.user.groupBy({
                by: ['createdAt'],
                _count: true,
                where: { createdAt: { gte: thirtyDaysAgo } },
                orderBy: { createdAt: 'asc' },
            }),
            database_1.default.analysis.groupBy({
                by: ['createdAt'],
                _count: true,
                where: { createdAt: { gte: thirtyDaysAgo } },
                orderBy: { createdAt: 'asc' },
            }),
            database_1.default.payment.groupBy({
                by: ['createdAt'],
                _sum: { amount: true },
                where: { createdAt: { gte: thirtyDaysAgo }, status: 'COMPLETED' },
                orderBy: { createdAt: 'asc' },
            }),
        ]);
        return res.json({ userGrowth, analysesPerDay, revenueData });
    }
    catch (error) {
        console.error('Admin analytics error:', error);
        return res.status(500).json({ error: 'Failed to get analytics' });
    }
};
exports.getAnalytics = getAnalytics;
const getPricingPlans = async (_req, res) => {
    try {
        const plans = await database_1.default.pricingPlan.findMany({ orderBy: { price: 'asc' } });
        return res.json({ plans });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to get pricing plans' });
    }
};
exports.getPricingPlans = getPricingPlans;
const updatePricingPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { price, features, dailyLimit, isActive } = req.body;
        const plan = await database_1.default.pricingPlan.update({
            where: { id },
            data: {
                ...(price !== undefined && { price }),
                ...(features && { features }),
                ...(dailyLimit !== undefined && { dailyLimit }),
                ...(typeof isActive === 'boolean' && { isActive }),
            },
        });
        return res.json({ plan });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update pricing plan' });
    }
};
exports.updatePricingPlan = updatePricingPlan;
const getSystemSettings = async (_req, res) => {
    try {
        const settings = await database_1.default.systemSettings.findMany();
        return res.json({ settings });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to get settings' });
    }
};
exports.getSystemSettings = getSystemSettings;
const updateSystemSetting = async (req, res) => {
    try {
        const { key, value } = req.body;
        const setting = await database_1.default.systemSettings.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        return res.json({ setting });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update setting' });
    }
};
exports.updateSystemSetting = updateSystemSetting;
const getAnnouncements = async (_req, res) => {
    try {
        const announcements = await database_1.default.announcement.findMany({ orderBy: { createdAt: 'desc' } });
        return res.json({ announcements });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to get announcements' });
    }
};
exports.getAnnouncements = getAnnouncements;
const createAnnouncement = async (req, res) => {
    try {
        const { title, content } = req.body;
        const announcement = await database_1.default.announcement.create({ data: { title, content } });
        return res.json({ announcement });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to create announcement' });
    }
};
exports.createAnnouncement = createAnnouncement;
const updateAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content, isActive } = req.body;
        const announcement = await database_1.default.announcement.update({
            where: { id },
            data: {
                ...(title && { title }),
                ...(content && { content }),
                ...(typeof isActive === 'boolean' && { isActive }),
            },
        });
        return res.json({ announcement });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update announcement' });
    }
};
exports.updateAnnouncement = updateAnnouncement;
//# sourceMappingURL=adminController.js.map