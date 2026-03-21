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

export type SubscriptionTier = 'FREE' | 'PRO';
export type UserRole = 'USER' | 'ADMIN';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
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
  plan: SubscriptionTier;
  createdAt: string;
  updatedAt: string;
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
    price: 19,
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

export const listUsersPage = async (search: string | undefined, page: number, limit: number) => {
  const skip = (page - 1) * limit;
  let query = supabase
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

  const users = (data as Partial<UserRecord>[] | null) ?? [];
  const userIds = users.map((user) => user.id!).filter(Boolean);

  const [analysisRows, paymentRows] = await Promise.all([
    userIds.length
      ? many<Pick<AnalysisRecord, 'userId'>>('listUsersPage analyses counts', supabase.from(ANALYSIS_TABLE).select('userId').in('userId', userIds))
      : Promise.resolve([]),
    userIds.length
      ? many<Pick<PaymentRecord, 'userId'>>('listUsersPage payments counts', supabase.from(PAYMENT_TABLE).select('userId').in('userId', userIds))
      : Promise.resolve([]),
  ]);

  const analysisCountMap = analysisRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.userId] = (acc[row.userId] || 0) + 1;
    return acc;
  }, {});

  const paymentCountMap = paymentRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.userId] = (acc[row.userId] || 0) + 1;
    return acc;
  }, {});

  return {
    users: users.map((user) => ({
      ...user,
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

export const incrementUserDailyUsage = async (id: string) => {
  const user = await getUserById(id);
  if (!user) {
    throw new Error('Database operation failed');
  }
  return updateUser(id, { dailyUsage: (user.dailyUsage || 0) + 1 });
};

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

export const listAllAnalysesPage = async (page: number, limit: number) => {
  const skip = (page - 1) * limit;
  const { data, count, error } = await supabase
    .from(ANALYSIS_TABLE)
    .select('*', { count: 'exact' })
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1);

  if (error) {
    logDbError('listAllAnalysesPage', error);
  }

  const analyses = (data as AnalysisRecord[]) ?? [];
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
  insertSingle<PaymentRecord>('createPaymentRecord', PAYMENT_TABLE, { currency: 'USD', ...values });

export const updatePaymentByOrderId = (paypalOrderId: string, values: Partial<PaymentRecord>) =>
  updateSingle<PaymentRecord>('updatePaymentByOrderId', PAYMENT_TABLE, values, (query) => query.eq('paypalOrderId', paypalOrderId));

export const listPaymentsForUser = () =>
  many<PaymentRecord>('listPaymentsForUser', supabase.from(PAYMENT_TABLE).select('*').order('createdAt', { ascending: false }));

export const listPaymentsForUserId = (userId: string) =>
  many<PaymentRecord>('listPaymentsForUserId', supabase.from(PAYMENT_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }));

export const listAllPaymentsPage = async (page: number, limit: number) => {
  const skip = (page - 1) * limit;
  const { data, count, error } = await supabase
    .from(PAYMENT_TABLE)
    .select('*', { count: 'exact' })
    .order('createdAt', { ascending: false })
    .range(skip, skip + limit - 1);

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