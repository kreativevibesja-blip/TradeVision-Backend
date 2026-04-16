import { createClient } from '@supabase/supabase-js';
import { config } from '../config';
import { getLivePlatformMetricsSnapshot, recordAnalysisCreated, recordQueueJobState } from './livePlatformMetrics';

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  throw new Error('Missing Supabase backend configuration. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
}

const SUPABASE_REQUEST_TIMEOUT_MS = Math.max(1000, config.supabase.requestTimeoutMs);

const extractErrorText = (error: unknown) => {
  if (!error) {
    return '';
  }

  if (error instanceof Error) {
    return `${error.name} ${error.message} ${error.stack ?? ''}`.toLowerCase();
  }

  return String(error).toLowerCase();
};

const isTransientSupabaseError = (error: unknown) => {
  const text = extractErrorText(error);
  return [
    'und_err_headers_timeout',
    'headers timeout error',
    'fetch failed',
    'etimedout',
    'econnreset',
    'econnrefused',
    'socket hang up',
    'network error',
    'aborterror',
  ].some((token) => text.includes(token));
};

const supabaseFetch: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Supabase request timed out after ${SUPABASE_REQUEST_TIMEOUT_MS}ms`)), SUPABASE_REQUEST_TIMEOUT_MS);
  const abortListener = () => controller.abort();

  if (init?.signal) {
    if (init.signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort();
    } else {
      init.signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
    if (init?.signal) {
      init.signal.removeEventListener('abort', abortListener);
    }
  }
};

export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: supabaseFetch,
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
const VISITOR_PRESENCE_TABLE = 'VisitorPresence';
const VISITOR_DAILY_TABLE = 'VisitorDaily';
const TRADE_SIGNAL_TABLE = 'TradeSignal';
const RISK_SETTINGS_TABLE = 'RiskSettings';
const UPLOAD_ERROR_TABLE = 'upload_errors';
const AUTO_TRADE_SETTINGS_TABLE = 'AutoTradeSettings';
const USER_TRADING_SETTINGS_TABLE = 'user_trading_settings';
const MT5_ACCOUNTS_TABLE = 'mt5_accounts';
const AUTO_TRADE_TABLE = 'AutoTrade';
const AUTO_TRADE_LOG_TABLE = 'AutoTradeLog';
const AUTO_PERFORMANCE_TABLE = 'AutoPerformance';

export type SubscriptionTier = 'FREE' | 'PRO' | 'TOP_TIER' | 'VIP_AUTO_TRADER';
export type UserRole = 'USER' | 'ADMIN';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
export type PaymentMethod = 'PAYPAL' | 'CARD' | 'BANK_TRANSFER' | 'COUPON';
export type BankTransferBank = 'SCOTIABANK' | 'NCB';
export type AnalysisStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_ON_USER' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketCategory = 'ACCOUNT' | 'BILLING' | 'ANALYSIS' | 'BUG' | 'FEATURE' | 'GENERAL';
export type UploadErrorType = 'INVALID_TYPE' | 'FILE_TOO_LARGE' | 'CORRUPTED_FILE' | 'READ_ERROR' | 'EMPTY_IMAGE';

export type SignalDirection = 'buy' | 'sell';
export type SignalConfidence = 'A+' | 'A' | 'B' | 'avoid';
export type SignalStatus = 'pending' | 'ready' | 'executed' | 'cancelled' | 'expired';
export type SignalMarketState = 'trending' | 'ranging' | 'choppy' | 'reversal';
export type AutoMode = 'manual' | 'semi' | 'full';
export type AutoTradeMode = 'off' | 'assisted' | 'semi' | 'full';
export type StrategyMode = 'standard' | 'gold_scalper';
export type SmartStrategyMode = 'standard' | 'gold_scalper' | 'spike_reaction';
export type TradingPersonality = 'conservative' | 'balanced' | 'aggressive';
export type AllowedTradingSession = 'london' | 'newyork';
export type AllowedTradingAsset = 'gold' | 'indices' | 'forex';
export type MT5AccountStatus = 'connecting' | 'connected' | 'failed';
export type AutoTradeStatus = 'pending' | 'executed' | 'closed' | 'rejected';
export type AutoTradeResult = 'win' | 'loss' | 'breakeven';
export type AutoTradeLogAction = 'signal_received' | 'executed' | 'rejected' | 'closed' | 'emergency_stop' | 'breakeven';

export interface UserTradingSettingsRecord {
  user_id: string;
  strategy_mode: SmartStrategyMode;
  personality: TradingPersonality;
  min_confidence: number;
  allowed_sessions: AllowedTradingSession[];
  allowed_assets: AllowedTradingAsset[];
  auto_pause_enabled: boolean;
  max_losses_in_row: number;
  created_at: string;
  updated_at: string;
}

const DEFAULT_USER_TRADING_SETTINGS: Omit<UserTradingSettingsRecord, 'user_id' | 'created_at' | 'updated_at'> = {
  strategy_mode: 'standard',
  personality: 'balanced',
  min_confidence: 6,
  allowed_sessions: ['london', 'newyork'],
  allowed_assets: ['gold', 'forex'],
  auto_pause_enabled: true,
  max_losses_in_row: 2,
};

export const hasPaidSubscription = (subscription: SubscriptionTier | string) => subscription === 'PRO' || subscription === 'TOP_TIER' || subscription === 'VIP_AUTO_TRADER';
export const hasAutoTraderSubscription = (subscription: SubscriptionTier | string) => subscription === 'VIP_AUTO_TRADER';
export const hasTopTierAccess = (subscription: SubscriptionTier | string) => subscription === 'TOP_TIER' || subscription === 'VIP_AUTO_TRADER';
export const getMonthlyAnalysisLimit = (subscription: SubscriptionTier | string) => (subscription === 'TOP_TIER' || subscription === 'VIP_AUTO_TRADER') ? config.limits.topTierMonthly : config.limits.proMonthly;

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
  paymentMethods?: PaymentMethod[];
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
    features: ['300 analyses per month', 'Advanced Smart Money Concepts', 'Priority AI processing'],
    dailyLimit: 999999,
    isActive: true,
  },
  {
    name: 'Top Tier 👑',
    tier: 'TOP_TIER',
    price: 39.95,
    features: ['500 analyses per month', 'Advanced Smart Money Concepts', 'Priority AI processing', 'One-Tap Trade execution'],
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

export type AnnouncementType = 'update' | 'maintenance' | 'discount' | 'new_feature' | 'security' | 'event';

export interface AnnouncementContentPayload {
  body: string;
  expiresAt: string | null;
  type?: AnnouncementType;
  couponCode?: string | null;
  targetPlan?: 'PRO' | 'TOP_TIER' | null;
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

export interface VisitorPresenceRecord {
  id: string;
  sessionId: string;
  userId: string | null;
  currentPath: string | null;
  userAgent: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface VisitorDailyRecord {
  id: string;
  sessionId: string;
  visitorDate: string;
  userId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface TradeSignalRecord {
  id: string;
  userId: string;
  symbol: string;
  direction: SignalDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: SignalConfidence;
  status: SignalStatus;
  analysisId: string | null;
  label: string | null;
  marketState: SignalMarketState | null;
  strategy: string | null;
  score: number | null;
  confirmations: string[];
  explanation: string | null;
  secondaryTrade: {
    direction: SignalDirection;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    confidence: SignalConfidence;
    label?: string | null;
    marketState?: SignalMarketState | null;
    strategy?: string | null;
    score?: number | null;
    confirmations?: string[];
    explanation?: string | null;
    warning?: string | null;
  } | null;
  lotSize: number | null;
  executedAt: string | null;
  cancelledAt: string | null;
  ticket: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RiskSettingsRecord {
  id: string;
  userId: string;
  riskPerTrade: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  autoMode: AutoMode;
  killSwitch: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutoTradeSettingsRecord {
  id: string;
  userId: string;
  autoMode: AutoTradeMode;
  strategyMode: StrategyMode;
  riskPerTrade: number;
  maxDailyLoss: number;
  maxTradesPerDay: number;
  allowedSessions: string[];
  goldOnly: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MT5AccountRecord {
  id: string;
  user_id: string;
  metaapi_account_id: string;
  login: string;
  server: string;
  status: MT5AccountStatus;
  created_at: string;
}

export interface AutoTradeRecord {
  id: string;
  userId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  sl: number;
  tp: number;
  lotSize: number;
  status: AutoTradeStatus;
  result: AutoTradeResult | null;
  profit: number | null;
  mt5OrderId: string | null;
  scanResultId: string | null;
  confidence: string | null;
  marketState: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface AutoTradeLogRecord {
  id: string;
  userId: string;
  tradeId: string | null;
  action: AutoTradeLogAction;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AutoPerformanceRecord {
  id: string;
  userId: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  drawdown: number;
  lastUpdated: string;
}

export interface LivePlatformMetrics {
  currentVisitors: number;
  totalVisitorsToday: number;
  activeAnalyses: number;
  totalAnalysesToday: number;
}

export class DatabaseOperationError extends Error {
  context: string;
  transient: boolean;
  originalError: unknown;

  constructor(context: string, error: unknown) {
    super('Database operation failed');
    this.name = 'DatabaseOperationError';
    this.context = context;
    this.transient = isTransientSupabaseError(error);
    this.originalError = error;
  }
}

const logDbError = (context: string, error: unknown) => {
  console.error(`Database error: ${context}`, error);
  throw new DatabaseOperationError(context, error);
};

const isTransientDatabaseOperationError = (error: unknown): error is DatabaseOperationError =>
  error instanceof DatabaseOperationError && error.transient;

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

export const logUploadError = async (values: {
  userId?: string | null;
  errorType: UploadErrorType;
  fileType?: string | null;
  fileSize?: number | null;
  source?: string | null;
  stage?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}) => {
  const { error } = await supabase.from(UPLOAD_ERROR_TABLE).insert({
    userId: values.userId ?? null,
    error_type: values.errorType,
    file_type: values.fileType ?? null,
    file_size: values.fileSize ?? null,
    source: values.source ?? 'chart-upload',
    stage: values.stage ?? null,
    message: values.message ?? null,
    metadata: values.metadata ?? null,
  });

  if (error) {
    console.warn('[upload-errors] Failed to log upload error:', error.message);
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

export const createUser = async (values: Partial<UserRecord> & Pick<UserRecord, 'email' | 'role'>) => {
  const user = await insertSingle<UserRecord>('createUser', USER_TABLE, {
    subscription: 'FREE',
    dailyUsage: 0,
    lastUsageReset: new Date().toISOString(),
    banned: false,
    ...values,
  });

  await ensureUserTradingSettings(user.id);
  return user;
};

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
  type ListedUserRow = Pick<UserRecord, 'id' | 'email' | 'name' | 'role' | 'subscription' | 'banned' | 'dailyUsage' | 'lastUsageReset' | 'createdAt'>;

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

  const users = (data as ListedUserRow[] | null) ?? [];
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
        hasPaidSubscription(user.subscription)
          ? {
              current: analysisRows.reduce((count, row) => {
                const usageWindowStart = user.lastUsageReset && user.lastUsageReset > monthStartIso ? user.lastUsageReset : monthStartIso;
                if (row.userId === user.id && row.createdAt >= usageWindowStart) {
                  return count + 1;
                }
                return count;
              }, 0),
              limit: getMonthlyAnalysisLimit(user.subscription),
              period: 'month',
            }
          : {
              current: getUsageDayStamp(user.lastUsageReset || new Date(0).toISOString()) === todayStamp ? user.dailyUsage || 0 : 0,
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
  const usageDayStamp = getUsageDayStamp(user.lastUsageReset || new Date(0).toISOString());
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

export const createAnalysis = async (values: Partial<AnalysisRecord> & Pick<AnalysisRecord, 'id' | 'jobId' | 'userId' | 'imageUrl' | 'pair' | 'timeframe'>) => {
  const analysis = await insertSingle<AnalysisRecord>('createAnalysis', ANALYSIS_TABLE, values);
  recordAnalysisCreated(analysis.createdAt);
  return analysis;
};

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

  if (filters.paymentMethods?.length) {
    query = query.in('paymentMethod', filters.paymentMethods);
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
  ).catch((error) => {
    if (isTransientDatabaseOperationError(error)) {
      console.warn('[announcements] returning empty active announcements because Supabase is timing out');
      return [];
    }

    throw error;
  });

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

export const createQueueJob = async (values: Pick<QueueJobRecord, 'userId' | 'priority' | 'inputData'> & { analysisId?: string }) => {
  const job = await insertSingle<QueueJobRecord>('createQueueJob', QUEUE_TABLE, {
    status: 'queued',
    retryCount: 0,
    ...values,
  });
  recordQueueJobState(job.id, job.status);
  return job;
};

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

  if (data) {
    recordQueueJobState((data as QueueJobRecord).id, (data as QueueJobRecord).status);
  }

  return (data as QueueJobRecord | null) ?? null;
};

export const updateQueueJob = async (id: string, values: Partial<QueueJobRecord>) => {
  const job = await updateSingle<QueueJobRecord>('updateQueueJob', QUEUE_TABLE, values, (query) => query.eq('id', id));
  recordQueueJobState(job.id, job.status);
  return job;
};

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

  recordQueueJobState((claimed as QueueJobRecord).id, (claimed as QueueJobRecord).status);

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

export const upsertVisitorPresence = async (values: {
  sessionId: string;
  userId?: string | null;
  currentPath?: string | null;
  userAgent?: string | null;
  lastSeenAt?: string;
}) => {
  const now = values.lastSeenAt ?? new Date().toISOString();
  const { data, error } = await supabase
    .from(VISITOR_PRESENCE_TABLE)
    .upsert({
      sessionId: values.sessionId,
      userId: values.userId ?? null,
      currentPath: values.currentPath ?? null,
      userAgent: values.userAgent ?? null,
      lastSeenAt: now,
    }, {
      onConflict: 'sessionId',
    })
    .select('*')
    .maybeSingle();

  if (error) {
    const dbError = new DatabaseOperationError('upsertVisitorPresence', error);
    if (dbError.transient) {
      console.warn('[presence] skipped visitor presence upsert because Supabase is timing out');
      return null;
    }
    throw dbError;
  }

  return (data as VisitorPresenceRecord | null) ?? null;
};

export const upsertVisitorDailyRecord = async (values: {
  sessionId: string;
  visitorDate: string;
  userId?: string | null;
  lastSeenAt?: string;
}) => {
  const now = values.lastSeenAt ?? new Date().toISOString();
  const { data, error } = await supabase
    .from(VISITOR_DAILY_TABLE)
    .upsert({
      sessionId: values.sessionId,
      visitorDate: values.visitorDate,
      userId: values.userId ?? null,
      lastSeenAt: now,
    }, {
      onConflict: 'sessionId,visitorDate',
    })
    .select('*')
    .maybeSingle();

  if (error) {
    const dbError = new DatabaseOperationError('upsertVisitorDailyRecord', error);
    if (dbError.transient) {
      console.warn('[presence] skipped visitor daily upsert because Supabase is timing out');
      return null;
    }
    throw dbError;
  }

  return (data as VisitorDailyRecord | null) ?? null;
};

export const getLivePlatformMetrics = async (todayDate: string, todayStartIso: string, activeSinceIso: string): Promise<LivePlatformMetrics> => {
  void todayStartIso;
  return getLivePlatformMetricsSnapshot(todayDate, activeSinceIso);
};

// ── AutoTrader: Trade signals ──

export const createTradeSignal = (values: Omit<TradeSignalRecord, 'id' | 'createdAt' | 'updatedAt' | 'executedAt' | 'cancelledAt' | 'ticket'>) =>
  insertSingle<TradeSignalRecord>('createTradeSignal', TRADE_SIGNAL_TABLE, values);

export const getTradeSignalById = (id: string, userId: string) =>
  maybeSingle<TradeSignalRecord>('getTradeSignalById', supabase.from(TRADE_SIGNAL_TABLE).select('*').eq('id', id).eq('userId', userId).maybeSingle());

export const listTradeSignalsForUser = async (userId: string, status?: SignalStatus, limit = 50) => {
  let query = supabase.from(TRADE_SIGNAL_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  return many<TradeSignalRecord>('listTradeSignalsForUser', query);
};

export const listPendingSignalsForUser = (userId: string) =>
  many<TradeSignalRecord>('listPendingSignalsForUser', supabase.from(TRADE_SIGNAL_TABLE).select('*').eq('userId', userId).in('status', ['pending', 'ready']).order('createdAt', { ascending: false }));

export const updateTradeSignal = (id: string, userId: string, values: Partial<TradeSignalRecord>) =>
  updateSingle<TradeSignalRecord>('updateTradeSignal', TRADE_SIGNAL_TABLE, {
    ...values,
    updatedAt: new Date().toISOString(),
  }, (q) => q.eq('id', id).eq('userId', userId));

export const confirmSignalExecution = (id: string, userId: string, ticket: string, lotSize?: number) =>
  updateSingle<TradeSignalRecord>('confirmSignalExecution', TRADE_SIGNAL_TABLE, {
    status: 'executed' as SignalStatus,
    ticket,
    lotSize: lotSize ?? null,
    executedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, (q) => q.eq('id', id).eq('userId', userId));

export const cancelTradeSignal = (id: string, userId: string) =>
  updateSingle<TradeSignalRecord>('cancelTradeSignal', TRADE_SIGNAL_TABLE, {
    status: 'cancelled' as SignalStatus,
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, (q) => q.eq('id', id).eq('userId', userId));

export const countTodayExecutedSignals = (userId: string, todayStartIso: string) =>
  countRows('countTodayExecutedSignals', TRADE_SIGNAL_TABLE, (q) =>
    q.eq('userId', userId).eq('status', 'executed').gte('executedAt', todayStartIso));

// ── AutoTrader: Risk settings ──

export const getRiskSettings = (userId: string) =>
  maybeSingle<RiskSettingsRecord>('getRiskSettings', supabase.from(RISK_SETTINGS_TABLE).select('*').eq('userId', userId).maybeSingle());

export const upsertRiskSettings = async (userId: string, values: Partial<Pick<RiskSettingsRecord, 'riskPerTrade' | 'maxDailyLoss' | 'maxTradesPerDay' | 'autoMode' | 'killSwitch'>>) => {
  const existing = await getRiskSettings(userId);
  if (existing) {
    return updateSingle<RiskSettingsRecord>('upsertRiskSettings:update', RISK_SETTINGS_TABLE, {
      ...values,
      updatedAt: new Date().toISOString(),
    }, (q) => q.eq('id', existing.id));
  }
  return insertSingle<RiskSettingsRecord>('upsertRiskSettings:insert', RISK_SETTINGS_TABLE, {
    userId,
    riskPerTrade: 1.0,
    maxDailyLoss: 5.0,
    maxTradesPerDay: 3,
    autoMode: 'manual',
    killSwitch: false,
    ...values,
  });
};

export const toggleKillSwitch = async (userId: string, enabled: boolean) => {
  const existing = await getRiskSettings(userId);
  if (existing) {
    return updateSingle<RiskSettingsRecord>('toggleKillSwitch', RISK_SETTINGS_TABLE, {
      killSwitch: enabled,
      updatedAt: new Date().toISOString(),
    }, (q) => q.eq('id', existing.id));
  }
  return insertSingle<RiskSettingsRecord>('toggleKillSwitch:insert', RISK_SETTINGS_TABLE, {
    userId,
    riskPerTrade: 1.0,
    maxDailyLoss: 5.0,
    maxTradesPerDay: 3,
    autoMode: 'manual',
    killSwitch: enabled,
  });
};

// ── Auto Trading: Settings ──

export const getAutoTradeSettings = (userId: string) =>
  maybeSingle<AutoTradeSettingsRecord>('getAutoTradeSettings', supabase.from(AUTO_TRADE_SETTINGS_TABLE).select('*').eq('userId', userId).maybeSingle());

export const getMT5AccountByUserId = (userId: string) =>
  maybeSingle<MT5AccountRecord>('getMT5AccountByUserId', supabase.from(MT5_ACCOUNTS_TABLE).select('*').eq('user_id', userId).maybeSingle());

export const listAllMT5Accounts = () =>
  many<MT5AccountRecord>('listAllMT5Accounts', supabase.from(MT5_ACCOUNTS_TABLE).select('*').order('created_at', { ascending: false }));

export const getUserTradingSettings = (userId: string) =>
  maybeSingle<UserTradingSettingsRecord>('getUserTradingSettings', supabase.from(USER_TRADING_SETTINGS_TABLE).select('*').eq('user_id', userId).maybeSingle());

export const upsertUserTradingSettings = async (
  userId: string,
  values: Partial<Omit<UserTradingSettingsRecord, 'user_id' | 'created_at' | 'updated_at'>>,
) => {
  const existing = await getUserTradingSettings(userId);
  if (existing) {
    return updateSingle<UserTradingSettingsRecord>('upsertUserTradingSettings:update', USER_TRADING_SETTINGS_TABLE, {
      ...values,
      updated_at: new Date().toISOString(),
    }, (q) => q.eq('user_id', userId));
  }

  return insertSingle<UserTradingSettingsRecord>('upsertUserTradingSettings:insert', USER_TRADING_SETTINGS_TABLE, {
    user_id: userId,
    ...DEFAULT_USER_TRADING_SETTINGS,
    ...values,
  });
};

export const ensureUserTradingSettings = async (userId: string) => {
  const existing = await getUserTradingSettings(userId);
  if (existing) {
    return existing;
  }

  return upsertUserTradingSettings(userId, DEFAULT_USER_TRADING_SETTINGS);
};

export const upsertMT5Account = async (
  userId: string,
  values: Omit<MT5AccountRecord, 'id' | 'user_id' | 'created_at'>,
) => {
  const existing = await getMT5AccountByUserId(userId);
  if (existing) {
    return updateSingle<MT5AccountRecord>('upsertMT5Account:update', MT5_ACCOUNTS_TABLE, {
      ...values,
    }, (q) => q.eq('user_id', userId));
  }

  return insertSingle<MT5AccountRecord>('upsertMT5Account:insert', MT5_ACCOUNTS_TABLE, {
    user_id: userId,
    ...values,
  });
};

export const deleteMT5AccountByUserId = async (userId: string) => {
  const { error } = await supabase.from(MT5_ACCOUNTS_TABLE).delete().eq('user_id', userId);
  if (error) {
    logDbError('deleteMT5AccountByUserId', error);
  }
};

export const upsertAutoTradeSettings = async (userId: string, values: Partial<Omit<AutoTradeSettingsRecord, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>) => {
  const existing = await getAutoTradeSettings(userId);
  if (existing) {
    return updateSingle<AutoTradeSettingsRecord>('upsertAutoTradeSettings:update', AUTO_TRADE_SETTINGS_TABLE, {
      ...values,
      updatedAt: new Date().toISOString(),
    }, (q) => q.eq('id', existing.id));
  }
  return insertSingle<AutoTradeSettingsRecord>('upsertAutoTradeSettings:insert', AUTO_TRADE_SETTINGS_TABLE, {
    userId,
    autoMode: 'off',
    riskPerTrade: 1.0,
    maxDailyLoss: 5.0,
    maxTradesPerDay: 3,
    allowedSessions: ['london', 'newyork'],
    goldOnly: true,
    isActive: false,
    ...values,
  });
};

export const getAllActiveAutoTradeSettings = () =>
  many<AutoTradeSettingsRecord & { User?: { email: string; name: string | null } }>(
    'getAllActiveAutoTradeSettings',
    supabase.from(AUTO_TRADE_SETTINGS_TABLE).select('*, User:userId(email, name)').eq('isActive', true),
  );

export const getAllAutoTradeSettings = () =>
  many<AutoTradeSettingsRecord & { User?: { email: string; name: string | null } }>(
    'getAllAutoTradeSettings',
    supabase.from(AUTO_TRADE_SETTINGS_TABLE).select('*, User:userId(email, name)').order('updatedAt', { ascending: false }),
  );

export const disableAutoTradeForUser = (userId: string) =>
  upsertAutoTradeSettings(userId, { autoMode: 'off' as AutoTradeMode, isActive: false });

// ── Auto Trading: Trades ──

export const createAutoTrade = (values: Omit<AutoTradeRecord, 'id' | 'createdAt' | 'closedAt' | 'result' | 'profit'> & { result?: AutoTradeResult | null; profit?: number | null }) =>
  insertSingle<AutoTradeRecord>('createAutoTrade', AUTO_TRADE_TABLE, values);

export const getAutoTradeById = (id: string) =>
  maybeSingle<AutoTradeRecord>('getAutoTradeById', supabase.from(AUTO_TRADE_TABLE).select('*').eq('id', id).maybeSingle());

export const listAutoTradesForUser = async (userId: string, status?: AutoTradeStatus, limit = 50) => {
  let query = supabase.from(AUTO_TRADE_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }).limit(limit);
  if (status) query = query.eq('status', status);
  return many<AutoTradeRecord>('listAutoTradesForUser', query);
};

export const updateAutoTrade = (id: string, values: Partial<AutoTradeRecord>) =>
  updateSingle<AutoTradeRecord>('updateAutoTrade', AUTO_TRADE_TABLE, values, (q) => q.eq('id', id));

export const countTodayAutoTrades = async (userId: string, todayStartIso: string) =>
  countRows('countTodayAutoTrades', AUTO_TRADE_TABLE, (q) =>
    q.eq('userId', userId).in('status', ['executed', 'closed']).gte('createdAt', todayStartIso));

export const getTodayAutoTradesProfit = async (userId: string, todayStartIso: string): Promise<number> => {
  const trades = await many<AutoTradeRecord>('getTodayAutoTradesProfit',
    supabase.from(AUTO_TRADE_TABLE).select('profit').eq('userId', userId).eq('status', 'closed').gte('createdAt', todayStartIso));
  return trades.reduce((sum, t) => sum + (t.profit ?? 0), 0);
};

export const getOpenAutoTrades = (userId: string) =>
  many<AutoTradeRecord>('getOpenAutoTrades',
    supabase.from(AUTO_TRADE_TABLE).select('*').eq('userId', userId).in('status', ['pending', 'executed']).order('createdAt', { ascending: false }));

export const getPendingAutoTrades = (userId: string) =>
  many<AutoTradeRecord>('getPendingAutoTrades',
    supabase.from(AUTO_TRADE_TABLE).select('*').eq('userId', userId).eq('status', 'pending').order('createdAt', { ascending: false }));

// ── Auto Trading: Logs ──

export const createAutoTradeLog = (values: Omit<AutoTradeLogRecord, 'id' | 'createdAt'>) =>
  insertSingle<AutoTradeLogRecord>('createAutoTradeLog', AUTO_TRADE_LOG_TABLE, values);

export const listAutoTradeLogsForUser = (userId: string, limit = 100) =>
  many<AutoTradeLogRecord>('listAutoTradeLogsForUser',
    supabase.from(AUTO_TRADE_LOG_TABLE).select('*').eq('userId', userId).order('createdAt', { ascending: false }).limit(limit));

export const listAllAutoTradeLogs = (limit = 200) =>
  many<AutoTradeLogRecord>('listAllAutoTradeLogs',
    supabase.from(AUTO_TRADE_LOG_TABLE).select('*').order('createdAt', { ascending: false }).limit(limit));

// ── Auto Trading: Performance ──

export const getAutoPerformance = (userId: string) =>
  maybeSingle<AutoPerformanceRecord>('getAutoPerformance', supabase.from(AUTO_PERFORMANCE_TABLE).select('*').eq('userId', userId).maybeSingle());

export const updateAutoPerformance = async (userId: string, values: Partial<Omit<AutoPerformanceRecord, 'id' | 'userId'>>) => {
  const existing = await getAutoPerformance(userId);
  if (existing) {
    return updateSingle<AutoPerformanceRecord>('updateAutoPerformance:update', AUTO_PERFORMANCE_TABLE, {
      ...values,
      lastUpdated: new Date().toISOString(),
    }, (q) => q.eq('id', existing.id));
  }
  return insertSingle<AutoPerformanceRecord>('updateAutoPerformance:insert', AUTO_PERFORMANCE_TABLE, {
    userId,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalProfit: 0,
    drawdown: 0,
    ...values,
    lastUpdated: new Date().toISOString(),
  });
};

export const getAllAutoPerformance = () =>
  many<AutoPerformanceRecord>('getAllAutoPerformance',
    supabase.from(AUTO_PERFORMANCE_TABLE).select('*').order('totalProfit', { ascending: false }));

// ── Admin: Auto Trading aggregates ──

export const countTodayAllAutoTrades = async (todayStartIso: string) =>
  countRows('countTodayAllAutoTrades', AUTO_TRADE_TABLE, (q) =>
    q.in('status', ['executed', 'closed']).gte('createdAt', todayStartIso));

export const getTodayAllAutoTradesProfit = async (todayStartIso: string): Promise<number> => {
  const trades = await many<AutoTradeRecord>('getTodayAllAutoTradesProfit',
    supabase.from(AUTO_TRADE_TABLE).select('profit').eq('status', 'closed').gte('createdAt', todayStartIso));
  return trades.reduce((sum, t) => sum + (t.profit ?? 0), 0);
};