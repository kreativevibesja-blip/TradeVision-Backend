import { supabase } from '../lib/supabase';
import { getCachedCandles } from '../lib/db/saveCandles';
import { getRuntimeCandles } from '../lib/deriv/activeCandles';
import { ensureDerivSubscription, getDerivHistoryCandles } from '../lib/deriv/ws';
import { DERIV_SCANNER_SYMBOL_IDS, SESSION_SCANNER_SYMBOL_IDS, VOLATILITY_SCANNER_SYMBOL_IDS } from '../lib/deriv/symbols';
import { scheduleScannerPanelRefreshForAllUsers, scheduleScannerPanelRefreshForUser } from '../lib/scanner/panelStream';
import { analyzeMarket, analyzePotentialTrades, detectTrend, findSwingHighsLows, type Candle, type PotentialTradeSetup, type TrendDirection } from './scannerEngine';
import { sendPushToUser } from './pushService';

// ── Types ──

export type SessionType = 'london' | 'newyork' | 'volatility';
type ForexSessionType = Extract<SessionType, 'london' | 'newyork'>;
export type ScanResultStatus = 'active' | 'triggered' | 'closed' | 'invalidated' | 'expired';
export type AlertType = 'info' | 'trade' | 'warning';
export type ScanCloseReason = 'tp' | 'sl' | null;

