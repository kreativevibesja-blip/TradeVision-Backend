import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  throw new Error('Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
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
const TICKET_TABLE = 'Ticket';
const COUPON_TABLE = 'Coupon';
const COUPON_USAGE_TABLE = 'CouponUsage';
const REFERRAL_CODE_TABLE = 'ReferralCode';
const REFERRAL_TABLE = 'Referral';
const COMMISSION_TABLE = 'Commission';
const PAYOUT_TABLE = 'Payout';
const QUEUE_TABLE = 'AnalysisQueue';

export type SubscriptionTier = 'FREE' | 'PRO';
export type UserRole = 'USER' | 'ADMIN';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'PAYPAL' | 'CARD' | 'BANK_TRANSFER' | 'COUPON';
export type BankTransferBank = 'SCOTIABANK' | 'NCB';
export type AnalysisStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketCategory = 'ACCOUNT' | 'BILLING' | 'ANALYSIS' | 'BUG' | 'FEATURE' | 'GENERAL';

export interface UserRecord {
  id: string;
  supabaseId: string | null;
  email: string;
  password: string | null;
  name: string | null;
  role: UserRole;
  subscription: SubscriptionTier;
  dailyUsage: number;
  lastUsageReset: string;
  banned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnalysisRecord {
  id: string;
  jobId: string;
  userId: string;
  imageUrl: string;
  pair: string;
  timeframe: string;
  assetClass: string | null;
  status: AnalysisStatus;
  progress: number;
  currentStage: string | null;
  bias: string | null;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  takeProfits: unknown;
  confidence: number | null;
  explanation: string | null;
  analysisText: string | null;
  strategy: string | null;
  structure: unknown;
  waitConditions: string | null;
  rawResponse: unknown;
  layer1Output: unknown;
  layer2Output: unknown;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentRecord {
  id: string;
  userId: string;
  paypalOrderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paymentMethod: PaymentMethod;
  bankTransferBank: BankTransferBank | null;
  plan: SubscriptionTier;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListPaymentsFilters {
  plan?: SubscriptionTier;
  status?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  createdAfter?: string;
}

export interface PricingPlanRecord {
  id: string;
  name: string;
  tier: SubscriptionTier;
  price: number;
  features: unknown;
  dailyLimit: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_PRICING_PLANS: Array<Pick<PricingPlanRecord, 'name' | 'tier' | 'price' | 'features' | 'dailyLimit' | 'isActive'>> = [
  {
    name: 'TradeVision AI Free',
    tier: 'FREE',
    price: 0,
    features: ['2 analyses per day', 'Basic AI detection', 'Standard processing'],
    dailyLimit: 2,
    isActive: true,
  },
  {
    name: 'TradeVision AI Pro',
    tier: 'PRO',
    price: 19.95,
    features: ['Unlimited daily analyses', 'Advanced Smart Money Concepts', 'Priority AI processing'],
    dailyLimit: 999999,
    isActive: true,
  },
];

export interface SystemSettingRecord {
  id: string;
  key: string;
  value: any;
  updatedAt: string;
}

export interface AnnouncementRecord {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementContentPayload {
  body: string;
  expiresAt: string | null;
}

export type CouponType = 'percentage' | 'fixed';

export interface CouponRecord {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  maxUses: number;
  usedCount: number;
  perUserLimit: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CouponUsageRecord {
  id: string;
  couponId: string;
  userId: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketRecord {
  id: string;
  ticketNumber: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  whatsappNumber: string | null;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  message: string;
  adminNotes: string | null;
  adminResponse: string | null;
  respondedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const logDbError = (context: string, error: unknown) => {
  console.error(`Database error: ${context}`, error);
  throw new Error('Database operation failed');
};

const maybeSingle = async <T>(context: string, query: any): Promise<T | null> => {
  const { data, error } = await query;
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    logDbError(context, error);
  }
  return (data as T | null) ?? null;
};

const single = async <T>(context: string, query: any): Promise<T> => {
  const value = await maybeSingle<T>(context, query);
  if (!value) {
    throw new Error('Database operation failed');
  }
  return value;
};

const many = async <T>(context: string, query: any): Promise<T[]> => {
  const { data, error } = await query;
  if (error) {
    logDbError(context, error);
  }
  return (data as T[]) ?? [];
};

const countRows = async (context: string, table: string, apply?: (query: any) => any): Promise<number> => {
  let query = supabase.from(table).select('*', { count: 'exact', head: true });
  if (apply) {
    query = apply(query);
  }
  const { count, error } = await query;
  if (error) {
    logDbError(context, error);
  }
  return count ?? 0;
};

const updateSingle = async <T>(context: string, table: string, values: Record<string, unknown>, apply: (query: any) => any): Promise<T> => {
  const query = apply(supabase.from(table).update(values).select('*'));
  return single<T>(context, query.maybeSingle());
};

const insertSingle = async <T>(context: string, table: string, values: Record<string, unknown>): Promise<T> => {
  return single<T>(context, supabase.from(table).insert(values).select('*').maybeSingle());
};

const deleteSingle = async (context: string, table: string, apply: (query: any) => any) => {
  const { error } = await apply(supabase.from(table).delete());
  if (error) {
    logDbError(context, error);
  }
};

const normalizeSearch = (search: string) => search.replace(/[,]/g, ' ').trim();

const buildTicketSearch = (search: string) => {
  const term = normalizeSearch(search).replace(/[()%]/g, '');
  return [
    `ticketNumber.ilike.%${term}%`,
    `subject.ilike.%${term}%`,
    `userEmail.ilike.%${term}%`,
    `userName.ilike.%${term}%`,
  ].join(',');
};

export const getUserByEmail = (email: string) =>
  maybeSingle<UserRecord>('getUserByEmail', supabase.from(USER_TABLE).select('*').eq('email', email).maybeSingle());

export const getUserById = (id: string) =>
  maybeSingle<UserRecord>('getUserById', supabase.from(USER_TABLE).select('*').eq('id', id).maybeSingle());

export const createUser = (values: Partial<UserRecord> & Pick<UserRecord, 'email' | 'role'>) =>
  insertSingle<UserRecord>('createUser', USER_TABLE, {
    subscription: 'FREE',
    dailyUsage: 0,
    lastUsageReset: new Date().toISOString(),
    banned: false,
    ...values,
  });

export const updateUser = (id: string, values: Partial<UserRecord>) =>
  updateSingle<UserRecord>('updateUser', USER_TABLE, values, (query) => query.eq('id', id));

export const listUsersPage = async (
  search: string | undefined,
  page: number,
  limit: number,
  filters?: {
    subscription?: SubscriptionTier;
    createdFrom?: string;
    createdTo?: string;
  }
) => {
  const skip = (page - 1) * limit;
  const todayStamp = new Date().toISOString().slice(0, 10);
  const monthStartIso = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
  let query = supabase
    .from(USER_TABLE)
    .select('id,email,name,role,subscription,banned,dailyUsage,lastUsageReset,createdAt', { count: 'exact' })
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1);

  if (search?.trim()) {
    const term = normalizeSearch(search);
    query = query.or(`email.ilike.%${term}%,name.ilike.%${term}%`);
  }

  if (filters?.subscription) {
    query = query.eq('subscription', filters.subscription);
  }

  if (filters?.createdFrom) {
    query = query.gte('createdAt', filters.createdFrom);
  }

  if (filters?.createdTo) {
    query = query.lte('createdAt', filters.createdTo);
  }

  const { data, count, error } = await query;
  if (error) {
    logDbError('listUsersPage', error);
  }

  const users = (data as Partial<UserRecord>[] | null) ?? [];
  const userIds = users.map((user) => user.id!).filter(Boolean);

  const [analysisRows, paymentRows] = await Promise.all([
    userIds.length
      ? many<Pick<AnalysisRecord, 'userId' | 'createdAt'>>('listUsersPage analyses counts', supabase.from(ANALYSIS_TABLE).select('userId,createdAt').in('userId', userIds))
      : Promise.resolve([]),
    userIds.length
      ? many<Pick<PaymentRecord, 'userId'>>('listUsersPage payments counts', supabase.from(PAYMENT_TABLE).select('userId').in('userId', userIds))
      : Promise.resolve([]),
  ]);

  const analysisCountMap = analysisRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.userId] = (acc[row.userId] || 0) + 1;
    return acc;
  }, {});

  const monthlyAnalysisCountMap = analysisRows.reduce<Record<string, number>>((acc, row) => {
    if (row.createdAt >= monthStartIso) {
      acc[row.userId] = (acc[row.userId] || 0) + 1;
    }
    return acc;
  }, {});

  const paymentCountMap = paymentRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.userId] = (acc[row.userId] || 0) + 1;
    return acc;
  }, {});

  return {
    users: users.map((user) => ({
      ...user,
      usage:
        user.subscription === 'PRO'
          ? {
              current: monthlyAnalysisCountMap[user.id!] || 0,
              limit: config.limits.proMonthly,
              period: 'month',
            }
          : {
              current: getUsageDayStamp(user.lastUsageReset) === todayStamp ? user.dailyUsage || 0 : 0,
              limit: config.limits.freeDaily,
              period: 'day',
            },
      _count: {
        analyses: analysisCountMap[user.id!] || 0,
        payments: paymentCountMap[user.id!] || 0,
      },
    })),
    total: count ?? 0,
  };
};

export const countUsers = (subscription?: SubscriptionTier) =>
  countRows('countUsers', USER_TABLE, subscription ? (query) => query.eq('subscription', subscription) : undefined);

const getUsageDayStamp = (value?: string | null) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

export const reserveUserDailyUsage = async (id: string, limit: number) => {
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Database operation failed');
  }

  const todayStamp = new Date().toISOString().slice(0, 10);
  const usageDayStamp = getUsageDayStamp(user.lastUsageReset);
  const nextUsage = usageDayStamp === todayStamp ? user.dailyUsage || 0 : 0;

  if (nextUsage >= limit) {
    return {
      allowed: false,
      user: usageDayStamp === todayStamp ? user : { ...user, dailyUsage: 0, lastUsageReset: new Date().toISOString() },
    };
  }

  const updatedUser = await updateUser(id, {
    dailyUsage: nextUsage + 1,
    lastUsageReset: new Date().toISOString(),
  });

  return {
    allowed: true,
    user: updatedUser,
  };
};

