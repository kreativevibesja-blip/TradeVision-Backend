"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalyticsBuckets = exports.updateAnnouncementRecord = exports.createAnnouncementRecord = exports.listAnnouncements = exports.upsertSystemSetting = exports.listSystemSettings = exports.getCompletedRevenue = exports.listAllPaymentsPage = exports.listPaymentsForUserId = exports.listPaymentsForUser = exports.updatePaymentByOrderId = exports.createPaymentRecord = exports.updatePricingPlan = exports.listPricingPlans = exports.getPricingPlanByTier = exports.listAllAnalysesPage = exports.countAnalyses = exports.listAnalysesForUser = exports.getAnalysisByIdForUser = exports.getAnalysisByJobIdForUser = exports.updateAnalysis = exports.createAnalysis = exports.incrementUserDailyUsage = exports.countUsers = exports.listUsersPage = exports.updateUser = exports.createUser = exports.getUserById = exports.getUserByEmail = exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../config");
if (!config_1.config.supabase.url || !config_1.config.supabase.serviceRoleKey) {
    throw new Error('Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}
exports.supabase = (0, supabase_js_1.createClient)(config_1.config.supabase.url, config_1.config.supabase.serviceRoleKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});
const USER_TABLE = 'User';
const ANALYSIS_TABLE = 'Analysis';
const PAYMENT_TABLE = 'Payment';
const PRICING_PLAN_TABLE = 'PricingPlan';
const SYSTEM_SETTINGS_TABLE = 'SystemSettings';
const ANNOUNCEMENT_TABLE = 'Announcement';
const logDbError = (context, error) => {
    console.error(`Database error: ${context}`, error);
    throw new Error('Database operation failed');
};
const maybeSingle = async (context, query) => {
    const { data, error } = await query;
    if (error) {
        if (error.code === 'PGRST116') {
            return null;
        }
        logDbError(context, error);
    }
    return data ?? null;
};
const single = async (context, query) => {
    const value = await maybeSingle(context, query);
    if (!value) {
        throw new Error('Database operation failed');
    }
    return value;
};
const many = async (context, query) => {
    const { data, error } = await query;
    if (error) {
        logDbError(context, error);
    }
    return data ?? [];
};
const countRows = async (context, table, apply) => {
    let query = exports.supabase.from(table).select('*', { count: 'exact', head: true });
    if (apply) {
        query = apply(query);
    }
    const { count, error } = await query;
    if (error) {
        logDbError(context, error);
    }
    return count ?? 0;
};
const updateSingle = async (context, table, values, apply) => {
    const query = apply(exports.supabase.from(table).update(values).select('*'));
    return single(context, query.maybeSingle());
};
const insertSingle = async (context, table, values) => {
    return single(context, exports.supabase.from(table).insert(values).select('*').maybeSingle());
};
const normalizeSearch = (search) => search.replace(/[,]/g, ' ').trim();
const getUserByEmail = (email) => maybeSingle('getUserByEmail', exports.supabase.from(USER_TABLE).select('*').eq('email', email).maybeSingle());
exports.getUserByEmail = getUserByEmail;
const getUserById = (id) => maybeSingle('getUserById', exports.supabase.from(USER_TABLE).select('*').eq('id', id).maybeSingle());
exports.getUserById = getUserById;
const createUser = (values) => insertSingle('createUser', USER_TABLE, {
    subscription: 'FREE',
    dailyUsage: 0,
    lastUsageReset: new Date().toISOString(),
    banned: false,
    ...values,
});
exports.createUser = createUser;
const updateUser = (id, values) => updateSingle('updateUser', USER_TABLE, values, (query) => query.eq('id', id));
exports.updateUser = updateUser;
const listUsersPage = async (search, page, limit) => {
    const skip = (page - 1) * limit;
    let query = exports.supabase
        .from(USER_TABLE)
        .select('id,email,name,role,subscription,banned,dailyUsage,createdAt', { count: 'exact' })
        .order('createdAt', { ascending: false })
        .range(skip, skip + limit - 1);
    if (search?.trim()) {
        const term = normalizeSearch(search);
        query = query.or(`email.ilike.%${term}%,name.ilike.%${term}%`);
    }
    const { data, count, error } = await query;
    if (error) {
        logDbError('listUsersPage', error);
    }
    const users = data ?? [];
    const userIds = users.map((user) => user.id).filter(Boolean);
    const [analysisRows, paymentRows] = await Promise.all([
        userIds.length
            ? many('listUsersPage analyses counts', exports.supabase.from(ANALYSIS_TABLE).select('userId').in('userId', userIds))
            : Promise.resolve([]),
        userIds.length
            ? many('listUsersPage payments counts', exports.supabase.from(PAYMENT_TABLE).select('userId').in('userId', userIds))
            : Promise.resolve([]),
    ]);
    const analysisCountMap = analysisRows.reduce((acc, row) => {
        acc[row.userId] = (acc[row.userId] || 0) + 1;
        return acc;
    }, {});
    const paymentCountMap = paymentRows.reduce((acc, row) => {
        acc[row.userId] = (acc[row.userId] || 0) + 1;
        return acc;
    }, {});
    return {
        users: users.map((user) => ({
            ...user,
            _count: {
                analyses: analysisCountMap[user.id] || 0,
                payments: paymentCountMap[user.id] || 0,
            },
        })),
        total: count ?? 0,
    };
};
exports.listUsersPage = listUsersPage;
const countUsers = (subscription) => countRows('countUsers', USER_TABLE, subscription ? (query) => query.eq('subscription', subscription) : undefined);
exports.countUsers = countUsers;
const incrementUserDailyUsage = async (id) => {
    const user = await (0, exports.getUserById)(id);
    if (!user) {
        throw new Error('Database operation failed');
    }
    return (0, exports.updateUser)(id, { dailyUsage: (user.dailyUsage || 0) + 1 });
};
exports.incrementUserDailyUsage = incrementUserDailyUsage;
const createAnalysis = (values) => insertSingle('createAnalysis', ANALYSIS_TABLE, values);
exports.createAnalysis = createAnalysis;
const updateAnalysis = (id, values) => updateSingle('updateAnalysis', ANALYSIS_TABLE, values, (query) => query.eq('id', id));
exports.updateAnalysis = updateAnalysis;
const getAnalysisByJobIdForUser = (jobId, userId) => maybeSingle('getAnalysisByJobIdForUser', exports.supabase.from(ANALYSIS_TABLE).select('*').eq('jobId', jobId).eq('userId', userId).maybeSingle());
exports.getAnalysisByJobIdForUser = getAnalysisByJobIdForUser;
const getAnalysisByIdForUser = (id, userId) => maybeSingle('getAnalysisByIdForUser', exports.supabase.from(ANALYSIS_TABLE).select('*').eq('id', id).eq('userId', userId).maybeSingle());
exports.getAnalysisByIdForUser = getAnalysisByIdForUser;
const listAnalysesForUser = async (userId, page, limit) => {
    const skip = (page - 1) * limit;
    const { data, count, error } = await exports.supabase
        .from(ANALYSIS_TABLE)
        .select('*', { count: 'exact' })
        .eq('userId', userId)
        .order('createdAt', { ascending: false })
        .range(skip, skip + limit - 1);
    if (error) {
        logDbError('listAnalysesForUser', error);
    }
    return { analyses: data ?? [], total: count ?? 0 };
};
exports.listAnalysesForUser = listAnalysesForUser;
const countAnalyses = () => countRows('countAnalyses', ANALYSIS_TABLE);
exports.countAnalyses = countAnalyses;
const getUsersMap = async (userIds) => {
    if (!userIds.length) {
        return new Map();
    }
    const users = await many('getUsersMap', exports.supabase.from(USER_TABLE).select('*').in('id', userIds));
    return new Map(users.map((user) => [user.id, user]));
};
const listAllAnalysesPage = async (page, limit) => {
    const skip = (page - 1) * limit;
    const { data, count, error } = await exports.supabase
        .from(ANALYSIS_TABLE)
        .select('*', { count: 'exact' })
        .order('createdAt', { ascending: false })
        .range(skip, skip + limit - 1);
    if (error) {
        logDbError('listAllAnalysesPage', error);
    }
    const analyses = data ?? [];
    const usersMap = await getUsersMap(Array.from(new Set(analyses.map((analysis) => analysis.userId))));
    return {
        analyses: analyses.map((analysis) => ({
            ...analysis,
            user: usersMap.has(analysis.userId)
                ? {
                    email: usersMap.get(analysis.userId)?.email,
                    name: usersMap.get(analysis.userId)?.name,
                }
                : null,
        })),
        total: count ?? 0,
    };
};
exports.listAllAnalysesPage = listAllAnalysesPage;
const getPricingPlanByTier = (tier) => maybeSingle('getPricingPlanByTier', exports.supabase.from(PRICING_PLAN_TABLE).select('*').eq('tier', tier).maybeSingle());
exports.getPricingPlanByTier = getPricingPlanByTier;
const listPricingPlans = () => many('listPricingPlans', exports.supabase.from(PRICING_PLAN_TABLE).select('*').order('price', { ascending: true }));
exports.listPricingPlans = listPricingPlans;
const updatePricingPlan = (id, values) => updateSingle('updatePricingPlan', PRICING_PLAN_TABLE, values, (query) => query.eq('id', id));
exports.updatePricingPlan = updatePricingPlan;
const createPaymentRecord = (values) => insertSingle('createPaymentRecord', PAYMENT_TABLE, { currency: 'USD', ...values });
exports.createPaymentRecord = createPaymentRecord;
const updatePaymentByOrderId = (paypalOrderId, values) => updateSingle('updatePaymentByOrderId', PAYMENT_TABLE, values, (query) => query.eq('paypalOrderId', paypalOrderId));
exports.updatePaymentByOrderId = updatePaymentByOrderId;
const listPaymentsForUser = () => many('listPaymentsForUser', exports.supabase.from(PAYMENT_TABLE).select('*').order('createdAt', { ascending: false }));
exports.listPaymentsForUser = listPaymentsForUser;
const listPaymentsForUserId = (userId) => many('listPaymentsForUserId', exports.supabase.from(PAYMENT_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }));
exports.listPaymentsForUserId = listPaymentsForUserId;
const listAllPaymentsPage = async (page, limit) => {
    const skip = (page - 1) * limit;
    const { data, count, error } = await exports.supabase
        .from(PAYMENT_TABLE)
        .select('*', { count: 'exact' })
        .order('createdAt', { ascending: false })
        .range(skip, skip + limit - 1);
    if (error) {
        logDbError('listAllPaymentsPage', error);
    }
    const payments = data ?? [];
    const usersMap = await getUsersMap(Array.from(new Set(payments.map((payment) => payment.userId))));
    return {
        payments: payments.map((payment) => ({
            ...payment,
            user: usersMap.has(payment.userId)
                ? {
                    email: usersMap.get(payment.userId)?.email,
                    name: usersMap.get(payment.userId)?.name,
                }
                : null,
        })),
        total: count ?? 0,
    };
};
exports.listAllPaymentsPage = listAllPaymentsPage;
const getCompletedRevenue = async () => {
    const rows = await many('getCompletedRevenue', exports.supabase.from(PAYMENT_TABLE).select('amount').eq('status', 'COMPLETED'));
    return rows.reduce((sum, row) => sum + (row.amount || 0), 0);
};
exports.getCompletedRevenue = getCompletedRevenue;
const listSystemSettings = () => many('listSystemSettings', exports.supabase.from(SYSTEM_SETTINGS_TABLE).select('*').order('key', { ascending: true }));
exports.listSystemSettings = listSystemSettings;
const upsertSystemSetting = async (key, value) => {
    const { data, error } = await exports.supabase
        .from(SYSTEM_SETTINGS_TABLE)
        .upsert({ key, value }, { onConflict: 'key' })
        .select('*')
        .maybeSingle();
    if (error) {
        logDbError('upsertSystemSetting', error);
    }
    return data;
};
exports.upsertSystemSetting = upsertSystemSetting;
const listAnnouncements = () => many('listAnnouncements', exports.supabase.from(ANNOUNCEMENT_TABLE).select('*').order('createdAt', { ascending: false }));
exports.listAnnouncements = listAnnouncements;
const createAnnouncementRecord = (values) => insertSingle('createAnnouncementRecord', ANNOUNCEMENT_TABLE, values);
exports.createAnnouncementRecord = createAnnouncementRecord;
const updateAnnouncementRecord = (id, values) => updateSingle('updateAnnouncementRecord', ANNOUNCEMENT_TABLE, values, (query) => query.eq('id', id));
exports.updateAnnouncementRecord = updateAnnouncementRecord;
const bucketByDay = (rows, getDate, getValue) => {
    const buckets = rows.reduce((acc, row) => {
        const key = new Date(getDate(row)).toISOString().slice(0, 10);
        acc[key] = (acc[key] || 0) + getValue(row);
        return acc;
    }, {});
    return Object.entries(buckets)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, value]) => ({ date, value }));
};
const getAnalyticsBuckets = async (fromIso) => {
    const [users, analyses, payments] = await Promise.all([
        many('getAnalyticsBuckets users', exports.supabase.from(USER_TABLE).select('createdAt').gte('createdAt', fromIso)),
        many('getAnalyticsBuckets analyses', exports.supabase.from(ANALYSIS_TABLE).select('createdAt').gte('createdAt', fromIso)),
        many('getAnalyticsBuckets payments', exports.supabase.from(PAYMENT_TABLE).select('createdAt,amount').eq('status', 'COMPLETED').gte('createdAt', fromIso)),
    ]);
    return {
        userGrowth: bucketByDay(users, (row) => row.createdAt, () => 1).map((row) => ({ createdAt: new Date(`${row.date}T00:00:00.000Z`).toISOString(), _count: row.value })),
        analysesPerDay: bucketByDay(analyses, (row) => row.createdAt, () => 1).map((row) => ({ createdAt: new Date(`${row.date}T00:00:00.000Z`).toISOString(), _count: row.value })),
        revenueData: bucketByDay(payments, (row) => row.createdAt, (row) => row.amount || 0).map((row) => ({
            createdAt: new Date(`${row.date}T00:00:00.000Z`).toISOString(),
            _sum: { amount: row.value },
        })),
    };
};
exports.getAnalyticsBuckets = getAnalyticsBuckets;
//# sourceMappingURL=supabase.js.map