export interface ScannerSession {
  id: string;
  userId: string;
  sessionType: SessionType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScanResult {
  id: string;
  userId: string;
  symbol: string;
  timeframe: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  confidenceScore: number;
  strategy: string | null;
  confirmations: string[];
  sessionType: SessionType;
  status: ScanResultStatus;
  closeReason: ScanCloseReason;
  triggeredAt: string | null;
  closedAt: string | null;
  rank: number | null;
  createdAt: string;
  currentPrice?: number | null;
}

export interface ScannerAlert {
  id: string;
  userId: string;
  scanResultId: string | null;
  message: string;
  type: AlertType;
  read: boolean;
  createdAt: string;
}

export interface PotentialTrade {
  symbol: string;
  sessionType: SessionType;
  direction: 'buy' | 'sell';
  currentPrice: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  activationProbability: number;
  strategy: string;
  narrative: string;
  fulfilledConditions: string[];
  requiredTriggers: string[];
  contextLabels: string[];
}

interface LifecycleProcessingOptions {
  skipApproachAlerts?: boolean;
}

interface LivePriceWindow {
  currentPrice: number;
  lowPrice: number;
  highPrice: number;
}

type OpenScanResult = Pick<ScanResult, 'id' | 'userId' | 'symbol' | 'status' | 'confidenceScore' | 'createdAt'>;

// ── Table names ──

const SCANNER_SESSION_TABLE = 'ScannerSession';
const SCAN_RESULT_TABLE = 'ScanResult';
const SCANNER_ALERT_TABLE = 'ScannerAlert';

// ── Session windows (EST / America/New_York) ──

interface SessionWindow {
  startHour: number;
  endHour: number;
}

const SESSION_WINDOWS: Record<ForexSessionType, SessionWindow> = {
  london: { startHour: 2, endHour: 11 },
  newyork: { startHour: 8, endHour: 17 },
};

// ── Scanner symbols and timeframe ──

const SCANNER_SYMBOLS = DERIV_SCANNER_SYMBOL_IDS;
const SCANNER_SYMBOLS_BY_SESSION: Record<SessionType, readonly string[]> = {
  london: SESSION_SCANNER_SYMBOL_IDS,
  newyork: SESSION_SCANNER_SYMBOL_IDS,
  volatility: VOLATILITY_SCANNER_SYMBOL_IDS,
};

const SCANNER_TIMEFRAME = 'M15';
const LIVE_RESULT_CACHE_SYNC_MS = 20_000;
const HIGH_CONFIDENCE_POTENTIAL_THRESHOLD = 90;

const TIMEFRAME_TO_GRANULARITY: Record<'M15' | 'H1', 900 | 3600> = {
  M15: 900,
  H1: 3600,
};

type ScanResultScope = 'all' | 'current' | 'history';

const liveResultCache = new Map<string, Map<string, ScanResult>>();
let liveResultCacheSyncedAt = 0;
let liveResultCacheSyncPromise: Promise<void> | null = null;

function compareOpenResultPriority(left: OpenScanResult, right: OpenScanResult): number {
  const leftTriggered = left.status === 'triggered';
  const rightTriggered = right.status === 'triggered';

  if (leftTriggered !== rightTriggered) {
    return leftTriggered ? -1 : 1;
  }

  if (left.confidenceScore !== right.confidenceScore) {
    return right.confidenceScore - left.confidenceScore;
  }

  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

function dedupeOpenResultsBySymbol(results: ScanResult[]): ScanResult[] {
  const openBySymbol = new Map<string, ScanResult>();
  const nonOpenResults: ScanResult[] = [];

  for (const result of results) {
    if (result.status !== 'active' && result.status !== 'triggered') {
      nonOpenResults.push(result);
      continue;
    }

    const existing = openBySymbol.get(result.symbol);
    if (!existing || compareOpenResultPriority(existing, result) > 0) {
      openBySymbol.set(result.symbol, result);
    }
  }

  return [...Array.from(openBySymbol.values()), ...nonOpenResults].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

function getExistingOpenResultFromCache(userId: string, symbol: string): ScanResult | null {
  const symbolBucket = liveResultCache.get(symbol);
  if (!symbolBucket) {
    return null;
  }

  const candidates = Array.from(symbolBucket.values()).filter(
    (result) => result.userId === userId && (result.status === 'active' || result.status === 'triggered'),
  );

  return candidates.sort(compareOpenResultPriority)[0] ?? null;
}

async function getOpenResultForUserSymbol(userId: string, symbol: string): Promise<ScanResult | null> {
  const cached = getExistingOpenResultFromCache(userId, symbol);
  if (cached) {
    return cached;
  }

  const { data, error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('*')
    .eq('userId', userId)
    .eq('symbol', symbol)
    .in('status', ['active', 'triggered'])
    .order('createdAt', { ascending: false })
    .limit(5);

  if (error) {
    throw new Error(error.message);
  }

  const candidates = (data ?? []) as ScanResult[];
  return candidates.sort(compareOpenResultPriority)[0] ?? null;
}

// ── Helpers ──

function getCurrentEstHour(): number {
  const now = new Date();
  const estString = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const hour = parseInt(estString.split(',')[1]?.trim().split(':')[0] ?? '0', 10);
  return hour;
}

function getCurrentEstWeekday(): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Sun';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return weekdayMap[weekday] ?? 0;
}

export function isSessionActive(sessionType: SessionType): boolean {
  if (sessionType === 'volatility') {
    return true;
  }

  const weekday = getCurrentEstWeekday();
  if (weekday === 0 || weekday === 6) {
    return false;
  }

  const hour = getCurrentEstHour();
  const window = SESSION_WINDOWS[sessionType];
  return hour >= window.startHour && hour < window.endHour;
}

export function getCurrentSessionTypes(): SessionType[] {
  const active: SessionType[] = [];
  if (isSessionActive('london')) active.push('london');
  if (isSessionActive('newyork')) active.push('newyork');
  active.push('volatility');
  return active;
}

function getRelevantScannerModes(enabledTypes: Set<SessionType>): SessionType[] {
  const relevantModes: SessionType[] = [];

  if (enabledTypes.has('volatility')) {
    relevantModes.push('volatility');
  }

  if (enabledTypes.has('newyork') && isSessionActive('newyork')) {
    relevantModes.push('newyork');
  } else if (enabledTypes.has('london') && isSessionActive('london')) {
    relevantModes.push('london');
  }

  return relevantModes;
}

// ── Deduplication ──

const recentScanKeys = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60_000; // 5 minutes
const recentPotentialAlertKeys = new Map<string, number>();
const POTENTIAL_ALERT_THRESHOLD = 78;
const POTENTIAL_ALERT_WINDOW_MS = 20 * 60_000;

function isDuplicate(userId: string, symbol: string, direction: string): boolean {
  const key = `${userId}:${symbol}:${direction}`;
  const last = recentScanKeys.get(key);
  if (last && Date.now() - last < DEDUP_WINDOW_MS) {
    return true;
  }
  recentScanKeys.set(key, Date.now());
  return false;
}

function cleanupDedupCache() {
  const cutoff = Date.now() - DEDUP_WINDOW_MS;
  for (const [key, timestamp] of recentScanKeys) {
    if (timestamp < cutoff) recentScanKeys.delete(key);
  }

  const potentialCutoff = Date.now() - POTENTIAL_ALERT_WINDOW_MS;
  for (const [key, timestamp] of recentPotentialAlertKeys) {
    if (timestamp < potentialCutoff) recentPotentialAlertKeys.delete(key);
  }
}

function isDuplicatePotentialAlert(userId: string, potential: Pick<PotentialTrade, 'symbol' | 'direction' | 'sessionType'>): boolean {
  const key = `${userId}:${potential.sessionType}:${potential.symbol}:${potential.direction}`;
  const last = recentPotentialAlertKeys.get(key);
  if (last && Date.now() - last < POTENTIAL_ALERT_WINDOW_MS) {
    return true;
  }

  recentPotentialAlertKeys.set(key, Date.now());
  return false;
}

async function loadScannerCandles(symbol: string, timeframe: 'M15' | 'H1', limit: number, minimum = 50): Promise<Candle[]> {
  const granularity = TIMEFRAME_TO_GRANULARITY[timeframe];

  try {
    await ensureDerivSubscription(symbol);
  } catch (error) {
    console.error(`[Scanner] Failed to ensure Deriv subscription for ${symbol}:`, error);
  }

  const runtimeCandles = getRuntimeCandles(symbol, granularity, limit, true);
  if (runtimeCandles.length >= minimum) {
    return runtimeCandles.map((candle) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      time: candle.time * 1000,
    }));
  }

  const cachedCandles = await getCachedCandles(symbol, timeframe, limit);
  if (cachedCandles.length >= minimum) {
    return cachedCandles.map((candle) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      time: new Date(candle.time).getTime(),
    }));
  }

  const historyCandles = await getDerivHistoryCandles(symbol, granularity, limit);
  if (historyCandles.length >= minimum) {
    return historyCandles.map((candle) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      time: candle.time * 1000,
    }));
  }

  return [];
}