export const releaseUserDailyUsageReservation = async (id: string) => {
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Database operation failed');
  }

  return updateUser(id, {
    dailyUsage: Math.max(0, (user.dailyUsage || 0) - 1),
  });
};

export const countAnalysesForUserSince = (userId: string, fromIso: string) =>
  countRows('countAnalysesForUserSince', ANALYSIS_TABLE, (query) =>
    query.eq('userId', userId).gte('createdAt', fromIso)
  );

export const createAnalysis = (values: Partial<AnalysisRecord> & Pick<AnalysisRecord, 'id' | 'jobId' | 'userId' | 'imageUrl' | 'pair' | 'timeframe'>) =>
  insertSingle<AnalysisRecord>('createAnalysis', ANALYSIS_TABLE, values);

export const updateAnalysis = (id: string, values: Partial<AnalysisRecord>) =>
  updateSingle<AnalysisRecord>('updateAnalysis', ANALYSIS_TABLE, values, (query) => query.eq('id', id));

export const getAnalysisByJobIdForUser = (jobId: string, userId: string) =>
  maybeSingle<AnalysisRecord>(
    'getAnalysisByJobIdForUser',
    supabase.from(ANALYSIS_TABLE).select('*').eq('jobId', jobId).eq('userId', userId).maybeSingle()
  );

