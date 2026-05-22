import { getDerivHistoryCandles } from '../lib/deriv/ws';
import { getSystemSetting, supabase } from '../lib/supabase';
import { fetchMarketDataForLiveChart } from './marketData';
import { sendPushToUser } from './pushService';
import { scanSignalsMarket, type ActiveMarketSignal, type SignalScanTarget } from './signalsMonitor';

type FindTradeCategory = 'forex' | 'indices' | 'commodities' | 'crypto' | 'deriv' | 'volatility';
type FindTradeSource = 'deriv' | 'tradingview';
type OpportunitySection = 'best_active' | 'developing' | 'no_trade';
type OpportunityState = 'available' | 'watchlist' | 'ignored' | 'entered' | 'archived';
type TrackingStatus = 'monitoring' | 'running_profit' | 'tp_hit' | 'sl_hit' | 'expired' | 'manual_close' | 'cancelled';
type JournalOutcome = 'open' | 'win' | 'loss' | 'breakeven' | 'expired' | 'manual_close';
type ScanMode = 'on_demand' | 'manual_refresh' | 'manual_reset' | 'daily_auto_clear';

interface MarketTargetDefinition {
  source: FindTradeSource;
  category: FindTradeCategory;
  symbol: string;
  symbolLabel: string;
  assetClass: string;
}

interface ScanSignalCandidate {
  signal: ActiveMarketSignal;
  category: FindTradeCategory;
  weightedScore: number;
  qualityGrade: 'A+' | 'A' | 'B+' | 'B' | 'C';
}