function isTrendAlignedForDirection(direction: 'buy' | 'sell', trend: TrendDirection): boolean {
  return (direction === 'buy' && trend === 'bullish') || (direction === 'sell' && trend === 'bearish');
}

function isTrendOpposedToDirection(direction: 'buy' | 'sell', trend: TrendDirection): boolean {
  return (direction === 'buy' && trend === 'bearish') || (direction === 'sell' && trend === 'bullish');
}

function sortDirectionalTargets(direction: 'buy' | 'sell', prices: number[]) {
  return [...prices].sort((left, right) => direction === 'buy' ? left - right : right - left);
}

function collectHigherTimeframeTargets(direction: 'buy' | 'sell', candles: Candle[], entry: number): number[] {
  const trimmed = candles.slice(-Math.min(220, candles.length));
  const swings = findSwingHighsLows(trimmed);
  const swingTargets = swings
    .filter((swing) => direction === 'buy' ? swing.type === 'high' && swing.price > entry : swing.type === 'low' && swing.price < entry)
    .map((swing) => swing.price);
  const extremeTarget = direction === 'buy'
    ? Math.max(...trimmed.map((candle) => candle.high))
    : Math.min(...trimmed.map((candle) => candle.low));
  const rawTargets = [...swingTargets, extremeTarget]
    .filter((price) => Number.isFinite(price) && (direction === 'buy' ? price > entry : price < entry));

  return sortDirectionalTargets(direction, rawTargets).filter((price, index, array) => array.indexOf(price) === index);
}

function selectDirectionalTarget(
  direction: 'buy' | 'sell',
  targets: number[],
  entry: number,
  minimumDistance: number,
  floorTarget: number,
): number {
  const candidate = targets.find((price) => direction === 'buy'
    ? price - entry >= minimumDistance
    : entry - price >= minimumDistance);

  if (!candidate) {
    return floorTarget;
  }

  if (direction === 'buy') {
    return Math.max(candidate, floorTarget);
  }

  return Math.min(candidate, floorTarget);
}

interface H1ScanContext {
  h1Candles: Candle[];
}

function refinePotentialTradeWithH1(
  potential: PotentialTradeSetup,
  h1Context: H1ScanContext,
): PotentialTradeSetup | null {
  const h1Trend = detectTrend(h1Context.h1Candles);
  const alignedH1 = isTrendAlignedForDirection(potential.direction, h1Trend);
  const opposedH1 = isTrendOpposedToDirection(potential.direction, h1Trend);
  const nextPotential: PotentialTradeSetup = {
    ...potential,
    fulfilledConditions: [...potential.fulfilledConditions],
    requiredTriggers: [...potential.requiredTriggers],
    contextLabels: [...potential.contextLabels],
  };

  if (alignedH1) {
    nextPotential.fulfilledConditions.push(`H1 ${potential.direction === 'buy' ? 'bullish' : 'bearish'} bias aligns`);
    nextPotential.contextLabels.push('H1 aligned');
  } else if (opposedH1) {
    nextPotential.requiredTriggers.unshift(`H1 bias flips to ${potential.direction === 'buy' ? 'bullish' : 'bearish'} before upgrading this setup`);
    nextPotential.activationProbability = Math.min(88, nextPotential.activationProbability - 10);
  } else {
    nextPotential.contextLabels.push('H1 neutral');
    nextPotential.activationProbability = Math.min(89, nextPotential.activationProbability - 4);
  }

  if (!alignedH1 && opposedH1) {
    return null;
  }

  const risk = Math.abs(nextPotential.entry - nextPotential.stopLoss);
  const fallbackTakeProfit = nextPotential.direction === 'buy'
    ? nextPotential.entry + risk * 2
    : nextPotential.entry - risk * 2;
  const fallbackTakeProfit2 = nextPotential.direction === 'buy'
    ? nextPotential.entry + risk * 3
    : nextPotential.entry - risk * 3;
  const higherTimeframeTargets = collectHigherTimeframeTargets(nextPotential.direction, h1Context.h1Candles, nextPotential.entry);

  nextPotential.takeProfit = selectDirectionalTarget(
    nextPotential.direction,
    higherTimeframeTargets,
    nextPotential.entry,
    risk * 1.4,
    fallbackTakeProfit,
  );
  nextPotential.takeProfit2 = selectDirectionalTarget(
    nextPotential.direction,
    higherTimeframeTargets,
    nextPotential.entry,
    Math.max(risk * 2.8, Math.abs(nextPotential.entry - nextPotential.takeProfit) + risk * 0.8),
    fallbackTakeProfit2,
  );

  if (nextPotential.direction === 'buy' && nextPotential.takeProfit2 <= nextPotential.takeProfit) {
    nextPotential.takeProfit2 = Math.max(fallbackTakeProfit2, nextPotential.takeProfit + risk);
  }

  if (nextPotential.direction === 'sell' && nextPotential.takeProfit2 >= nextPotential.takeProfit) {
    nextPotential.takeProfit2 = Math.min(fallbackTakeProfit2, nextPotential.takeProfit - risk);
  }

  nextPotential.fulfilledConditions.push('H1 target map applied');
  nextPotential.contextLabels.push('TP refined with H1 structure');

  return nextPotential;
}