export const getAnalysisByIdForUser = (id: string, userId: string) =>
  maybeSingle<AnalysisRecord>('getAnalysisByIdForUser', supabase.from(ANALYSIS_TABLE).select('*').eq('id', id).eq('userId', userId).maybeSingle());

export const getAnalysisById = (id: string) =>
  maybeSingle<AnalysisRecord>('getAnalysisById', supabase.from(ANALYSIS_TABLE).select('*').eq('id', id).maybeSingle());

export const listAnalysesForUser = async (userId: string, page: number, limit: number) => {
  const skip = (page - 1) * limit;
  const { data, count, error } = await supabase
    .from(ANALYSIS_TABLE)
    .select('*', { count: 'exact' })
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1);

  if (error) {
    logDbError('listAnalysesForUser', error);
  }

  return { analyses: (data as AnalysisRecord[]) ?? [], total: count ?? 0 };
};

export const countAnalyses = () => countRows('countAnalyses', ANALYSIS_TABLE);

const getUsersMap = async (userIds: string[]) => {
  if (!userIds.length) {
    return new Map<string, UserRecord>();
  }

  const users = await many<UserRecord>('getUsersMap', supabase.from(USER_TABLE).select('*').in('id', userIds));
  return new Map(users.map((user) => [user.id, user]));
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const extractAnalysisMeta = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }

  const directMeta = value.analysisMeta;
  return isRecord(directMeta) ? directMeta : null;
};

const formatModelName = (value: string) => {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'gemini-3.1-flash-lite' || normalized === 'gemini-3.1-flash-lite-preview') {
    return 'Gemini 3.1 Flash Lite';
  }

  if (normalized === 'gemini-2.5-flash') {
    return 'Gemini 2.5 Flash';
  }

  if (normalized === 'gemini-3-flash-preview' || normalized === 'gemini-3-flash') {
    return 'Gemini 3 Flash Preview';
  }

  if (normalized === 'gpt-5.1') {
    return 'GPT-5.1';
  }

  if (normalized === 'gpt-5' || normalized === 'gpt-5-mini') {
    return value.trim().toUpperCase().replace('GPT-', 'GPT-');
  }

  return value;
};

const summarizeSingleModelMeta = (value: Record<string, unknown>) => {
  const actualModel = typeof value.actualModel === 'string' ? value.actualModel : null;
  const mode = typeof value.mode === 'string' ? value.mode : null;
  const usedFallback = value.usedFallback === true;

  if (!actualModel) {
    return null;
  }

  return {
    label: formatModelName(actualModel),
    mode,
    usedFallback,
  };
};

const summarizeAnalysisModel = (analysis: AnalysisRecord) => {
  const metadata = extractAnalysisMeta(analysis.rawResponse) ?? extractAnalysisMeta(analysis.layer2Output) ?? extractAnalysisMeta(analysis.layer1Output);

  if (!metadata) {
    return { label: null, usedFallback: false };
  }

  const charts = Array.isArray(metadata.charts)
    ? metadata.charts.map((chart) => (isRecord(chart) ? summarizeSingleModelMeta(chart) : null)).filter((chart): chart is NonNullable<ReturnType<typeof summarizeSingleModelMeta>> => Boolean(chart))
    : [];

  if (charts.length > 0) {
    const usedFallback = charts.some((chart) => chart.usedFallback);
    const uniqueLabels = Array.from(new Set(charts.map((chart) => chart.label)));

    if (uniqueLabels.length === 1) {
      return { label: uniqueLabels[0], usedFallback };
    }

    const label = charts
      .map((chart) => `${chart.mode === 'htf' ? 'HTF' : chart.mode === 'ltf' ? 'LTF' : 'Chart'}: ${chart.label}`)
      .join(' | ');

    return { label, usedFallback };
  }

  const single = summarizeSingleModelMeta(metadata);
  return {
    label: single?.label ?? null,
    usedFallback: single?.usedFallback ?? false,
  };
};

