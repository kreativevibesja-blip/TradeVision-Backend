"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateAnnouncement = exports.createAnnouncement = exports.getAnnouncements = exports.updateSystemSetting = exports.getSystemSettings = exports.updatePricingPlan = exports.getPricingPlans = exports.getAnalytics = exports.getPayments = exports.getAnalysisLogs = exports.updateUser = exports.getUsers = exports.getDashboardStats = void 0;
const supabase_1 = require("../lib/supabase");
const getDashboardStats = async (_req, res) => {
    try {
        const [totalUsers, activeSubscribers, totalAnalyses, payments] = await Promise.all([
            (0, supabase_1.countUsers)(),
            (0, supabase_1.countUsers)('PRO'),
            (0, supabase_1.countAnalyses)(),
            (0, supabase_1.getCompletedRevenue)(),
        ]);
        return res.json({
            totalUsers,
            activeSubscribers,
            totalAnalyses,
            totalRevenue: payments || 0,
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
        const { users, total } = await (0, supabase_1.listUsersPage)(search, page, limit);
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
        const user = await (0, supabase_1.updateUser)(id, {
            ...(subscription && { subscription }),
            ...(typeof banned === 'boolean' ? { banned } : {}),
            ...(role && { role }),
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
        const { analyses, total } = await (0, supabase_1.listAllAnalysesPage)(page, limit);
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
        const { payments, total } = await (0, supabase_1.listAllPaymentsPage)(page, limit);
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
        const { userGrowth, analysesPerDay, revenueData } = await (0, supabase_1.getAnalyticsBuckets)(thirtyDaysAgo.toISOString());
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
        const plans = await (0, supabase_1.listPricingPlans)();
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
        const plan = await (0, supabase_1.updatePricingPlan)(id, {
            ...(price !== undefined ? { price } : {}),
            ...(features ? { features } : {}),
            ...(dailyLimit !== undefined ? { dailyLimit } : {}),
            ...(typeof isActive === 'boolean' ? { isActive } : {}),
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
        const settings = await (0, supabase_1.listSystemSettings)();
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
        const setting = await (0, supabase_1.upsertSystemSetting)(key, value);
        return res.json({ setting });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update setting' });
    }
};
exports.updateSystemSetting = updateSystemSetting;
const getAnnouncements = async (_req, res) => {
    try {
        const announcements = await (0, supabase_1.listAnnouncements)();
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
        const announcement = await (0, supabase_1.createAnnouncementRecord)({ title, content });
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
        const announcement = await (0, supabase_1.updateAnnouncementRecord)(id, {
            ...(title ? { title } : {}),
            ...(content ? { content } : {}),
            ...(typeof isActive === 'boolean' ? { isActive } : {}),
        });
        return res.json({ announcement });
    }
    catch (error) {
        return res.status(500).json({ error: 'Failed to update announcement' });
    }
};
exports.updateAnnouncement = updateAnnouncement;
//# sourceMappingURL=adminController.js.map