function promotePotentialToScanCycleResult(potential: PotentialTradeSetup): ScanCycleResult {
  return {
    symbol: potential.symbol,
    direction: potential.direction,
    entry: potential.entry,
    stopLoss: potential.stopLoss,
    takeProfit: potential.takeProfit,
    takeProfit2: potential.takeProfit2,
    confidenceScore: Math.max(HIGH_CONFIDENCE_POTENTIAL_THRESHOLD, Math.round(potential.activationProbability)),
    strategy: potential.strategy.replace(/ Watchlist$/i, ''),
    confirmations: [
      ...potential.fulfilledConditions.slice(0, 4),
      'H1 bias confirmation',
    ].filter((label, index, array) => array.indexOf(label) === index),
    score: 9,
  };
}

async function loadLatestScannerPrice(symbol: string): Promise<number | null> {
  const candles = await loadScannerCandles(symbol, 'M15', 2, 1);
  return candles[candles.length - 1]?.close ?? null;
}

async function attachLivePricesToResults(results: ScanResult[]): Promise<ScanResult[]> {
  const openResults = results.filter((result) => result.status === 'active' || result.status === 'triggered');
  if (openResults.length === 0) {
    return results.map((result) => ({ ...result, currentPrice: result.currentPrice ?? null }));
  }

  const uniqueSymbols = Array.from(new Set(openResults.map((result) => result.symbol)));
  const latestPricePairs = await Promise.all(
    uniqueSymbols.map(async (symbol) => [symbol, await loadLatestScannerPrice(symbol)] as const),
  );
  const latestPriceBySymbol = new Map<string, number | null>(latestPricePairs);

  return results.map((result) => ({
    ...result,
    currentPrice: (result.status === 'active' || result.status === 'triggered')
      ? (latestPriceBySymbol.get(result.symbol) ?? null)
      : (result.currentPrice ?? null),
  }));
}