const summarizeFailureReason = (message: string | null) => {
  if (!message) {
    return null;
  }

  const normalized = message.replace(/\s+/g, ' ').trim();
  const lower = normalized.toLowerCase();

  if (
    lower.includes('429 too many requests') ||
    lower.includes('quota exceeded') ||
    lower.includes('rate limit')
  ) {
    return 'Gemini rate limit hit. Retry later or check API quota.';
  }

  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('etimedout')) {
    return 'AI provider request timed out.';
  }

  if (lower.includes('enetunreach') || lower.includes('econnreset') || lower.includes('network')) {
    return 'Network error while contacting the AI provider.';
  }

  if (lower.includes('not supported for generatecontent') || lower.includes('model') && lower.includes('not found')) {
    return 'Configured Gemini model is unavailable.';
  }

  if (lower.includes('did not return valid json') || lower.includes('json')) {
    return 'AI response could not be parsed.';
  }

  if (lower.includes('tradevision ai is not configured correctly') || lower.includes('api key')) {
    return 'AI service is misconfigured.';
  }

  const firstSentence = normalized
    .replace(/\[[^\]]*\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .split(/(?<=[.!?])\s+/)[0]
    ?.trim();

  if (!firstSentence) {
    return 'Analysis failed.';
  }

  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117).trim()}...` : firstSentence;
};

export const listAllAnalysesPage = async (page: number, limit: number, search?: string) => {
  const skip = (page - 1) * limit;
  const trimmedSearch = typeof search === 'string' ? search.trim() : '';

  let userIds: string[] | null = null;
  if (trimmedSearch) {
    const matchedUsers = await many<UserRecord>(
      'listAllAnalysesPage.searchUsers',
      supabase
        .from(USER_TABLE)
        .select('*')
        .or(`email.ilike.%${trimmedSearch}%,name.ilike.%${trimmedSearch}%`)
        .limit(100)
    );

    userIds = matchedUsers.map((user) => user.id);
    if (userIds.length === 0) {
      return { analyses: [], total: 0 };
    }
  }

  let query = supabase
    .from(ANALYSIS_TABLE)
    .select('*', { count: 'exact' })
    .order('createdAt', { ascending: false });

  if (userIds) {
    query = query.in('userId', userIds);
  }

  const { data, count, error } = await query.range(skip, skip + limit - 1);

  if (error) {
    logDbError('listAllAnalysesPage', error);
  }

  const analyses = (data as AnalysisRecord[]) ?? [];
  const usersMap = await getUsersMap(Array.from(new Set(analyses.map((analysis) => analysis.userId))));

  return {
    analyses: analyses.map((analysis) => {
      const user = usersMap.get(analysis.userId);
      const modelSummary = summarizeAnalysisModel(analysis);

      return {
        ...analysis,
        outcome: analysis.status === 'COMPLETED' ? 'SUCCESS' : analysis.status === 'FAILED' ? 'FAILED' : 'IN_PROGRESS',
        modelUsed: modelSummary.label,
        usedFallback: modelSummary.usedFallback,
        failureReason: summarizeFailureReason(analysis.errorMessage),
        user: user
          ? {
              email: user.email,
              name: user.name,
              subscription: user.subscription,
            }
          : null,
      };
    }),
    total: count ?? 0,
  };
};

export const getPricingPlanByTier = (tier: SubscriptionTier) =>
  maybeSingle<PricingPlanRecord>('getPricingPlanByTier', supabase.from(PRICING_PLAN_TABLE).select('*').eq('tier', tier).maybeSingle());

const seedDefaultPricingPlans = async () => {
  const { data, error } = await supabase.from(PRICING_PLAN_TABLE).insert(DEFAULT_PRICING_PLANS).select('*');
  if (error) {
    logDbError('seedDefaultPricingPlans', error);
  }

  return (data as PricingPlanRecord[]) ?? [];
};

export const listPricingPlans = async () => {
  const plans = await many<PricingPlanRecord>('listPricingPlans', supabase.from(PRICING_PLAN_TABLE).select('*').order('price', { ascending: true }));
  if (plans.length > 0) {
    return plans;
  }

  return seedDefaultPricingPlans();
};

export const getPricingPlanByTierWithFallback = async (tier: SubscriptionTier) => {
  const directMatch = await getPricingPlanByTier(tier);
  if (directMatch) {
    return directMatch;
  }

  const seededPlans = await listPricingPlans();
  return seededPlans.find((plan) => plan.tier === tier) ?? null;
};

export const updatePricingPlan = (id: string, values: Partial<PricingPlanRecord>) =>
  updateSingle<PricingPlanRecord>('updatePricingPlan', PRICING_PLAN_TABLE, values, (query) => query.eq('id', id));

export const createPricingPlan = (values: Pick<PricingPlanRecord, 'name' | 'tier' | 'price' | 'features' | 'dailyLimit' | 'isActive'>) =>
  insertSingle<PricingPlanRecord>('createPricingPlan', PRICING_PLAN_TABLE, values);

export const deletePricingPlan = (id: string) =>
  deleteSingle('deletePricingPlan', PRICING_PLAN_TABLE, (query) => query.eq('id', id));

export const createPaymentRecord = (values: Partial<PaymentRecord> & Pick<PaymentRecord, 'userId' | 'paypalOrderId' | 'amount' | 'status' | 'plan'>) =>
  insertSingle<PaymentRecord>('createPaymentRecord', PAYMENT_TABLE, { currency: 'USD', paymentMethod: 'PAYPAL', ...values });

export const getPaymentById = (id: string) =>
  maybeSingle<PaymentRecord>('getPaymentById', supabase.from(PAYMENT_TABLE).select('*').eq('id', id).maybeSingle());

export const updatePaymentById = (id: string, values: Partial<PaymentRecord>) =>
  updateSingle<PaymentRecord>('updatePaymentById', PAYMENT_TABLE, values, (query) => query.eq('id', id));

export const updatePaymentByOrderId = (paypalOrderId: string, values: Partial<PaymentRecord>) =>
  updateSingle<PaymentRecord>('updatePaymentByOrderId', PAYMENT_TABLE, values, (query) => query.eq('paypalOrderId', paypalOrderId));

export const listPaymentsForUser = () =>
  many<PaymentRecord>('listPaymentsForUser', supabase.from(PAYMENT_TABLE).select('*').order('createdAt', { ascending: false }));

export const listPaymentsForUserId = (userId: string) =>
  many<PaymentRecord>('listPaymentsForUserId', supabase.from(PAYMENT_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }));

export const listAllPaymentsPage = async (page: number, limit: number, filters: ListPaymentsFilters = {}) => {
  const skip = (page - 1) * limit;
  let query = supabase
    .from(PAYMENT_TABLE)
    .select('*', { count: 'exact' })
    .order('createdAt', { ascending: false });

  if (filters.plan) {
    query = query.eq('plan', filters.plan);
  }

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.paymentMethod) {
    query = query.eq('paymentMethod', filters.paymentMethod);
  }

  if (filters.createdAfter) {
    query = query.gte('createdAt', filters.createdAfter);
  }

  const { data, count, error } = await query.range(skip, skip + limit - 1);

  if (error) {
    logDbError('listAllPaymentsPage', error);
  }

  const payments = (data as PaymentRecord[]) ?? [];
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

export const getCompletedRevenue = async () => {
  const rows = await many<Pick<PaymentRecord, 'amount'>>('getCompletedRevenue', supabase.from(PAYMENT_TABLE).select('amount').eq('status', 'COMPLETED'));
  return rows.reduce((sum, row) => sum + (row.amount || 0), 0);
};

export const listSystemSettings = () =>
  many<SystemSettingRecord>('listSystemSettings', supabase.from(SYSTEM_SETTINGS_TABLE).select('*').order('key', { ascending: true }));

export const getSystemSetting = (key: string) =>
  maybeSingle<SystemSettingRecord>('getSystemSetting', supabase.from(SYSTEM_SETTINGS_TABLE).select('*').eq('key', key).maybeSingle());

export const upsertSystemSetting = async (key: string, value: any) => {
  const { data, error } = await supabase
    .from(SYSTEM_SETTINGS_TABLE)
    .upsert({ key, value }, { onConflict: 'key' })
    .select('*')
    .maybeSingle();

  if (error) {
    logDbError('upsertSystemSetting', error);
  }

  return data as SystemSettingRecord;
};

export const listAnnouncements = () =>
  many<AnnouncementRecord>('listAnnouncements', supabase.from(ANNOUNCEMENT_TABLE).select('*').order('createdAt', { ascending: false }));

export const listActiveAnnouncements = () =>
  many<AnnouncementRecord>(
    'listActiveAnnouncements',
    supabase.from(ANNOUNCEMENT_TABLE).select('*').eq('isActive', true).order('createdAt', { ascending: false })
  );

export const createAnnouncementRecord = (values: Pick<AnnouncementRecord, 'title' | 'content'>) =>
  insertSingle<AnnouncementRecord>('createAnnouncementRecord', ANNOUNCEMENT_TABLE, values);

export const updateAnnouncementRecord = (id: string, values: Partial<AnnouncementRecord>) =>
  updateSingle<AnnouncementRecord>('updateAnnouncementRecord', ANNOUNCEMENT_TABLE, values, (query) => query.eq('id', id));

export const deleteAnnouncementRecord = async (id: string) => {
  const { error } = await supabase.from(ANNOUNCEMENT_TABLE).delete().eq('id', id);
  if (error) {
    logDbError('deleteAnnouncementRecord', error);
  }
};

export const deleteAnnouncementRecords = async (ids: string[]) => {
  if (!ids.length) {
    return;
  }

  const { error } = await supabase.from(ANNOUNCEMENT_TABLE).delete().in('id', ids);
  if (error) {
    logDbError('deleteAnnouncementRecords', error);
  }
};

export const createTicketRecord = (values: Pick<TicketRecord, 'ticketNumber' | 'userId' | 'userEmail' | 'userName' | 'whatsappNumber' | 'subject' | 'category' | 'priority' | 'message'>) =>
  insertSingle<TicketRecord>('createTicketRecord', TICKET_TABLE, {
    status: 'OPEN',
    ...values,
  });

export const getTicketByIdForUser = (id: string, userId: string) =>
  maybeSingle<TicketRecord>('getTicketByIdForUser', supabase.from(TICKET_TABLE).select('*').eq('id', id).eq('userId', userId).maybeSingle());

export const getTicketById = (id: string) =>
  maybeSingle<TicketRecord>('getTicketById', supabase.from(TICKET_TABLE).select('*').eq('id', id).maybeSingle());

export const listTicketsForUser = async (userId: string, page: number, limit: number) => {
  const skip = (page - 1) * limit;
  const { data, count, error } = await supabase
    .from(TICKET_TABLE)
    .select('*', { count: 'exact' })
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1);

  if (error) {
    logDbError('listTicketsForUser', error);
  }

  return {
    tickets: (data as TicketRecord[]) ?? [],
    total: count ?? 0,
  };
};

export const listAdminTicketsPage = async (
  page: number,
  limit: number,
  filters: {
    search?: string;
    status?: TicketStatus;
    priority?: TicketPriority;
    dateRange?: '7d' | '30d' | '90d' | 'all';
  }
) => {
  const skip = (page - 1) * limit;
  let query = supabase
    .from(TICKET_TABLE)
    .select('*', { count: 'exact' })
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  if (filters.priority) {
    query = query.eq('priority', filters.priority);
  }

  if (filters.search?.trim()) {
    query = query.or(buildTicketSearch(filters.search));
  }

  const days = filters.dateRange === '7d' ? 7 : filters.dateRange === '30d' ? 30 : filters.dateRange === '90d' ? 90 : null;
  if (days) {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    query = query.gte('createdAt', fromDate.toISOString());
  }

  const { data, count, error } = await query;
  if (error) {
    logDbError('listAdminTicketsPage', error);
  }

  return {
    tickets: (data as TicketRecord[]) ?? [],
    total: count ?? 0,
  };
};

export const updateTicketRecord = (id: string, values: Partial<TicketRecord>) =>
  updateSingle<TicketRecord>('updateTicketRecord', TICKET_TABLE, values, (query) => query.eq('id', id));

export const countOpenTickets = async () => {
  const { count, error } = await supabase
    .from(TICKET_TABLE)
    .select('id', { count: 'exact', head: true })
    .in('status', ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER']);

  if (error) {
    logDbError('countOpenTickets', error);
  }

  return count ?? 0;
};

const bucketByDay = <T>(rows: T[], getDate: (row: T) => string, getValue: (row: T) => number) => {
  const buckets = rows.reduce<Record<string, number>>((acc, row) => {
    const key = new Date(getDate(row)).toISOString().slice(0, 10);
    acc[key] = (acc[key] || 0) + getValue(row);
    return acc;
  }, {});

  return Object.entries(buckets)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
};

// ---- Coupon helpers ----

export const createCouponRecord = (values: Pick<CouponRecord, 'code' | 'type' | 'value' | 'maxUses' | 'perUserLimit'> & { expiresAt?: string | null }) =>
  insertSingle<CouponRecord>('createCouponRecord', COUPON_TABLE, {
    ...values,
    code: values.code.toUpperCase().trim(),
    usedCount: 0,
    active: true,
  });

export const listCoupons = () =>
  many<CouponRecord>('listCoupons', supabase.from(COUPON_TABLE).select('*').order('createdAt', { ascending: false }));

export const getCouponByCode = (code: string) =>
  maybeSingle<CouponRecord>('getCouponByCode', supabase.from(COUPON_TABLE).select('*').eq('code', code.toUpperCase().trim()).maybeSingle());

export const getCouponById = (id: string) =>
  maybeSingle<CouponRecord>('getCouponById', supabase.from(COUPON_TABLE).select('*').eq('id', id).maybeSingle());

export const updateCouponRecord = (id: string, values: Partial<CouponRecord>) =>
  updateSingle<CouponRecord>('updateCouponRecord', COUPON_TABLE, values, (query) => query.eq('id', id));

export const deleteCouponRecord = async (id: string) => {
  const { error } = await supabase.from(COUPON_TABLE).delete().eq('id', id);
  if (error) {
    logDbError('deleteCouponRecord', error);
  }
};

export const getCouponUsage = (couponId: string, userId: string) =>
  maybeSingle<CouponUsageRecord>('getCouponUsage', supabase.from(COUPON_USAGE_TABLE).select('*').eq('couponId', couponId).eq('userId', userId).maybeSingle());

export const incrementCouponUsage = async (couponId: string, userId: string) => {
  const existing = await getCouponUsage(couponId, userId);
  if (existing) {
    await updateSingle<CouponUsageRecord>('incrementCouponUsage', COUPON_USAGE_TABLE, { usageCount: existing.usageCount + 1 }, (query) => query.eq('id', existing.id));
  } else {
    await insertSingle<CouponUsageRecord>('incrementCouponUsage', COUPON_USAGE_TABLE, { couponId, userId, usageCount: 1 });
  }
  // Increment global used count
  const coupon = await getCouponById(couponId);
  if (coupon) {
    await supabase.from(COUPON_TABLE).update({ usedCount: coupon.usedCount + 1 }).eq('id', couponId);
  }
};

export const getAnalyticsBuckets = async (fromIso: string, toIso?: string) => {
  const applyRange = (query: any) => {
    let nextQuery = query.gte('createdAt', fromIso);
    if (toIso) {
      nextQuery = nextQuery.lte('createdAt', toIso);
    }
    return nextQuery;
  };

  const [users, analyses, payments] = await Promise.all([
    many<Pick<UserRecord, 'createdAt'>>('getAnalyticsBuckets users', applyRange(supabase.from(USER_TABLE).select('createdAt'))),
    many<Pick<AnalysisRecord, 'createdAt'>>('getAnalyticsBuckets analyses', applyRange(supabase.from(ANALYSIS_TABLE).select('createdAt'))),
    many<Pick<PaymentRecord, 'createdAt' | 'amount'>>(
      'getAnalyticsBuckets payments',
      applyRange(supabase.from(PAYMENT_TABLE).select('createdAt,amount').eq('status', 'COMPLETED'))
    ),
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

// ============================================================
// Referral System
// ============================================================

export type ReferralStatus = 'pending' | 'qualified' | 'paid';
export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'rejected';
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'rejected';

export interface ReferralCodeRecord {
  id: string;
  userId: string;
  code: string;
  totalEarnings: number;
  totalReferrals: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  referredUserId: string;
  referralCode: string;
  status: ReferralStatus;
  createdAt: string;
  qualifiedAt: string | null;
}

export interface CommissionRecord {
  id: string;
  referrerId: string;
  referredUserId: string;
  referralId: string;
  amount: number;
  status: CommissionStatus;
  createdAt: string;
  paidAt: string | null;
}

export interface PayoutRecord {
  id: string;
  userId: string;
  paypalEmail: string;
  amount: number;
  status: PayoutStatus;
  createdAt: string;
  processedAt: string | null;
}

// ── Referral codes ──

export const getReferralCodeByUserId = (userId: string) =>
  maybeSingle<ReferralCodeRecord>('getReferralCodeByUserId', supabase.from(REFERRAL_CODE_TABLE).select('*').eq('userId', userId).maybeSingle());

export const getReferralCodeByCode = (code: string) =>
  maybeSingle<ReferralCodeRecord>('getReferralCodeByCode', supabase.from(REFERRAL_CODE_TABLE).select('*').eq('code', code.toUpperCase().trim()).maybeSingle());

export const createReferralCode = (values: { userId: string; code: string }) =>
  insertSingle<ReferralCodeRecord>('createReferralCode', REFERRAL_CODE_TABLE, {
    userId: values.userId,
    code: values.code.toUpperCase().trim(),
  });

export const updateReferralCode = (id: string, values: Partial<ReferralCodeRecord>) =>
  updateSingle<ReferralCodeRecord>('updateReferralCode', REFERRAL_CODE_TABLE, values, (q) => q.eq('id', id));

// ── Referrals ──

export const createReferral = (values: { referrerId: string; referredUserId: string; referralCode: string }) =>
  insertSingle<ReferralRecord>('createReferral', REFERRAL_TABLE, values);

export const getReferralByReferredUserId = (referredUserId: string) =>
  maybeSingle<ReferralRecord>('getReferralByReferredUserId', supabase.from(REFERRAL_TABLE).select('*').eq('referredUserId', referredUserId).maybeSingle());

export const updateReferral = (id: string, values: Partial<ReferralRecord>) =>
  updateSingle<ReferralRecord>('updateReferral', REFERRAL_TABLE, values, (q) => q.eq('id', id));

export const listReferralsByReferrerId = (referrerId: string) =>
  many<ReferralRecord>('listReferralsByReferrerId', supabase.from(REFERRAL_TABLE).select('*').eq('referrerId', referrerId).order('createdAt', { ascending: false }));

export const listAllReferralsPage = async (page: number, limit: number) => {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  const { data, error, count } = await supabase
    .from(REFERRAL_TABLE)
    .select('*', { count: 'exact' })
    .order('createdAt', { ascending: false })
    .range(from, to);
  if (error) logDbError('listAllReferralsPage', error);
  return { referrals: (data ?? []) as ReferralRecord[], total: count ?? 0 };
};

export const countReferralsByStatus = async (status?: ReferralStatus) => {
  let query = supabase.from(REFERRAL_TABLE).select('*', { count: 'exact', head: true });
  if (status) query = query.eq('status', status);
  const { count, error } = await query;
  if (error) logDbError('countReferralsByStatus', error);
  return count ?? 0;
};

// ── Commissions ──

export const createCommission = (values: { referrerId: string; referredUserId: string; referralId: string; amount: number }) =>
  insertSingle<CommissionRecord>('createCommission', COMMISSION_TABLE, values);

export const getCommissionByReferralId = (referralId: string) =>
  maybeSingle<CommissionRecord>('getCommissionByReferralId', supabase.from(COMMISSION_TABLE).select('*').eq('referralId', referralId).maybeSingle());

export const updateCommission = (id: string, values: Partial<CommissionRecord>) =>
  updateSingle<CommissionRecord>('updateCommission', COMMISSION_TABLE, values, (q) => q.eq('id', id));

export const listCommissionsByReferrerId = (referrerId: string) =>
  many<CommissionRecord>('listCommissionsByReferrerId', supabase.from(COMMISSION_TABLE).select('*').eq('referrerId', referrerId).order('createdAt', { ascending: false }));

export const listAllCommissionsPage = async (page: number, limit: number, status?: CommissionStatus) => {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let query = supabase.from(COMMISSION_TABLE).select('*', { count: 'exact' }).order('createdAt', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error, count } = await query.range(from, to);
  if (error) logDbError('listAllCommissionsPage', error);
  return { commissions: (data ?? []) as CommissionRecord[], total: count ?? 0 };
};

export const sumApprovedCommissions = async (referrerId: string) => {
  const rows = await many<{ amount: number }>(
    'sumApprovedCommissions',
    supabase.from(COMMISSION_TABLE).select('amount').eq('referrerId', referrerId).eq('status', 'approved')
  );
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
};

export const sumPaidCommissions = async (referrerId: string) => {
  const rows = await many<{ amount: number }>(
    'sumPaidCommissions',
    supabase.from(COMMISSION_TABLE).select('amount').eq('referrerId', referrerId).eq('status', 'paid')
  );
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
};

export const sumPendingCommissions = async (referrerId: string) => {
  const rows = await many<{ amount: number }>(
    'sumPendingCommissions',
    supabase.from(COMMISSION_TABLE).select('amount').eq('referrerId', referrerId).in('status', ['pending', 'approved'])
  );
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
};

export const getTotalCommissionsOwed = async () => {
  const rows = await many<{ amount: number }>(
    'getTotalCommissionsOwed',
    supabase.from(COMMISSION_TABLE).select('amount').in('status', ['pending', 'approved'])
  );
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
};

export const getTotalCommissionsPaid = async () => {
  const rows = await many<{ amount: number }>(
    'getTotalCommissionsPaid',
    supabase.from(COMMISSION_TABLE).select('amount').eq('status', 'paid')
  );
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
};

// ── Payouts ──

export const createPayout = (values: { userId: string; paypalEmail: string; amount: number }) =>
  insertSingle<PayoutRecord>('createPayout', PAYOUT_TABLE, values);

export const updatePayout = (id: string, values: Partial<PayoutRecord>) =>
  updateSingle<PayoutRecord>('updatePayout', PAYOUT_TABLE, values, (q) => q.eq('id', id));

export const listPayoutsForUser = (userId: string) =>
  many<PayoutRecord>('listPayoutsForUser', supabase.from(PAYOUT_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }));

export const listAllPayoutsPage = async (page: number, limit: number, status?: PayoutStatus) => {
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let query = supabase.from(PAYOUT_TABLE).select('*', { count: 'exact' }).order('createdAt', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error, count } = await query.range(from, to);
  if (error) logDbError('listAllPayoutsPage', error);
  return { payouts: (data ?? []) as PayoutRecord[], total: count ?? 0 };
};

export const getReferralRevenueGenerated = async () => {
  const rows = await many<{ amount: number }>(
    'getReferralRevenueGenerated',
    supabase.from(COMMISSION_TABLE).select('amount').in('status', ['approved', 'paid'])
  );
  // Revenue is commission / commissionRate * 100, but we don't know the rate per record.
  // Instead, sum the payment amounts of referred users. This is more accurate.
  // For now, return total commission amounts as a proxy (admin sees total commissions).
  return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
};

// ============================================================
// Analysis Queue
// ============================================================

export type QueueJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface QueueJobRecord {
  id: string;
  userId: string;
  analysisId: string | null;
  status: QueueJobStatus;
  priority: number;
  inputData: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export const createQueueJob = (values: Pick<QueueJobRecord, 'userId' | 'priority' | 'inputData'> & { analysisId?: string }) =>
  insertSingle<QueueJobRecord>('createQueueJob', QUEUE_TABLE, {
    status: 'queued',
    retryCount: 0,
    ...values,
  });

export const getQueueJobById = (id: string) =>
  maybeSingle<QueueJobRecord>('getQueueJobById', supabase.from(QUEUE_TABLE).select('*').eq('id', id).maybeSingle());

export const getQueueJobForUser = (id: string, userId: string) =>
  maybeSingle<QueueJobRecord>('getQueueJobForUser', supabase.from(QUEUE_TABLE).select('*').eq('id', id).eq('userId', userId).maybeSingle());

export const cancelQueueJobForUser = async (id: string, userId: string): Promise<QueueJobRecord | null> => {
  const { data, error } = await supabase
    .from(QUEUE_TABLE)
    .update({
      status: 'cancelled',
      error: null,
      completedAt: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('userId', userId)
    .in('status', ['queued', 'processing'])
    .select('*')
    .maybeSingle();

  if (error) {
    logDbError('cancelQueueJobForUser', error);
  }

  return (data as QueueJobRecord | null) ?? null;
};

export const updateQueueJob = (id: string, values: Partial<QueueJobRecord>) =>
  updateSingle<QueueJobRecord>('updateQueueJob', QUEUE_TABLE, values, (query) => query.eq('id', id));

/** Atomically claim the next queued job (highest priority first, then FIFO). */
export const claimNextQueueJob = async (): Promise<QueueJobRecord | null> => {
  // Select the next eligible job
  const { data: candidates, error: fetchError } = await supabase
    .from(QUEUE_TABLE)
    .select('id')
    .eq('status', 'queued')
    .order('priority', { ascending: false })
    .order('createdAt', { ascending: true })
    .limit(1);

  if (fetchError || !candidates?.length) {
    return null;
  }

  // Optimistic claim: update only if still queued
  const { data: claimed, error: claimError } = await supabase
    .from(QUEUE_TABLE)
    .update({ status: 'processing', startedAt: new Date().toISOString() })
    .eq('id', candidates[0].id)
    .eq('status', 'queued') // CAS guard
    .select('*')
    .maybeSingle();

  if (claimError || !claimed) {
    return null;
  }

  return claimed as QueueJobRecord;
};

/** Count jobs ahead of a specific job in the queue. */
export const getQueuePosition = async (jobId: string): Promise<number> => {
  const job = await getQueueJobById(jobId);
  if (!job || job.status !== 'queued') {
    return 0;
  }

  const { count, error } = await supabase
    .from(QUEUE_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued')
    .lt('createdAt', job.createdAt);

  if (error) {
    return 0;
  }

  return (count ?? 0) + 1;
};

/** Count active (queued/processing) jobs for a user. */
export const countActiveQueueJobs = async (userId: string): Promise<number> => {
  const { count, error } = await supabase
    .from(QUEUE_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId)
    .in('status', ['queued', 'processing']);

  if (error) return 0;
  return count ?? 0;
};

/** Count jobs created by a user in the last N minutes. */
export const countRecentQueueJobs = async (userId: string, minutes: number): Promise<number> => {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from(QUEUE_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId)
    .gte('createdAt', since);

  if (error) return 0;
  return count ?? 0;
};