interface FindTradeScanRow {
  id: string;
  user_id: string;
  status: 'active' | 'archived' | 'reset';
  scan_mode: ScanMode;
  market_scope: FindTradeCategory[];
  scan_summary: Record<string, unknown>;
  generated_at: string;
  expires_at: string;
  reset_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TradeOpportunityRow {
  id: string;
  scan_id: string;
  user_id: string;
  section: OpportunitySection;
  state: OpportunityState;
  source: FindTradeSource | null;
  category: FindTradeCategory | null;
  symbol: string | null;
  symbol_label: string | null;
  asset_class: string | null;
  timeframe: string | null;
  session_type: 'asian' | 'london' | 'newyork' | null;
  direction: 'buy' | 'sell' | null;
  confidence_score: number | null;
  weighted_score: number | string | null;
  quality_grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | null;
  rr_ratio: number | string | null;
  entry_price: number | string | null;
  stop_loss: number | string | null;
  take_profit: number | string | null;
  current_price: number | string | null;
  setup_label: string | null;
  reasoning: string | null;
  execution_note: string | null;
  developing_note: string | null;
  empty_state_message: string | null;
  confluences: string[];
  quality_breakdown: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  ranking: number;
  published_at: string;
}

interface TradeTrackingRow {
  id: string;
  user_id: string;
  scan_id: string;
  opportunity_id: string;
  source: FindTradeSource;
  symbol: string;
  symbol_label: string;
  asset_class: string;
  timeframe: string;
  session_type: 'asian' | 'london' | 'newyork';
  direction: 'buy' | 'sell';
  status: TrackingStatus;
  confidence_score: number;
  quality_grade: 'A+' | 'A' | 'B+' | 'B' | 'C';
  rr_ratio: number | string;
  entry_price: number | string;
  stop_loss: number | string;
  take_profit: number | string;
  current_price: number | string | null;
  progress_percent: number | string;
  notification_frequency_minutes: number;
  entered_at: string;
  last_checked_at: string | null;
  next_check_at: string | null;
  resolved_at: string | null;
}

interface TradeUpdateRow {
  id: string;
  user_id: string;
  tracking_id: string;
  update_type: 'status' | 'monitor' | 'risk' | 'target' | 'journal';
  status: TrackingStatus | null;
  title: string;
  message: string;
  progress_percent: number | string | null;
  current_price: number | string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface TradeJournalRow {
  id: string;
  user_id: string;
  scan_id: string;
  opportunity_id: string;
  tracking_id: string;
  source: FindTradeSource;
  symbol: string;
  symbol_label: string;
  asset_class: string;
  timeframe: string;
  session_type: 'asian' | 'london' | 'newyork';
  direction: 'buy' | 'sell';
  confidence_score: number;
  quality_grade: 'A+' | 'A' | 'B+' | 'B' | 'C';
  rr_ratio: number | string;
  entry_price: number | string;
  stop_loss: number | string;
  take_profit: number | string;
  outcome: JournalOutcome;
  duration_minutes: number | null;
  screenshots: Array<Record<string, unknown>>;
  setup_reasoning: string;
  ai_reflection: string | null;
  emotional_notes: string | null;
  performance_summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface UserWatchlistRow {
  id: string;
  user_id: string;
  opportunity_id: string | null;
  source: FindTradeSource;
  symbol: string;
  symbol_label: string;
  asset_class: string;
  timeframe: string;
  direction: 'buy' | 'sell' | null;
  setup_label: string | null;
  added_at: string;
  updated_at: string;
}

interface JournalInsightRow {
  id: string;
  user_id: string;
  insight_type: string;
  headline: string;
  detail: string;
  metric_value: number | string | null;
  as_of_date: string;
}

export interface FindTradeOpportunity {
  id: string;
  section: OpportunitySection;
  state: OpportunityState;
  source: FindTradeSource | null;
  category: FindTradeCategory | null;
  symbol: string | null;
  symbolLabel: string | null;
  assetClass: string | null;
  timeframe: string | null;
  sessionType: 'asian' | 'london' | 'newyork' | null;
  direction: 'buy' | 'sell' | null;
  confidenceScore: number | null;
  weightedScore: number | null;
  qualityGrade: 'A+' | 'A' | 'B+' | 'B' | 'C' | null;
  rrRatio: number | null;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  currentPrice: number | null;
  setupLabel: string | null;
  reasoning: string | null;
  executionNote: string | null;
  developingNote: string | null;
  emptyStateMessage: string | null;
  confluences: string[];
  qualityBreakdown: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  ranking: number;
  publishedAt: string;
}

export interface FindTradeTrackingStatus {
  id: string;
  opportunityId: string;
  source: FindTradeSource;
  symbol: string;
  symbolLabel: string;
  assetClass: string;
  timeframe: string;
  sessionType: 'asian' | 'london' | 'newyork';
  direction: 'buy' | 'sell';
  status: TrackingStatus;
  confidenceScore: number;
  qualityGrade: 'A+' | 'A' | 'B+' | 'B' | 'C';
  rrRatio: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number | null;
  progressPercent: number;
  enteredAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  resolvedAt: string | null;
  latestUpdate: {
    id: string;
    title: string;
    message: string;
    createdAt: string;
  } | null;
}

export interface FindTradeJournalEntry {
  id: string;
  trackingId: string;
  source: FindTradeSource;
  symbol: string;
  symbolLabel: string;
  assetClass: string;
  timeframe: string;
  sessionType: 'asian' | 'london' | 'newyork';
  direction: 'buy' | 'sell';
  confidenceScore: number;
  qualityGrade: 'A+' | 'A' | 'B+' | 'B' | 'C';
  rrRatio: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  outcome: JournalOutcome;
  durationMinutes: number | null;
  setupReasoning: string;
  aiReflection: string | null;
  emotionalNotes: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface FindTradeInsight {
  id: string;
  insightType: string;
  headline: string;
  detail: string;
  metricValue: number | null;
  asOfDate: string;
}

export interface FindTradeStatusPayload {
  scan: {
    id: string;
    status: 'active' | 'archived' | 'reset';
    mode: ScanMode;
    generatedAt: string;
    expiresAt: string;
    summary: Record<string, unknown>;
    enabledCategories: FindTradeCategory[];
  } | null;
  bestOpportunity: FindTradeOpportunity | null;
  developingOpportunities: FindTradeOpportunity[];
  noTradeState: FindTradeOpportunity | null;
  activeTracking: FindTradeTrackingStatus[];
  journalPreview: FindTradeJournalEntry[];
  insights: FindTradeInsight[];
  watchlist: Array<{
    id: string;
    source: FindTradeSource;
    symbol: string;
    symbolLabel: string;
    assetClass: string;
    timeframe: string;
    direction: 'buy' | 'sell' | null;
    setupLabel: string | null;
    addedAt: string;
  }>;
  notificationSummary: {
    activeTrades: number;
    recentNotifications: number;
    pollingIntervalMinutes: number;
  };
  onboarding: {
    setupGuideUrl: string;
  };
}

const FIND_TRADE_SCANS_TABLE = 'find_trade_scans';
const TRADE_OPPORTUNITIES_TABLE = 'trade_opportunities';
const TRADE_TRACKING_TABLE = 'trade_tracking';
const TRADE_UPDATES_TABLE = 'trade_updates';
const TRADE_JOURNAL_TABLE = 'trade_journal';
const TRADE_SNAPSHOTS_TABLE = 'trade_snapshots';
const TRADE_NOTIFICATIONS_TABLE = 'trade_notifications';
const JOURNAL_INSIGHTS_TABLE = 'journal_insights';
const USER_SCAN_HISTORY_TABLE = 'user_scan_history';
const USER_WATCHLISTS_TABLE = 'user_watchlists';
const PUSH_SUBSCRIPTIONS_TABLE = 'PushSubscription';

const MONITOR_POLL_INTERVAL_MS = 15 * 60_000;
const DEFAULT_NOTIFICATION_FREQUENCY_MINUTES = 180;
const DEFAULT_TRADINGVIEW_TIMEFRAME = 'M15';
const DEFAULT_DERIV_TIMEFRAME = '15m';
const FORCE_TEST_SIGNALS = /^true$/i.test(process.env.FORCE_TEST_SIGNALS ?? '');

const CATEGORY_KEYS: Record<FindTradeCategory, string> = {
  forex: 'find_trade_category_forex_enabled',
  indices: 'find_trade_category_indices_enabled',
  commodities: 'find_trade_category_commodities_enabled',
  crypto: 'find_trade_category_crypto_enabled',
  deriv: 'find_trade_category_deriv_enabled',
  volatility: 'find_trade_category_volatility_enabled',
};

const MARKET_CATALOG: MarketTargetDefinition[] = [
  { source: 'tradingview', category: 'forex', symbol: 'EURUSD', symbolLabel: 'EUR/USD', assetClass: 'forex-major' },
  { source: 'tradingview', category: 'forex', symbol: 'GBPUSD', symbolLabel: 'GBP/USD', assetClass: 'forex-major' },
  { source: 'tradingview', category: 'forex', symbol: 'USDJPY', symbolLabel: 'USD/JPY', assetClass: 'forex-major' },
  { source: 'tradingview', category: 'forex', symbol: 'USDCHF', symbolLabel: 'USD/CHF', assetClass: 'forex-major' },
  { source: 'tradingview', category: 'forex', symbol: 'USDCAD', symbolLabel: 'USD/CAD', assetClass: 'forex-major' },
  { source: 'tradingview', category: 'forex', symbol: 'AUDUSD', symbolLabel: 'AUD/USD', assetClass: 'forex-major' },
  { source: 'tradingview', category: 'forex', symbol: 'EURJPY', symbolLabel: 'EUR/JPY', assetClass: 'forex-minor' },
  { source: 'tradingview', category: 'forex', symbol: 'GBPJPY', symbolLabel: 'GBP/JPY', assetClass: 'forex-minor' },
  { source: 'tradingview', category: 'indices', symbol: 'NAS100', symbolLabel: 'NAS100', assetClass: 'indices' },
  { source: 'tradingview', category: 'indices', symbol: 'US30', symbolLabel: 'US30', assetClass: 'indices' },
  { source: 'tradingview', category: 'indices', symbol: 'SPX500', symbolLabel: 'SPX500', assetClass: 'indices' },
  { source: 'tradingview', category: 'indices', symbol: 'GER40', symbolLabel: 'GER40', assetClass: 'indices' },
  { source: 'tradingview', category: 'commodities', symbol: 'XAUUSD', symbolLabel: 'Gold', assetClass: 'commodities' },
  { source: 'tradingview', category: 'commodities', symbol: 'XAGUSD', symbolLabel: 'Silver', assetClass: 'commodities' },
  { source: 'tradingview', category: 'commodities', symbol: 'USOIL', symbolLabel: 'WTI Oil', assetClass: 'commodities' },
  { source: 'tradingview', category: 'crypto', symbol: 'BTCUSD', symbolLabel: 'BTC/USD', assetClass: 'crypto' },
  { source: 'tradingview', category: 'crypto', symbol: 'ETHUSD', symbolLabel: 'ETH/USD', assetClass: 'crypto' },
  { source: 'tradingview', category: 'crypto', symbol: 'SOLUSD', symbolLabel: 'SOL/USD', assetClass: 'crypto' },
  { source: 'deriv', category: 'deriv', symbol: 'JD25', symbolLabel: 'Jump 25', assetClass: 'jump' },
  { source: 'deriv', category: 'deriv', symbol: 'JD50', symbolLabel: 'Jump 50', assetClass: 'jump' },
  { source: 'deriv', category: 'deriv', symbol: 'stpRNG', symbolLabel: 'Step Index 100', assetClass: 'step' },
  { source: 'deriv', category: 'deriv', symbol: 'BOOM500', symbolLabel: 'Boom 500', assetClass: 'boom-crash' },
  { source: 'deriv', category: 'deriv', symbol: 'CRASH500', symbolLabel: 'Crash 500', assetClass: 'boom-crash' },
  { source: 'deriv', category: 'volatility', symbol: 'R_25', symbolLabel: 'Volatility 25', assetClass: 'volatility' },
  { source: 'deriv', category: 'volatility', symbol: 'R_50', symbolLabel: 'Volatility 50', assetClass: 'volatility' },
  { source: 'deriv', category: 'volatility', symbol: 'R_75', symbolLabel: 'Volatility 75', assetClass: 'volatility' },
  { source: 'deriv', category: 'volatility', symbol: '1HZ50V', symbolLabel: 'Volatility 50 (1s)', assetClass: 'volatility-1s' },
];

let monitorTimer: ReturnType<typeof setInterval> | null = null;
let monitorInFlight = false;

const toNumber = (value: unknown): number | null => {
  if (value == null) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const startOfTomorrowIso = () => {
  const next = new Date();
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
};

const fail = (context: string, error: { message: string }) => {
  throw new Error(`${context}: ${error.message}`);
};

async function selectMany<T>(context: string, query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    fail(context, error);
  }
  return data ?? [];
}

async function selectMaybeOne<T>(context: string, query: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    fail(context, error);
  }
  return data ?? null;
}

async function insertOne<T>(context: string, table: string, values: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(values).select('*').single();
  if (error) {
    fail(context, error);
  }
  return data as T;
}

async function insertMany<T>(context: string, table: string, values: Record<string, unknown>[]): Promise<T[]> {
  const { data, error } = await supabase.from(table).insert(values).select('*');
  if (error) {
    fail(context, error);
  }
  return (data ?? []) as T[];
}

async function updateRows(context: string, table: string, values: Record<string, unknown>, apply: (query: any) => any) {
  const { error } = await apply(supabase.from(table).update(values));
  if (error) {
    fail(context, error);
  }
}

const isSettingEnabled = (value: unknown, fallback = true) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
};

async function loadEnabledCategories(): Promise<Record<FindTradeCategory, boolean>> {
  const entries = await Promise.all(
    (Object.entries(CATEGORY_KEYS) as Array<[FindTradeCategory, string]>).map(async ([category, key]) => {
      const setting = await getSystemSetting(key);
      return [category, isSettingEnabled(setting?.value, true)] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<FindTradeCategory, boolean>;
}

async function loadTimeframes() {
  const [tradingviewSetting, derivSetting] = await Promise.all([
    getSystemSetting('find_trade_tradingview_timeframe'),
    getSystemSetting('find_trade_deriv_timeframe'),
  ]);

  return {
    tradingview: typeof tradingviewSetting?.value === 'string' ? tradingviewSetting.value : DEFAULT_TRADINGVIEW_TIMEFRAME,
    deriv: typeof derivSetting?.value === 'string' ? derivSetting.value : DEFAULT_DERIV_TIMEFRAME,
  };
}

function buildWeightedScore(signal: ActiveMarketSignal) {
  const structure = signal.quality.structure * 0.18;
  const liquidity = signal.quality.liquidity * 0.14;
  const fvg = signal.quality.fvg * 0.12;
  const session = signal.quality.session * 0.1;
  const trend = signal.quality.trend * 0.14;
  const volatility = signal.quality.volatility * 0.1;
  const rr = signal.quality.rr * 0.12;
  const confidence = signal.confidence * 0.1;
  return round2(structure + liquidity + fvg + session + trend + volatility + rr + confidence);
}

function getQualityGrade(weightedScore: number): 'A+' | 'A' | 'B+' | 'B' | 'C' {
  if (weightedScore >= 88) return 'A+';
  if (weightedScore >= 80) return 'A';
  if (weightedScore >= 72) return 'B+';
  if (weightedScore >= 64) return 'B';
  return 'C';
}

function getDevelopingNote(candidate: ScanSignalCandidate) {
  if (candidate.signal.confidence < 78) {
    return 'Awaiting cleaner confirmation before execution quality improves.';
  }

  if (candidate.signal.quality.liquidity < 75) {
    return 'Awaiting a more decisive liquidity sweep before activation.';
  }

  if (candidate.signal.quality.fvg < 75) {
    return 'Approaching value but waiting for a stronger imbalance reaction.';
  }

  return 'Structure is forming, but the workflow is waiting for final confirmation.';
}

function buildNoTradeMessage(errors: string[]) {
  if (errors.length > 0) {
    return 'Market conditions currently lack high-confluence opportunities. The system recommends patience while data access stabilizes.';
  }

  return 'Market conditions currently lack high-confluence opportunities. The system recommends patience.';
}

function getMonitoringMessage(status: TrackingStatus, direction: 'buy' | 'sell', progressPercent: number) {
  if (status === 'tp_hit') {
    return {
      title: 'Target reached',
      message: 'Trade completed at the planned target. Structure followed through cleanly.',
      updateType: 'target' as const,
    };
  }

  if (status === 'sl_hit') {
    return {
      title: 'Trade invalidated',
      message: 'The protected risk level was reached. The setup has been logged and closed calmly.',
      updateType: 'risk' as const,
    };
  }

  if (progressPercent >= 80) {
    return {
      title: 'Approaching target',
      message: 'Price is moving toward the target zone. Momentum remains constructive, but the system is still tracking structure.',
      updateType: 'monitor' as const,
    };
  }

  if (progressPercent >= 35) {
    return {
      title: 'Trade moving in profit',
      message: 'Price is maintaining favorable structure and holding into profit with measured follow-through.',
      updateType: 'status' as const,
    };
  }

  return {
    title: direction === 'buy' ? 'Bullish structure intact' : 'Bearish structure intact',
    message: 'The setup remains active. Momentum is being monitored for either continuation or weakening near risk.',
    updateType: 'monitor' as const,
  };
}

function buildTestSignals(): ScanSignalCandidate[] {
  const now = Math.floor(Date.now() / 1000);
  const baseSnapshot = {
    candles: Array.from({ length: 24 }, (_, index) => ({
      time: now - (24 - index) * 900,
      open: 3340 + index * 1.8,
      high: 3343 + index * 1.9,
      low: 3337 + index * 1.7,
      close: 3341 + index * 1.85,
    })),
    annotations: [
      { label: 'Liquidity Sweep', candleTime: now - 2700, price: 3361.2, tone: 'bullish' as const },
      { label: 'CHOCH', candleTime: now - 1800, price: 3366.4, tone: 'bullish' as const },
    ],
    zones: [
      { label: 'Demand', top: 3362.1, bottom: 3357.9, tone: 'demand' as const },
      { label: 'Entry', top: 3364.2, bottom: 3362.7, tone: 'entry' as const },
      { label: 'Risk', top: 3357.9, bottom: 3353.3, tone: 'risk' as const },
      { label: 'Target', top: 3382.8, bottom: 3379.8, tone: 'target' as const },
    ],
  };

  const signals: ActiveMarketSignal[] = [
    {
      key: 'force-test-best',
      source: 'tradingview',
      assetClass: 'commodities',
      session: 'newyork',
      direction: 'buy',
      symbol: 'XAUUSD',
      symbolLabel: 'Gold',
      timeframe: DEFAULT_TRADINGVIEW_TIMEFRAME,
      entry: 3364.2,
      stopLoss: 3353.3,
      takeProfit: 3382.8,
      confidence: 92,
      candleTime: now - 900,
      reason: 'Price respected bullish demand after a clean sweep, reclaimed structure, and aligned with session expansion.',
      executionNote: 'Wait for the entry band to hold before committing full risk.',
      setupLabel: 'NY Liquidity Reclaim',
      currentPrice: 3365.4,
      rrRatio: 1.71,
      grade: 'A+',
      status: 'active',
      confluences: ['HTF bias aligned', 'Liquidity sweep', 'Demand reaction', 'FVG hold'],
      quality: { structure: 92, liquidity: 90, fvg: 88, session: 91, trend: 89, volatility: 84, rr: 86 },
      snapshot: baseSnapshot,
    },
    {
      key: 'force-test-developing',
      source: 'deriv',
      assetClass: 'volatility',
      session: 'london',
      direction: 'sell',
      symbol: 'R_75',
      symbolLabel: 'Volatility 75',
      timeframe: DEFAULT_DERIV_TIMEFRAME,
      entry: 1456.2,
      stopLoss: 1468.5,
      takeProfit: 1435.1,
      confidence: 77,
      candleTime: now - 1200,
      reason: 'Price is pressing into supply after displacement, but the final reversal confirmation has not printed yet.',
      executionNote: 'Allow a decisive bearish confirmation before treating it as executable.',
      setupLabel: 'Supply Compression Watch',
      currentPrice: 1454.8,
      rrRatio: 1.72,
      grade: 'B+',
      status: 'active',
      confluences: ['Supply in play', 'Volatility expansion', 'RR acceptable'],
      quality: { structure: 74, liquidity: 76, fvg: 69, session: 78, trend: 72, volatility: 83, rr: 84 },
      snapshot: baseSnapshot,
    },
  ];

  return signals.map((signal) => {
    const weightedScore = buildWeightedScore(signal);
    return {
      signal,
      category: signal.source === 'deriv' ? 'volatility' : 'commodities',
      weightedScore,
      qualityGrade: getQualityGrade(weightedScore),
    };
  });
}

async function archiveExpiredScansForUser(userId: string) {
  const expiredRows = await selectMany<Pick<FindTradeScanRow, 'id'>>(
    'listExpiredFindTradeScans',
    supabase
      .from(FIND_TRADE_SCANS_TABLE)
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString()),
  );

  const scanIds = expiredRows.map((row) => row.id);
  if (scanIds.length === 0) {
    return;
  }

  await updateRows('archiveExpiredFindTradeScans', FIND_TRADE_SCANS_TABLE, { status: 'archived' }, (query) => query.in('id', scanIds));
  await updateRows('archiveExpiredTradeOpportunities', TRADE_OPPORTUNITIES_TABLE, { state: 'archived' }, (query) => query.in('scan_id', scanIds));
}

async function archiveCurrentActiveScan(userId: string, status: 'archived' | 'reset') {
  const rows = await selectMany<Pick<FindTradeScanRow, 'id'>>(
    'listCurrentFindTradeScans',
    supabase.from(FIND_TRADE_SCANS_TABLE).select('id').eq('user_id', userId).eq('status', 'active'),
  );

  const scanIds = rows.map((row) => row.id);
  if (scanIds.length === 0) {
    return;
  }

  await updateRows('archiveCurrentFindTradeScans', FIND_TRADE_SCANS_TABLE, { status, reset_at: status === 'reset' ? new Date().toISOString() : null }, (query) => query.in('id', scanIds));
  await updateRows('archiveCurrentFindTradeOpportunities', TRADE_OPPORTUNITIES_TABLE, { state: 'archived' }, (query) => query.in('scan_id', scanIds));
}

async function collectScanCandidates(): Promise<{ candidates: ScanSignalCandidate[]; enabledCategories: FindTradeCategory[]; errors: string[] }> {
  const enabledCategoriesMap = await loadEnabledCategories();
  const enabledCategories = (Object.entries(enabledCategoriesMap) as Array<[FindTradeCategory, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([category]) => category);
  const errors: string[] = [];

  if (FORCE_TEST_SIGNALS) {
    return { candidates: buildTestSignals(), enabledCategories, errors };
  }

  const timeframes = await loadTimeframes();
  const selectedTargets = MARKET_CATALOG.filter((target) => enabledCategoriesMap[target.category]);
  const bySource = {
    tradingview: selectedTargets.filter((target) => target.source === 'tradingview'),
    deriv: selectedTargets.filter((target) => target.source === 'deriv'),
  };

  const candidates: ScanSignalCandidate[] = [];

  const collectSource = async (source: FindTradeSource, timeframe: string, targets: MarketTargetDefinition[]) => {
    if (targets.length === 0) {
      return;
    }

    try {
      const signals = await scanSignalsMarket(
        source,
        timeframe,
        targets.map((target) => ({
          symbol: target.symbol,
          symbolLabel: target.symbolLabel,
          assetClass: target.assetClass,
        } satisfies SignalScanTarget)),
      );

      for (const signal of signals) {
        const market = targets.find((target) => target.symbol === signal.symbol);
        if (!market) {
          continue;
        }

        const weightedScore = buildWeightedScore(signal);
        candidates.push({
          signal: {
            ...signal,
            timeframe,
          },
          category: market.category,
          weightedScore,
          qualityGrade: getQualityGrade(weightedScore),
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Failed to scan ${source} market`);
    }
  };

  await Promise.all([
    collectSource('tradingview', timeframes.tradingview, bySource.tradingview),
    collectSource('deriv', timeframes.deriv, bySource.deriv),
  ]);

  candidates.sort((left, right) => {
    if (left.weightedScore !== right.weightedScore) {
      return right.weightedScore - left.weightedScore;
    }
    if (left.signal.confidence !== right.signal.confidence) {
      return right.signal.confidence - left.signal.confidence;
    }
    return right.signal.candleTime - left.signal.candleTime;
  });

  return { candidates, enabledCategories, errors };
}

function mapOpportunity(row: TradeOpportunityRow): FindTradeOpportunity {
  return {
    id: row.id,
    section: row.section,
    state: row.state,
    source: row.source,
    category: row.category,
    symbol: row.symbol,
    symbolLabel: row.symbol_label,
    assetClass: row.asset_class,
    timeframe: row.timeframe,
    sessionType: row.session_type,
    direction: row.direction,
    confidenceScore: row.confidence_score,
    weightedScore: toNumber(row.weighted_score),
    qualityGrade: row.quality_grade,
    rrRatio: toNumber(row.rr_ratio),
    entryPrice: toNumber(row.entry_price),
    stopLoss: toNumber(row.stop_loss),
    takeProfit: toNumber(row.take_profit),
    currentPrice: toNumber(row.current_price),
    setupLabel: row.setup_label,
    reasoning: row.reasoning,
    executionNote: row.execution_note,
    developingNote: row.developing_note,
    emptyStateMessage: row.empty_state_message,
    confluences: row.confluences ?? [],
    qualityBreakdown: row.quality_breakdown ?? {},
    snapshot: row.snapshot ?? {},
    ranking: row.ranking,
    publishedAt: row.published_at,
  };
}

function mapJournal(row: TradeJournalRow): FindTradeJournalEntry {
  return {
    id: row.id,
    trackingId: row.tracking_id,
    source: row.source,
    symbol: row.symbol,
    symbolLabel: row.symbol_label,
    assetClass: row.asset_class,
    timeframe: row.timeframe,
    sessionType: row.session_type,
    direction: row.direction,
    confidenceScore: row.confidence_score,
    qualityGrade: row.quality_grade,
    rrRatio: toNumber(row.rr_ratio) ?? 0,
    entryPrice: toNumber(row.entry_price) ?? 0,
    stopLoss: toNumber(row.stop_loss) ?? 0,
    takeProfit: toNumber(row.take_profit) ?? 0,
    outcome: row.outcome,
    durationMinutes: row.duration_minutes,
    setupReasoning: row.setup_reasoning,
    aiReflection: row.ai_reflection,
    emotionalNotes: row.emotional_notes,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

function mapInsight(row: JournalInsightRow): FindTradeInsight {
  return {
    id: row.id,
    insightType: row.insight_type,
    headline: row.headline,
    detail: row.detail,
    metricValue: toNumber(row.metric_value),
    asOfDate: row.as_of_date,
  };
}

async function buildInsights(userId: string): Promise<FindTradeInsight[]> {
  const journals = await selectMany<TradeJournalRow>(
    'listTradeJournalForInsights',
    supabase.from(TRADE_JOURNAL_TABLE).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(250),
  );

  const resolved = journals.filter((row) => row.outcome !== 'open');
  if (resolved.length === 0) {
    return [];
  }

  const wins = resolved.filter((row) => row.outcome === 'win');
  const averageRr = round2(
    resolved.reduce((sum, row) => sum + (toNumber(row.rr_ratio) ?? 0), 0) / Math.max(resolved.length, 1),
  );
  const winRate = round2((wins.length / Math.max(resolved.length, 1)) * 100);

  const sessionBuckets = resolved.reduce<Record<string, { wins: number; total: number }>>((accumulator, row) => {
    const bucket = accumulator[row.session_type] ?? { wins: 0, total: 0 };
    bucket.total += 1;
    if (row.outcome === 'win') {
      bucket.wins += 1;
    }
    accumulator[row.session_type] = bucket;
    return accumulator;
  }, {});

  const bestSessionEntry = Object.entries(sessionBuckets).sort((left, right) => {
    const leftRate = left[1].wins / Math.max(left[1].total, 1);
    const rightRate = right[1].wins / Math.max(right[1].total, 1);
    return rightRate - leftRate;
  })[0];

  const gradeBuckets = resolved.reduce<Record<string, { wins: number; total: number }>>((accumulator, row) => {
    const bucket = accumulator[row.quality_grade] ?? { wins: 0, total: 0 };
    bucket.total += 1;
    if (row.outcome === 'win') {
      bucket.wins += 1;
    }
    accumulator[row.quality_grade] = bucket;
    return accumulator;
  }, {});

  const bestGradeEntry = Object.entries(gradeBuckets).sort((left, right) => {
    const leftRate = left[1].wins / Math.max(left[1].total, 1);
    const rightRate = right[1].wins / Math.max(right[1].total, 1);
    return rightRate - leftRate;
  })[0];

  const assetBuckets = resolved.reduce<Record<string, { rr: number; total: number }>>((accumulator, row) => {
    const bucket = accumulator[row.asset_class] ?? { rr: 0, total: 0 };
    bucket.total += 1;
    bucket.rr += row.outcome === 'win' ? toNumber(row.rr_ratio) ?? 0 : 0;
    accumulator[row.asset_class] = bucket;
    return accumulator;
  }, {});
  const bestAssetEntry = Object.entries(assetBuckets).sort((left, right) => right[1].rr - left[1].rr)[0];

  const insights = [
    {
      insight_type: 'win_rate',
      headline: `Current journal win rate is ${winRate}%`,
      detail: `Resolved trades are averaging ${averageRr}R, giving the journal a measured performance baseline instead of noisy signal counts.`,
      metric_value: winRate,
      as_of_date: new Date().toISOString().slice(0, 10),
    },
    bestSessionEntry
      ? {
          insight_type: 'best_session',
          headline: `Your highest-performing trades are clustering in the ${bestSessionEntry[0]} session`,
          detail: `${bestSessionEntry[1].wins} of ${bestSessionEntry[1].total} resolved trades in that session finished positively.`,
          metric_value: round2((bestSessionEntry[1].wins / Math.max(bestSessionEntry[1].total, 1)) * 100),
          as_of_date: new Date().toISOString().slice(0, 10),
        }
      : null,
    bestGradeEntry
      ? {
          insight_type: 'best_grade',
          headline: `You currently perform best on ${bestGradeEntry[0]} setups`,
          detail: `${bestGradeEntry[1].wins} of ${bestGradeEntry[1].total} ${bestGradeEntry[0]} trades have resolved positively in the journal.`,
          metric_value: round2((bestGradeEntry[1].wins / Math.max(bestGradeEntry[1].total, 1)) * 100),
          as_of_date: new Date().toISOString().slice(0, 10),
        }
      : null,
    bestAssetEntry
      ? {
          insight_type: 'best_market',
          headline: `${bestAssetEntry[0]} is your strongest market bucket right now`,
          detail: `This market group has contributed the highest realized RR across the current journal sample.`,
          metric_value: round2(bestAssetEntry[1].rr),
          as_of_date: new Date().toISOString().slice(0, 10),
        }
      : null,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (insights.length > 0) {
    const { error } = await supabase.from(JOURNAL_INSIGHTS_TABLE).upsert(insights.map((insight) => ({ user_id: userId, ...insight })), {
      onConflict: 'user_id,insight_type,as_of_date',
    });
    if (error) {
      fail('upsertJournalInsights', error);
    }
  }

  const rows = await selectMany<JournalInsightRow>(
    'listJournalInsights',
    supabase.from(JOURNAL_INSIGHTS_TABLE).select('*').eq('user_id', userId).order('as_of_date', { ascending: false }).limit(6),
  );
  return rows.map(mapInsight);
}

export async function runFindTradeScan(userId: string, mode: ScanMode = 'on_demand'): Promise<FindTradeStatusPayload> {
  await archiveExpiredScansForUser(userId);
  await archiveCurrentActiveScan(userId, 'archived');

  const { candidates, enabledCategories, errors } = await collectScanCandidates();
  const bestCandidate = candidates.find((candidate) => candidate.weightedScore >= 80 && candidate.qualityGrade !== 'C') ?? null;
  const developingCandidates = candidates
    .filter((candidate) => candidate.signal.key !== bestCandidate?.signal.key)
    .slice(0, 3);

  const scan = await insertOne<FindTradeScanRow>('createFindTradeScan', FIND_TRADE_SCANS_TABLE, {
    user_id: userId,
    status: 'active',
    scan_mode: mode,
    market_scope: enabledCategories,
    scan_summary: {
      enabledCategories,
      forceTestSignals: FORCE_TEST_SIGNALS,
      totalCandidates: candidates.length,
      bestScore: bestCandidate?.weightedScore ?? null,
      scanErrors: errors,
    },
    generated_at: new Date().toISOString(),
    expires_at: startOfTomorrowIso(),
  });

  const opportunityValues: Record<string, unknown>[] = [];
  const snapshotValues: Record<string, unknown>[] = [];

  if (bestCandidate) {
    opportunityValues.push({
      scan_id: scan.id,
      user_id: userId,
      section: 'best_active',
      state: 'available',
      source: bestCandidate.signal.source,
      category: bestCandidate.category,
      symbol: bestCandidate.signal.symbol,
      symbol_label: bestCandidate.signal.symbolLabel,
      asset_class: bestCandidate.signal.assetClass,
      timeframe: bestCandidate.signal.timeframe,
      session_type: bestCandidate.signal.session,
      direction: bestCandidate.signal.direction,
      confidence_score: bestCandidate.signal.confidence,
      weighted_score: bestCandidate.weightedScore,
      quality_grade: bestCandidate.qualityGrade,
      rr_ratio: bestCandidate.signal.rrRatio,
      entry_price: bestCandidate.signal.entry,
      stop_loss: bestCandidate.signal.stopLoss,
      take_profit: bestCandidate.signal.takeProfit,
      current_price: bestCandidate.signal.currentPrice,
      setup_label: bestCandidate.signal.setupLabel,
      reasoning: bestCandidate.signal.reason,
      execution_note: bestCandidate.signal.executionNote,
      confluences: bestCandidate.signal.confluences,
      quality_breakdown: {
        ...bestCandidate.signal.quality,
        weightedScore: bestCandidate.weightedScore,
      },
      snapshot: bestCandidate.signal.snapshot,
      ranking: 1,
    });
  }

  developingCandidates.forEach((candidate, index) => {
    opportunityValues.push({
      scan_id: scan.id,
      user_id: userId,
      section: 'developing',
      state: 'available',
      source: candidate.signal.source,
      category: candidate.category,
      symbol: candidate.signal.symbol,
      symbol_label: candidate.signal.symbolLabel,
      asset_class: candidate.signal.assetClass,
      timeframe: candidate.signal.timeframe,
      session_type: candidate.signal.session,
      direction: candidate.signal.direction,
      confidence_score: candidate.signal.confidence,
      weighted_score: candidate.weightedScore,
      quality_grade: candidate.qualityGrade,
      rr_ratio: candidate.signal.rrRatio,
      entry_price: candidate.signal.entry,
      stop_loss: candidate.signal.stopLoss,
      take_profit: candidate.signal.takeProfit,
      current_price: candidate.signal.currentPrice,
      setup_label: candidate.signal.setupLabel,
      reasoning: candidate.signal.reason,
      execution_note: candidate.signal.executionNote,
      developing_note: getDevelopingNote(candidate),
      confluences: candidate.signal.confluences,
      quality_breakdown: {
        ...candidate.signal.quality,
        weightedScore: candidate.weightedScore,
      },
      snapshot: candidate.signal.snapshot,
      ranking: index + 1,
    });
  });

  if (!bestCandidate) {
    opportunityValues.push({
      scan_id: scan.id,
      user_id: userId,
      section: 'no_trade',
      state: 'available',
      empty_state_message: buildNoTradeMessage(errors),
      reasoning: errors.length > 0 ? errors.join(' | ') : 'No setup met the premium execution threshold.',
      ranking: 1,
    });
  }

  const insertedOpportunities = opportunityValues.length > 0
    ? await insertMany<TradeOpportunityRow>('createTradeOpportunities', TRADE_OPPORTUNITIES_TABLE, opportunityValues)
    : [];

  insertedOpportunities.forEach((row) => {
    if (row.section !== 'no_trade') {
      snapshotValues.push({
        user_id: userId,
        opportunity_id: row.id,
        snapshot_payload: row.snapshot,
      });
    }
  });

  if (snapshotValues.length > 0) {
    await insertMany('createTradeSnapshots', TRADE_SNAPSHOTS_TABLE, snapshotValues);
  }

  await insertOne('createUserScanHistory', USER_SCAN_HISTORY_TABLE, {
    user_id: userId,
    scan_id: scan.id,
    summary: {
      generatedAt: scan.generated_at,
      bestSymbol: bestCandidate?.signal.symbol ?? null,
      totalCandidates: candidates.length,
      totalDeveloping: developingCandidates.length,
      noTrade: !bestCandidate,
    },
  });

  return getFindTradeStatus(userId, scan.id);
}

async function getLatestUpdateMap(trackingIds: string[]) {
  if (trackingIds.length === 0) {
    return new Map<string, TradeUpdateRow>();
  }

  const updates = await selectMany<TradeUpdateRow>(
    'listLatestTradeUpdates',
    supabase.from(TRADE_UPDATES_TABLE).select('*').in('tracking_id', trackingIds).order('created_at', { ascending: false }).limit(30),
  );

  const latestByTracking = new Map<string, TradeUpdateRow>();
  for (const update of updates) {
    if (!latestByTracking.has(update.tracking_id)) {
      latestByTracking.set(update.tracking_id, update);
    }
  }

  return latestByTracking;
}

export async function getFindTradeStatus(userId: string, scanId?: string): Promise<FindTradeStatusPayload> {
  await archiveExpiredScansForUser(userId);

  const scan = await selectMaybeOne<FindTradeScanRow>(
    'getFindTradeScan',
    supabase
      .from(FIND_TRADE_SCANS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .eq(scanId ? 'id' : 'status', scanId ?? 'active')
      .order('generated_at', { ascending: false })
      .maybeSingle(),
  );

  const opportunities = scan
    ? await selectMany<TradeOpportunityRow>(
        'listFindTradeOpportunities',
        supabase.from(TRADE_OPPORTUNITIES_TABLE).select('*').eq('scan_id', scan.id).order('section').order('ranking'),
      )
    : [];

  const activeTrackingRows = await selectMany<TradeTrackingRow>(
    'listActiveTradeTracking',
    supabase
      .from(TRADE_TRACKING_TABLE)
      .select('*')
      .eq('user_id', userId)
      .in('status', ['monitoring', 'running_profit'])
      .order('entered_at', { ascending: false }),
  );
  const latestUpdates = await getLatestUpdateMap(activeTrackingRows.map((row) => row.id));

  const journals = await selectMany<TradeJournalRow>(
    'listTradeJournalPreview',
    supabase.from(TRADE_JOURNAL_TABLE).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(6),
  );

  const watchlist = await selectMany<UserWatchlistRow>(
    'listUserWatchlists',
    supabase.from(USER_WATCHLISTS_TABLE).select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(8),
  );

  const activeCategories = Object.entries(await loadEnabledCategories())
    .filter(([, enabled]) => enabled)
    .map(([category]) => category as FindTradeCategory);

  const insights = await buildInsights(userId);
  const notificationsCount = await selectMany<Pick<{ id: string }, 'id'>>(
    'listRecentTradeNotifications',
    supabase
      .from(TRADE_NOTIFICATIONS_TABLE)
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  );

  return {
    scan: scan
      ? {
          id: scan.id,
          status: scan.status,
          mode: scan.scan_mode,
          generatedAt: scan.generated_at,
          expiresAt: scan.expires_at,
          summary: scan.scan_summary ?? {},
          enabledCategories: activeCategories,
        }
      : null,
    bestOpportunity: opportunities.find((row) => row.section === 'best_active') ? mapOpportunity(opportunities.find((row) => row.section === 'best_active')!) : null,
    developingOpportunities: opportunities.filter((row) => row.section === 'developing').map(mapOpportunity),
    noTradeState: opportunities.find((row) => row.section === 'no_trade') ? mapOpportunity(opportunities.find((row) => row.section === 'no_trade')!) : null,
    activeTracking: activeTrackingRows.map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      source: row.source,
      symbol: row.symbol,
      symbolLabel: row.symbol_label,
      assetClass: row.asset_class,
      timeframe: row.timeframe,
      sessionType: row.session_type,
      direction: row.direction,
      status: row.status,
      confidenceScore: row.confidence_score,
      qualityGrade: row.quality_grade,
      rrRatio: toNumber(row.rr_ratio) ?? 0,
      entryPrice: toNumber(row.entry_price) ?? 0,
      stopLoss: toNumber(row.stop_loss) ?? 0,
      takeProfit: toNumber(row.take_profit) ?? 0,
      currentPrice: toNumber(row.current_price),
      progressPercent: toNumber(row.progress_percent) ?? 0,
      enteredAt: row.entered_at,
      lastCheckedAt: row.last_checked_at,
      nextCheckAt: row.next_check_at,
      resolvedAt: row.resolved_at,
      latestUpdate: latestUpdates.get(row.id)
        ? {
            id: latestUpdates.get(row.id)!.id,
            title: latestUpdates.get(row.id)!.title,
            message: latestUpdates.get(row.id)!.message,
            createdAt: latestUpdates.get(row.id)!.created_at,
          }
        : null,
    })),
    journalPreview: journals.map(mapJournal),
    insights,
    watchlist: watchlist.map((row) => ({
      id: row.id,
      source: row.source,
      symbol: row.symbol,
      symbolLabel: row.symbol_label,
      assetClass: row.asset_class,
      timeframe: row.timeframe,
      direction: row.direction,
      setupLabel: row.setup_label,
      addedAt: row.added_at,
    })),
    notificationSummary: {
      activeTrades: activeTrackingRows.length,
      recentNotifications: notificationsCount.length,
      pollingIntervalMinutes: Math.round(MONITOR_POLL_INTERVAL_MS / 60_000),
    },
    onboarding: {
      setupGuideUrl: '/goldx/setup',
    },
  };
}

export async function resetFindTrade(userId: string) {
  await archiveExpiredScansForUser(userId);
  await archiveCurrentActiveScan(userId, 'reset');
  return getFindTradeStatus(userId);
}

async function createTrackingAndJournal(userId: string, opportunity: TradeOpportunityRow) {
  const tracking = await insertOne<TradeTrackingRow>('createTradeTracking', TRADE_TRACKING_TABLE, {
    user_id: userId,
    scan_id: opportunity.scan_id,
    opportunity_id: opportunity.id,
    source: opportunity.source,
    symbol: opportunity.symbol,
    symbol_label: opportunity.symbol_label,
    asset_class: opportunity.asset_class,
    timeframe: opportunity.timeframe,
    session_type: opportunity.session_type,
    direction: opportunity.direction,
    status: 'monitoring',
    confidence_score: opportunity.confidence_score,
    quality_grade: opportunity.quality_grade,
    rr_ratio: opportunity.rr_ratio,
    entry_price: opportunity.entry_price,
    stop_loss: opportunity.stop_loss,
    take_profit: opportunity.take_profit,
    current_price: opportunity.current_price,
    progress_percent: 0,
    notification_frequency_minutes: DEFAULT_NOTIFICATION_FREQUENCY_MINUTES,
    next_check_at: new Date(Date.now() + MONITOR_POLL_INTERVAL_MS).toISOString(),
  });

  const update = await insertOne<TradeUpdateRow>('createInitialTradeUpdate', TRADE_UPDATES_TABLE, {
    user_id: userId,
    tracking_id: tracking.id,
    update_type: 'status',
    status: 'monitoring',
    title: 'Monitoring started',
    message: 'The trade is now being monitored. Updates will only be generated for this entered position.',
    progress_percent: 0,
    current_price: opportunity.current_price,
    payload: { source: 'entered' },
  });

  await insertOne('createTradeJournal', TRADE_JOURNAL_TABLE, {
    user_id: userId,
    scan_id: opportunity.scan_id,
    opportunity_id: opportunity.id,
    tracking_id: tracking.id,
    source: opportunity.source,
    symbol: opportunity.symbol,
    symbol_label: opportunity.symbol_label,
    asset_class: opportunity.asset_class,
    timeframe: opportunity.timeframe,
    session_type: opportunity.session_type,
    direction: opportunity.direction,
    confidence_score: opportunity.confidence_score,
    quality_grade: opportunity.quality_grade,
    rr_ratio: opportunity.rr_ratio,
    entry_price: opportunity.entry_price,
    stop_loss: opportunity.stop_loss,
    take_profit: opportunity.take_profit,
    setup_reasoning: opportunity.reasoning ?? 'No reasoning saved.',
    ai_reflection: 'Monitoring has started. Let the structure confirm or invalidate without forcing action.',
    performance_summary: {
      initialWeightedScore: opportunity.weighted_score,
      initialState: opportunity.state,
    },
  });

  await insertOne('createTrackingSnapshot', TRADE_SNAPSHOTS_TABLE, {
    user_id: userId,
    opportunity_id: opportunity.id,
    tracking_id: tracking.id,
    snapshot_payload: opportunity.snapshot ?? {},
  });

  return { tracking, update };
}

export async function updateOpportunityDecision(
  userId: string,
  payload: { opportunityId: string; action: 'entered' | 'watchlist' | 'ignore' | 'not_yet' },
) {
  const opportunity = await selectMaybeOne<TradeOpportunityRow>(
    'getTradeOpportunityForDecision',
    supabase.from(TRADE_OPPORTUNITIES_TABLE).select('*').eq('id', payload.opportunityId).eq('user_id', userId).maybeSingle(),
  );

  if (!opportunity) {
    throw new Error('Trade opportunity not found');
  }

  if (payload.action === 'entered') {
    await updateRows('markOpportunityEntered', TRADE_OPPORTUNITIES_TABLE, { state: 'entered' }, (query) => query.eq('id', opportunity.id).eq('user_id', userId));
    await createTrackingAndJournal(userId, { ...opportunity, state: 'entered' });
  }

  if (payload.action === 'watchlist') {
    await updateRows('markOpportunityWatchlist', TRADE_OPPORTUNITIES_TABLE, { state: 'watchlist' }, (query) => query.eq('id', opportunity.id).eq('user_id', userId));
    const { error } = await supabase.from(USER_WATCHLISTS_TABLE).upsert({
      user_id: userId,
      opportunity_id: opportunity.id,
      source: opportunity.source,
      symbol: opportunity.symbol,
      symbol_label: opportunity.symbol_label,
      asset_class: opportunity.asset_class,
      timeframe: opportunity.timeframe,
      direction: opportunity.direction,
      setup_label: opportunity.setup_label,
    }, {
      onConflict: 'user_id,source,symbol,timeframe',
    });
    if (error) {
      fail('saveFindTradeWatchlist', error);
    }
  }

  if (payload.action === 'ignore') {
    await updateRows('markOpportunityIgnored', TRADE_OPPORTUNITIES_TABLE, { state: 'ignored' }, (query) => query.eq('id', opportunity.id).eq('user_id', userId));
  }

  if (payload.action === 'not_yet') {
    await updateRows('markOpportunityAvailable', TRADE_OPPORTUNITIES_TABLE, { state: 'available' }, (query) => query.eq('id', opportunity.id).eq('user_id', userId));
  }

  return getFindTradeStatus(userId, opportunity.scan_id);
}

export async function getFindTradeHistory(userId: string) {
  await archiveExpiredScansForUser(userId);

  const scans = await selectMany<FindTradeScanRow>(
    'listFindTradeHistory',
    supabase
      .from(FIND_TRADE_SCANS_TABLE)
      .select('*')
      .eq('user_id', userId)
      .order('generated_at', { ascending: false })
      .limit(20),
  );

  const watchlists = await selectMany<UserWatchlistRow>(
    'listFindTradeHistoryWatchlist',
    supabase.from(USER_WATCHLISTS_TABLE).select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(20),
  );

  return {
    scans: scans.map((scan) => ({
      id: scan.id,
      status: scan.status,
      mode: scan.scan_mode,
      generatedAt: scan.generated_at,
      expiresAt: scan.expires_at,
      summary: scan.scan_summary ?? {},
      enabledCategories: scan.market_scope ?? [],
    })),
    watchlist: watchlists.map((row) => ({
      id: row.id,
      source: row.source,
      symbol: row.symbol,
      symbolLabel: row.symbol_label,
      assetClass: row.asset_class,
      timeframe: row.timeframe,
      direction: row.direction,
      setupLabel: row.setup_label,
      addedAt: row.added_at,
    })),
  };
}

export async function getFindTradeJournal(userId: string) {
  const journal = await selectMany<TradeJournalRow>(
    'listFindTradeJournal',
    supabase.from(TRADE_JOURNAL_TABLE).select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(50),
  );
  return { journal: journal.map(mapJournal) };
}

export async function getFindTradeJournalInsights(userId: string) {
  const insights = await buildInsights(userId);
  return { insights };
}

export async function addFindTradeJournalNote(
  userId: string,
  payload: { journalId?: string; trackingId?: string; note: string },
) {
  const note = payload.note.trim();
  if (!note) {
    throw new Error('A note is required');
  }

  const journal = payload.journalId
    ? await selectMaybeOne<TradeJournalRow>(
        'getFindTradeJournalById',
        supabase.from(TRADE_JOURNAL_TABLE).select('*').eq('id', payload.journalId).eq('user_id', userId).maybeSingle(),
      )
    : await selectMaybeOne<TradeJournalRow>(
        'getFindTradeJournalByTrackingId',
        supabase.from(TRADE_JOURNAL_TABLE).select('*').eq('tracking_id', payload.trackingId ?? '').eq('user_id', userId).maybeSingle(),
      );

  if (!journal) {
    throw new Error('Journal entry not found');
  }

  const nextNotes = journal.emotional_notes ? `${journal.emotional_notes}\n\n${note}` : note;
  await updateRows('appendFindTradeJournalNote', TRADE_JOURNAL_TABLE, { emotional_notes: nextNotes }, (query) => query.eq('id', journal.id).eq('user_id', userId));
  await insertOne('createTradeJournalNoteUpdate', TRADE_UPDATES_TABLE, {
    user_id: userId,
    tracking_id: journal.tracking_id,
    update_type: 'journal',
    title: 'Journal note added',
    message: note,
    payload: { source: 'journal-note' },
  });

  return getFindTradeJournal(userId);
}

async function fetchCurrentPrice(source: FindTradeSource, symbol: string, timeframe: string) {
  if (source === 'tradingview') {
    const marketData = await fetchMarketDataForLiveChart(symbol, timeframe);
    return marketData.currentPrice;
  }

  const granularityMap: Record<string, number> = {
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1H': 3600,
    '4H': 14400,
    '1D': 86400,
  };
  const candles = await getDerivHistoryCandles(symbol, granularityMap[timeframe] ?? 900, 120);
  const latest = candles[candles.length - 1];
  return latest?.close ?? latest?.open ?? null;
}

function deriveTrackingStatus(row: TradeTrackingRow, currentPrice: number) {
  const entry = toNumber(row.entry_price) ?? 0;
  const stopLoss = toNumber(row.stop_loss) ?? 0;
  const takeProfit = toNumber(row.take_profit) ?? 0;
  const rewardDistance = row.direction === 'buy' ? takeProfit - entry : entry - takeProfit;
  const progressDistance = row.direction === 'buy' ? currentPrice - entry : entry - currentPrice;
  const progressPercent = rewardDistance > 0 ? round2(Math.max(0, (progressDistance / rewardDistance) * 100)) : 0;

  if (row.direction === 'buy') {
    if (currentPrice <= stopLoss) {
      return { status: 'sl_hit' as const, progressPercent: 0 };
    }
    if (currentPrice >= takeProfit) {
      return { status: 'tp_hit' as const, progressPercent: 100 };
    }
  } else {
    if (currentPrice >= stopLoss) {
      return { status: 'sl_hit' as const, progressPercent: 0 };
    }
    if (currentPrice <= takeProfit) {
      return { status: 'tp_hit' as const, progressPercent: 100 };
    }
  }

  if (progressPercent >= 35) {
    return { status: 'running_profit' as const, progressPercent };
  }

  return { status: 'monitoring' as const, progressPercent };
}

async function syncJournalResolution(row: TradeTrackingRow, status: TrackingStatus, currentPrice: number, progressPercent: number, message: string) {
  const resolved = status === 'tp_hit' || status === 'sl_hit' || status === 'expired' || status === 'manual_close';
  const outcome: JournalOutcome = status === 'tp_hit'
    ? 'win'
    : status === 'sl_hit'
      ? 'loss'
      : status === 'expired'
        ? 'expired'
        : status === 'manual_close'
          ? 'manual_close'
          : 'open';
  const enteredAt = new Date(row.entered_at).getTime();
  const durationMinutes = Math.max(1, Math.round((Date.now() - enteredAt) / 60000));

  await updateRows('updateFindTradeJournalResolution', TRADE_JOURNAL_TABLE, {
    outcome,
    duration_minutes: resolved ? durationMinutes : null,
    ai_reflection: message,
    closed_at: resolved ? new Date().toISOString() : null,
    performance_summary: {
      latestPrice: currentPrice,
      progressPercent,
      latestStatus: status,
    },
  }, (query) => query.eq('tracking_id', row.id).eq('user_id', row.user_id));
}

async function logNotification(userId: string, trackingId: string, updateId: string, title: string, body: string, tag: string, sentCount: number) {
  const values = [
    {
      user_id: userId,
      tracking_id: trackingId,
      update_id: updateId,
      channel: 'browser',
      title,
      body,
      tag,
      delivered: sentCount > 0,
      delivered_at: sentCount > 0 ? new Date().toISOString() : null,
    },
    {
      user_id: userId,
      tracking_id: trackingId,
      update_id: updateId,
      channel: 'push',
      title,
      body,
      tag,
      delivered: sentCount > 0,
      delivered_at: sentCount > 0 ? new Date().toISOString() : null,
    },
  ];
  await insertMany('createTradeNotificationLog', TRADE_NOTIFICATIONS_TABLE, values);
}

async function monitorSingleTrade(row: TradeTrackingRow) {
  const currentPrice = await fetchCurrentPrice(row.source, row.symbol, row.timeframe);
  if (currentPrice == null) {
    return;
  }

  const { status, progressPercent } = deriveTrackingStatus(row, currentPrice);
  const messageDetails = getMonitoringMessage(status, row.direction, progressPercent);
  const update = await insertOne<TradeUpdateRow>('createFindTradeMonitorUpdate', TRADE_UPDATES_TABLE, {
    user_id: row.user_id,
    tracking_id: row.id,
    update_type: messageDetails.updateType,
    status,
    title: messageDetails.title,
    message: messageDetails.message,
    progress_percent: progressPercent,
    current_price: currentPrice,
    payload: {
      status,
      previousStatus: row.status,
    },
  });

  const nextCheckAt = new Date(Date.now() + MONITOR_POLL_INTERVAL_MS).toISOString();
  await updateRows('updateFindTradeTracking', TRADE_TRACKING_TABLE, {
    current_price: currentPrice,
    progress_percent: progressPercent,
    status,
    last_checked_at: new Date().toISOString(),
    next_check_at: status === 'tp_hit' || status === 'sl_hit' ? null : nextCheckAt,
    resolved_at: status === 'tp_hit' || status === 'sl_hit' ? new Date().toISOString() : null,
  }, (query) => query.eq('id', row.id).eq('user_id', row.user_id));

  await syncJournalResolution(row, status, currentPrice, progressPercent, messageDetails.message);

  const title = `${row.symbol_label} ${status === 'running_profit' ? 'update' : status.replace('_', ' ')}`;
  const body = messageDetails.message;
  const sentCount = await sendPushToUser(row.user_id, {
    title,
    body,
    tag: `find-trade:${row.id}`,
    url: '/dashboard/signals',
  });
  await logNotification(row.user_id, row.id, update.id, title, body, `find-trade:${row.id}`, sentCount);
}

async function monitorTick() {
  if (monitorInFlight) {
    return;
  }

  monitorInFlight = true;
  try {
    const rows = await selectMany<TradeTrackingRow>(
      'listFindTradeMonitorRows',
      supabase
        .from(TRADE_TRACKING_TABLE)
        .select('*')
        .in('status', ['monitoring', 'running_profit'])
        .or(`next_check_at.is.null,next_check_at.lte.${new Date().toISOString()}`)
        .order('entered_at', { ascending: true })
        .limit(40),
    );

    const settled = await Promise.allSettled(rows.map((row) => monitorSingleTrade(row)));
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`[find-trade-monitor] failed for ${rows[index]?.symbol ?? 'unknown'}:`, result.reason);
      }
    });
  } catch (error) {
    console.error('[find-trade-monitor] tick failed:', error);
  } finally {
    monitorInFlight = false;
  }
}

export function startFindTradeMonitor() {
  if (monitorTimer) {
    return;
  }

  console.log(`[find-trade-monitor] started (poll every ${MONITOR_POLL_INTERVAL_MS}ms)`);
  void monitorTick();
  monitorTimer = setInterval(() => {
    void monitorTick();
  }, MONITOR_POLL_INTERVAL_MS);
}