async function hasRecentApproachAlert(scanResultId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const { count, error } = await supabase
    .from(SCANNER_ALERT_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('scanResultId', scanResultId)
    .eq('type', 'warning')
    .like('message', '%approaching%')
    .gte('createdAt', cutoff);

  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

function getStartOfNewYorkDay(): string {
  const now = new Date();
  const zonedNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = now.getTime() - zonedNow.getTime();
  zonedNow.setHours(0, 0, 0, 0);
  return new Date(zonedNow.getTime() + offsetMs).toISOString();
}

// ── Database operations ──

export async function getActiveSessionsForUser(userId: string): Promise<ScannerSession[]> {
  const { data, error } = await supabase
    .from(SCANNER_SESSION_TABLE)
    .select('*')
    .eq('userId', userId);

  if (error) throw new Error(error.message);
  return (data ?? []) as ScannerSession[];
}

export async function toggleScannerSession(
  userId: string,
  sessionType: SessionType,
  isActive: boolean
): Promise<ScannerSession> {
  const { data: existing } = await supabase
    .from(SCANNER_SESSION_TABLE)
    .select('*')
    .eq('userId', userId)
    .eq('sessionType', sessionType)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from(SCANNER_SESSION_TABLE)
      .update({ isActive, updatedAt: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data as ScannerSession;
  }

  const { data, error } = await supabase
    .from(SCANNER_SESSION_TABLE)
    .insert({ userId, sessionType, isActive })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ScannerSession;
}

export async function getScanResults(
  userId: string,
  sessionType?: SessionType,
  limit = 20,
  scope: ScanResultScope = 'all',
): Promise<ScanResult[]> {
  let query = supabase
    .from(SCAN_RESULT_TABLE)
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .limit(limit);

  if (scope !== 'all') {
    const dayStart = getStartOfNewYorkDay();
    query = scope === 'current'
      ? query.gte('createdAt', dayStart)
      : query.lt('createdAt', dayStart);
  }

  if (sessionType) {
    query = query.eq('sessionType', sessionType);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const results = (data ?? []) as ScanResult[];
  const scopedResults = scope === 'current' ? dedupeOpenResultsBySymbol(results).slice(0, limit) : results;
  return attachLivePricesToResults(scopedResults);
}

export async function getAlertsForUser(
  userId: string,
  unreadOnly = false,
  limit = 50,
): Promise<ScannerAlert[]> {
  let query = supabase
    .from(SCANNER_ALERT_TABLE)
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .limit(limit);

  if (unreadOnly) {
    query = query.eq('read', false);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ScannerAlert[];
}

export async function markAlertsRead(userId: string, alertIds: string[]): Promise<void> {
  if (alertIds.length === 0) return;

  const { error } = await supabase
    .from(SCANNER_ALERT_TABLE)
    .update({ read: true })
    .eq('userId', userId)
    .in('id', alertIds);

  if (error) throw new Error(error.message);
}

export async function getSessionSummary(
  userId: string,
  sessionType?: SessionType,
): Promise<{ total: number; triggered: number; closed: number; invalidated: number; active: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let query = supabase
    .from(SCAN_RESULT_TABLE)
    .select('status')
    .eq('userId', userId)
    .gte('createdAt', today.toISOString());

  if (sessionType) {
    query = query.eq('sessionType', sessionType);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);

  const results = data ?? [];
  return {
    total: results.length,
    triggered: results.filter((r: any) => r.status === 'triggered').length,
    closed: results.filter((r: any) => r.status === 'closed').length,
    invalidated: results.filter((r: any) => r.status === 'invalidated').length,
    active: results.filter((r: any) => r.status === 'active').length,
  };
}

async function updateScanResult(
  id: string,
  updates: Partial<Pick<ScanResult, 'status' | 'closeReason' | 'triggeredAt' | 'closedAt'>>,
): Promise<void> {
  const { data: existingResult, error: existingError } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('userId')
    .eq('id', id)
    .single();

  if (existingError) throw new Error(existingError.message);

  const { error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .update(updates)
    .eq('id', id);

  if (error) throw new Error(error.message);

  mutateLiveResultCache(id, updates);
  if (existingResult?.userId) {
    scheduleScannerPanelRefreshForUser(String(existingResult.userId));
  }
}

async function insertScanResult(result: Omit<ScanResult, 'id' | 'createdAt'>): Promise<ScanResult | null> {
  const existingOpenResult = await getOpenResultForUserSymbol(result.userId, result.symbol);
  if (existingOpenResult) {
    return null;
  }

  const { data, error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .insert(result)
    .select()
    .single();

  if (error) throw new Error(error.message);
  registerLiveResultInCache(data as ScanResult);
  return data as ScanResult;
}

function registerLiveResultInCache(result: ScanResult) {
  if (result.status !== 'active' && result.status !== 'triggered') {
    return;
  }

  const symbolBucket = liveResultCache.get(result.symbol) ?? new Map<string, ScanResult>();
  for (const [existingId, existing] of symbolBucket) {
    if (existing.userId !== result.userId) {
      continue;
    }

    if (compareOpenResultPriority(existing, result) > 0) {
      symbolBucket.delete(existingId);
      continue;
    }

    return;
  }

  symbolBucket.set(result.id, result);
  liveResultCache.set(result.symbol, symbolBucket);
}

function removeLiveResultFromCache(result: ScanResult) {
  const symbolBucket = liveResultCache.get(result.symbol);
  if (!symbolBucket) {
    return;
  }

  symbolBucket.delete(result.id);
  if (symbolBucket.size === 0) {
    liveResultCache.delete(result.symbol);
  }
}

function mutateLiveResultCache(
  resultId: string,
  updates: Partial<Pick<ScanResult, 'status' | 'closeReason' | 'triggeredAt' | 'closedAt'>>,
) {
  for (const [, symbolBucket] of liveResultCache) {
    const existing = symbolBucket.get(resultId);
    if (!existing) {
      continue;
    }

    const nextResult: ScanResult = { ...existing, ...updates };
    if (nextResult.status === 'active' || nextResult.status === 'triggered') {
      symbolBucket.set(resultId, nextResult);
    } else {
      symbolBucket.delete(resultId);
      if (symbolBucket.size === 0) {
        liveResultCache.delete(existing.symbol);
      }
    }
    return;
  }
}

async function syncLiveResultCache(force = false): Promise<void> {
  const cacheIsFresh = !force && Date.now() - liveResultCacheSyncedAt < LIVE_RESULT_CACHE_SYNC_MS;
  if (cacheIsFresh) {
    return;
  }

  if (liveResultCacheSyncPromise) {
    return liveResultCacheSyncPromise;
  }

  liveResultCacheSyncPromise = (async () => {
    const { data, error } = await supabase
      .from(SCAN_RESULT_TABLE)
      .select('*')
      .in('status', ['active', 'triggered'])
      .order('createdAt', { ascending: false })
      .limit(500);

    if (error) {
      throw new Error(error.message);
    }

    liveResultCache.clear();
    for (const result of (data ?? []) as ScanResult[]) {
      registerLiveResultInCache(result);
    }

    liveResultCacheSyncedAt = Date.now();
  })().finally(() => {
    liveResultCacheSyncPromise = null;
  });

  return liveResultCacheSyncPromise;
}

async function insertAlert(alert: { userId: string; scanResultId?: string; message: string; type: AlertType }): Promise<ScannerAlert> {
  const { data, error } = await supabase
    .from(SCANNER_ALERT_TABLE)
    .insert({
      userId: alert.userId,
      scanResultId: alert.scanResultId ?? null,
      message: alert.message,
      type: alert.type,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  scheduleScannerPanelRefreshForUser(alert.userId);
  return data as ScannerAlert;
}

async function processResultLifecycle(
  result: ScanResult,
  priceWindow: number | LivePriceWindow,
  options: LifecycleProcessingOptions = {},
): Promise<ScannerAlert[]> {
  const alerts: ScannerAlert[] = [];
  const normalizedWindow = typeof priceWindow === 'number'
    ? { currentPrice: priceWindow, lowPrice: priceWindow, highPrice: priceWindow }
    : priceWindow;
  const { currentPrice, lowPrice, highPrice } = normalizedWindow;
  const decimals = result.entry >= 100 ? 2 : 5;

  if (result.status === 'active') {
    const entryDistance = Math.abs(currentPrice - result.entry);
    const slDistance = Math.abs(result.entry - result.stopLoss) || 1;
    const proximityRatio = entryDistance / slDistance;

    const isInvalidated = result.direction === 'buy'
      ? lowPrice <= result.stopLoss
      : highPrice >= result.stopLoss;

    if (isInvalidated) {
      await updateScanResult(result.id, { status: 'invalidated' });

      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: `${result.symbol} setup invalidated — price broke through stop loss level before entry`,
        type: 'warning',
      });
      alerts.push(alert);

      return alerts;
    }

    const entryTriggered = result.direction === 'buy'
      ? lowPrice <= result.entry
      : highPrice >= result.entry;

    if (entryTriggered) {
      await updateScanResult(result.id, {
        status: 'triggered',
        triggeredAt: new Date().toISOString(),
      });

      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: `${result.symbol} ${result.direction.toUpperCase()} trade triggered at ${currentPrice.toFixed(decimals)}`,
        type: 'trade',
      });
      alerts.push(alert);

      sendPushToUser(result.userId, {
        title: 'Trade Triggered',
        body: `${result.symbol} ${result.direction.toUpperCase()} is now live at ${currentPrice.toFixed(decimals)}`,
        tag: `trigger-${result.id}`,
        url: '/dashboard/scanner',
      }).catch((err) => console.error('[Push] Failed to send trigger notification:', err));

      return alerts;
    }

    if (!options.skipApproachAlerts && proximityRatio <= 0.3 && !(await hasRecentApproachAlert(result.id))) {
      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: `${result.symbol} approaching ${result.direction === 'buy' ? 'buy' : 'sell'} zone — price is near entry at ${currentPrice.toFixed(decimals)}`,
        type: 'warning',
      });
      alerts.push(alert);
    }

    return alerts;
  }

  if (result.status === 'triggered') {
    const hitTakeProfit = result.direction === 'buy'
      ? highPrice >= result.takeProfit
      : lowPrice <= result.takeProfit;

    const hitStopLoss = result.direction === 'buy'
      ? lowPrice <= result.stopLoss
      : highPrice >= result.stopLoss;

    if (hitTakeProfit || hitStopLoss) {
      const closeReason: ScanCloseReason = hitTakeProfit ? 'tp' : 'sl';
      await updateScanResult(result.id, {
        status: 'closed',
        closeReason,
        closedAt: new Date().toISOString(),
      });

      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: hitTakeProfit
          ? `${result.symbol} trade closed in profit — take profit hit at ${currentPrice.toFixed(decimals)}`
          : `${result.symbol} trade closed at stop loss — SL hit at ${currentPrice.toFixed(decimals)}`,
        type: hitTakeProfit ? 'trade' : 'warning',
      });
      alerts.push(alert);

      sendPushToUser(result.userId, {
        title: hitTakeProfit ? 'Take Profit Hit' : 'Stop Loss Hit',
        body: hitTakeProfit
          ? `${result.symbol} closed in profit.`
          : `${result.symbol} closed at stop loss.`,
        tag: `closed-${result.id}`,
        url: '/dashboard/scanner',
      }).catch((err) => console.error('[Push] Failed to send closure notification:', err));
    }
  }

  return alerts;
}

// ── Session trade limits ──

const MAX_TRADES_PER_DAY = 10;
const MAX_TRADES_PER_DAY_BY_SESSION: Record<SessionType, number> = {
  london: 3,
  newyork: 3,
  volatility: 10,
};

async function getTodayTradeCount(userId: string, sessionType?: SessionType): Promise<number> {
  const dayStart = getStartOfNewYorkDay();

  let query = supabase
    .from(SCAN_RESULT_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('userId', userId)
    .gte('createdAt', dayStart);

  if (sessionType) {
    query = query.eq('sessionType', sessionType);
  }

  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ── Core scanner logic ──

interface ScanCycleResult {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  confidenceScore: number;
  strategy: string;
  confirmations: string[];
  score: number;
}

async function buildPotentialForSymbol(symbol: string): Promise<PotentialTradeSetup[]> {
  try {
    const candles = await loadScannerCandles(symbol, 'M15', 600);
    if (candles.length < 50) {
      return [];
    }

    const potentials = analyzePotentialTrades(symbol, candles);
    if (!potentials.some((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD)) {
      return potentials;
    }

    const h1Candles = await loadScannerCandles(symbol, 'H1', 320, 80);

    if (h1Candles.length < 80) {
      return potentials.map((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD
        ? {
            ...potential,
            activationProbability: Math.min(89, potential.activationProbability - 5),
            requiredTriggers: ['Need H1 confirmation before promoting this setup', ...potential.requiredTriggers],
            contextLabels: [...potential.contextLabels, 'Waiting for H1 confirmation'],
          }
        : potential);
    }

    return potentials
      .map((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD
        ? refinePotentialTradeWithH1(potential, { h1Candles })
        : potential)
      .filter((potential): potential is PotentialTradeSetup => potential !== null);
  } catch (err) {
    console.error(`[Scanner] Failed to build potential trade for ${symbol}:`, err);
    return [];
  }
}

async function scanSymbol(symbol: string): Promise<ScanCycleResult | null> {
  try {
    const candles = await loadScannerCandles(symbol, 'M15', 600);
    if (candles.length < 50) {
      return null;
    }

    const potentials = analyzePotentialTrades(symbol, candles);
    const promotablePotential = potentials.find((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD) ?? null;

    if (promotablePotential) {
      const h1Candles = await loadScannerCandles(symbol, 'H1', 320, 80);
      if (h1Candles.length >= 80) {
        const refinedPotential = refinePotentialTradeWithH1(promotablePotential, { h1Candles });
        if (refinedPotential && refinedPotential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD) {
          return promotePotentialToScanCycleResult(refinedPotential);
        }
      }
    }

    const setup = analyzeMarket(symbol, candles);
    if (!setup) return null;

    return {
      symbol: setup.symbol,
      direction: setup.direction,
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
      takeProfit2: setup.takeProfit2,
      confidenceScore: setup.confidenceScore,
      strategy: setup.strategy,
      confirmations: setup.confirmationLabels,
      score: setup.score,
    };
  } catch (err) {
    console.error(`[Scanner] Failed to scan ${symbol}:`, err);
    return null;
  }
}

export async function runSessionScanner(userId: string): Promise<{ results: ScanResult[]; alerts: ScannerAlert[] }> {
  // Get user's enabled sessions
  const userSessions = await getActiveSessionsForUser(userId);
  const enabledTypes = new Set(
    userSessions.filter((s) => s.isActive).map((s) => s.sessionType)
  );

  const relevantSessions = getRelevantScannerModes(enabledTypes);
  if (relevantSessions.length === 0) {
    return { results: [], alerts: [] };
  }

  let dailyCount = await getTodayTradeCount(userId);

  if (dailyCount >= MAX_TRADES_PER_DAY) {
    console.log(`[Scanner] Daily limit reached for user ${userId} (${dailyCount}/${MAX_TRADES_PER_DAY})`);
    return { results: [], alerts: [] };
  }

  const savedResults: ScanResult[] = [];
  const savedAlerts: ScannerAlert[] = [];
  const claimedSymbols = new Set<string>();

  for (const sessionType of relevantSessions) {
    const maxTradesForSession = MAX_TRADES_PER_DAY_BY_SESSION[sessionType];
    const sessionCount = await getTodayTradeCount(userId, sessionType);
    if (sessionCount >= maxTradesForSession) {
      console.log(`[Scanner] Session limit reached for user ${userId} ${sessionType} (${sessionCount}/${maxTradesForSession})`);
      continue;
    }

    const remainingDaily = MAX_TRADES_PER_DAY - dailyCount;
    const remainingSession = maxTradesForSession - sessionCount;
    const slotsAvailable = Math.min(remainingDaily, remainingSession);
    if (slotsAvailable <= 0) {
      break;
    }

    const rawResults = await Promise.all(SCANNER_SYMBOLS_BY_SESSION[sessionType].map((symbol) => scanSymbol(symbol)));
    const validResults = rawResults
      .filter((r): r is ScanCycleResult => r !== null)
      .sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore)
      .slice(0, slotsAvailable);

    for (let i = 0; i < validResults.length; i++) {
      const result = validResults[i];

      if (claimedSymbols.has(result.symbol)) {
        continue;
      }

      if (isDuplicate(userId, result.symbol, result.direction)) {
        continue;
      }

      const existingOpenResult = await getOpenResultForUserSymbol(userId, result.symbol);
      if (existingOpenResult) {
        claimedSymbols.add(result.symbol);
        continue;
      }

      const scanResult = await insertScanResult({
        userId,
        symbol: result.symbol,
        timeframe: SCANNER_TIMEFRAME,
        direction: result.direction,
        entry: result.entry,
        stopLoss: result.stopLoss,
        takeProfit: result.takeProfit,
        takeProfit2: result.takeProfit2,
        confidenceScore: result.confidenceScore,
        strategy: result.strategy,
        confirmations: result.confirmations,
        sessionType,
        status: 'active',
        closeReason: null,
        triggeredAt: null,
        closedAt: null,
        rank: i + 1,
      });

      claimedSymbols.add(result.symbol);

      if (!scanResult) {
        continue;
      }

      if (savedResults.some((item) => item.id === scanResult.id)) {
        continue;
      }

      savedResults.push(scanResult);
      dailyCount += 1;

      const directionLabel = result.direction.toUpperCase();
      const modeLabel = sessionType === 'volatility' ? 'Volatility 24/7' : `${sessionType === 'london' ? 'London' : 'New York'} Session`;
      const alert = await insertAlert({
        userId,
        scanResultId: scanResult.id,
        message: `High-quality ${modeLabel} setup detected on ${result.symbol} (${directionLabel}) — Score ${result.score}/9, ${result.strategy}, TP1 1:2 and TP2 1:3 mapped.`,
        type: 'trade',
      });

      savedAlerts.push(alert);

      sendPushToUser(userId, {
        title: 'TradeVision Alert 🚨',
        body: `${result.symbol} ${directionLabel} setup detected (${sessionType === 'volatility' ? 'Volatility 24/7' : 'Session scanner'})`,
        tag: `scan-${result.symbol}-${result.direction}`,
        url: '/dashboard/scanner',
      }).catch((err) => console.error('[Push] Failed to send:', err));

      if (dailyCount >= MAX_TRADES_PER_DAY) {
        break;
      }
    }

    if (dailyCount >= MAX_TRADES_PER_DAY) {
      console.log(`[Scanner] Daily limit reached for user ${userId} during ${sessionType} scanning`);
      break;
    }
  }

  // Cleanup old dedup entries
  cleanupDedupCache();

  return { results: savedResults, alerts: savedAlerts };
}

// ── Pre-entry zone proximity alert ──

export async function checkZoneProximityAlerts(userId: string): Promise<ScannerAlert[]> {
  const { data: activeResults } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('*')
    .eq('userId', userId)
    .in('status', ['active', 'triggered'])
    .order('createdAt', { ascending: false })
    .limit(20);

  if (!activeResults?.length) return [];

  const alerts: ScannerAlert[] = [];

  for (const result of activeResults as ScanResult[]) {
    try {
      const currentPrice = await loadLatestScannerPrice(result.symbol);
      if (currentPrice === null) {
        continue;
      }
      const lifecycleAlerts = await processResultLifecycle(result, currentPrice);
      alerts.push(...lifecycleAlerts);
    } catch {
      // Skip symbols that fail to fetch
    }
  }

  return alerts;
}

export async function processLivePriceUpdate(symbol: string, priceWindow: number | LivePriceWindow): Promise<number> {
  if (!liveResultCacheSyncedAt) {
    await syncLiveResultCache(true);
  } else if (Date.now() - liveResultCacheSyncedAt >= LIVE_RESULT_CACHE_SYNC_MS) {
    void syncLiveResultCache().catch((error) => {
      console.error('[scanner-live-lifecycle] cache sync failed:', error);
    });
  }

  const results = Array.from(liveResultCache.get(symbol)?.values() ?? []);
  if (results.length === 0) {
    return 0;
  }

  let updates = 0;

  for (const result of results) {
    const alerts = await processResultLifecycle(result, priceWindow, { skipApproachAlerts: true });
    if (alerts.length > 0) {
      updates += 1;
    }
  }

  scheduleScannerPanelRefreshForAllUsers();

  return updates;
}

export async function getPotentialTrades(userId: string, limit = 12): Promise<PotentialTrade[]> {
  const userSessions = await getActiveSessionsForUser(userId);
  const enabledTypes = new Set(
    userSessions.filter((session) => session.isActive).map((session) => session.sessionType)
  );

  const relevantSessions = getRelevantScannerModes(enabledTypes);
  if (relevantSessions.length === 0) {
    return [];
  }

  const { data: openResults, error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('symbol')
    .eq('userId', userId)
    .in('status', ['active', 'triggered']);

  if (error) {
    throw new Error(error.message);
  }

  const blockedSymbols = new Set((openResults ?? []).map((row: any) => String(row.symbol)));
  const potentials: PotentialTrade[] = [];

  for (const sessionType of relevantSessions) {
    const rawPotentials = await Promise.all(
      SCANNER_SYMBOLS_BY_SESSION[sessionType]
        .filter((symbol) => !blockedSymbols.has(symbol))
        .map((symbol) => buildPotentialForSymbol(symbol))
    );

    const sessionPotentials = rawPotentials
      .flat()
      .sort((a, b) => b.activationProbability - a.activationProbability)
      .slice(0, limit)
      .map((item) => ({
        ...item,
        sessionType,
      }));

    potentials.push(...sessionPotentials);
  }

  return potentials
    .sort((a, b) => b.activationProbability - a.activationProbability)
    .slice(0, limit);
}

export async function getRealtimeScannerPanels(userId: string, resultLimit = 20, potentialLimit = 10) {
  const [results, potentials] = await Promise.all([
    getScanResults(userId, undefined, resultLimit, 'current'),
    getPotentialTrades(userId, potentialLimit),
  ]);

  return {
    results,
    potentials,
    generatedAt: new Date().toISOString(),
  };
}

export async function checkPotentialTradeAlerts(userId: string): Promise<ScannerAlert[]> {
  const potentials = await getPotentialTrades(userId, 6);
  const alerts: ScannerAlert[] = [];

  for (const potential of potentials) {
    if (potential.activationProbability < POTENTIAL_ALERT_THRESHOLD) {
      continue;
    }

    if (isDuplicatePotentialAlert(userId, potential)) {
      continue;
    }

    const directionLabel = potential.direction.toUpperCase();
    const modeLabel = potential.sessionType === 'volatility' ? 'Volatility 24/7' : `${potential.sessionType === 'london' ? 'London' : 'New York'} Session`;
    const alert = await insertAlert({
      userId,
      message: `Potential ${modeLabel} setup building on ${potential.symbol} (${directionLabel}) — ${Math.round(potential.activationProbability)}% likely if confirmation triggers print.`,
      type: 'info',
    });

    alerts.push(alert);
  }

  cleanupDedupCache();
  return alerts;
}

// ── Session summary at end ──

export async function expireSessionResults(userId: string, sessionType: SessionType): Promise<void> {
  await supabase
    .from(SCAN_RESULT_TABLE)
    .update({ status: 'expired' })
    .eq('userId', userId)
    .eq('sessionType', sessionType)
    .eq('status', 'active');
}

export { SCANNER_SYMBOLS, SCANNER_TIMEFRAME };
