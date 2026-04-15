import { supabase } from '../lib/supabase';
import { getCachedCandles } from '../lib/db/saveCandles';
import { getRuntimeCandles } from '../lib/deriv/activeCandles';
import { ensureDerivSubscription, getDerivHistoryCandles } from '../lib/deriv/ws';
import { DERIV_SCANNER_SYMBOL_IDS, SESSION_SCANNER_SYMBOL_IDS, VOLATILITY_SCANNER_SYMBOL_IDS } from '../lib/deriv/symbols';
import { scheduleScannerPanelRefreshForAllUsers, scheduleScannerPanelRefreshForUser } from '../lib/scanner/panelStream';
import { getCooldownMinutes, isSymbolOnCooldown, allowContinuation, passesPostFirstTradeFilter, type TradeResult } from '../lib/scanner/cooldownEngine';
import { analyzeMarket, analyzePotentialTrades, detectTrend, findSwingHighsLows, type Candle, type MarketRegime, type PotentialTradeSetup, type TradeConfirmations, type TrendDirection } from './scannerEngine';
import { analyzeLiveChartCandles } from './liveChartAnalysis';
import type { MarketCandle } from './marketData';
import { sendPushToUser } from './pushService';
import { processSignal } from './autoTraderEngine';
import { generateAndUploadSnapshot } from './tradeSnapshot';

// ── Types ──

export type SessionType = 'london' | 'newyork' | 'volatility';
type ForexSessionType = Extract<SessionType, 'london' | 'newyork'>;
type VolatilitySessionBucket = 'asian' | 'london' | 'newyork';
export type ScanResultStatus = 'active' | 'triggered' | 'closed' | 'invalidated' | 'expired';
export type AlertType = 'info' | 'trade' | 'warning';
export type ScanCloseReason = 'tp' | 'sl' | null;
export type TradeReplayOutcome = 'open' | 'tp' | 'sl';
export type CompressedReplayCandle = [number, number, number, number, number];

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
  slReason?: string | null;
  takeProfit: number;
  takeProfit2: number | null;
  emaMomentum?: boolean | null;
  emaStack?: 'bullish' | 'bearish' | 'neutral' | null;
  emaEntryValid?: boolean | null;
  confidenceScore: number;
  marketRegime: MarketRegime;
  strategy: string | null;
  confirmations: TradeConfirmations | string[];
  sessionType: SessionType;
  status: ScanResultStatus;
  closeReason: ScanCloseReason;
  triggeredAt: string | null;
  closedAt: string | null;
  rank: number | null;
  createdAt: string;
  currentPrice?: number | null;
  snapshotUrl?: string | null;
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

export interface TradeReplay {
  id: string;
  scanResultId: string;
  userId: string;
  symbol: string;
  timeframe: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  triggeredAt: string;
  closedAt: string | null;
  outcome: TradeReplayOutcome;
  preEntryCandles: CompressedReplayCandle[];
  replayCandles: CompressedReplayCandle[];
  createdAt: string;
  updatedAt: string;
}

export interface PotentialTrade {
  symbol: string;
  sessionType: SessionType;
  direction: 'buy' | 'sell';
  currentPrice: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number | null;
  activationProbability: number;
  marketRegime: MarketRegime;
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
type RecentScannerActivity = Pick<ScanResult, 'symbol' | 'direction' | 'sessionType' | 'status' | 'createdAt' | 'closedAt' | 'closeReason'>;

// ── Table names ──

const SCANNER_SESSION_TABLE = 'ScannerSession';
const SCAN_RESULT_TABLE = 'ScanResult';
const SCANNER_ALERT_TABLE = 'ScannerAlert';
const TRADE_REPLAY_TABLE = 'TradeReplay';

// ── Session windows (EST / America/New_York) ──

interface SessionWindow {
  startHour: number;
  endHour: number;
}

interface DailySessionWindow extends SessionWindow {
  weekdaysOnly?: boolean;
}

const SESSION_WINDOWS: Record<ForexSessionType, SessionWindow> = {
  london: { startHour: 2, endHour: 11 },
  newyork: { startHour: 8, endHour: 17 },
};

const VOLATILITY_SESSION_WINDOW: DailySessionWindow = {
  startHour: SESSION_WINDOWS.london.startHour,
  endHour: SESSION_WINDOWS.newyork.endHour,
};
const VOLATILITY_BUCKET_LIMITS: Record<VolatilitySessionBucket, number> = {
  asian: 1,
  london: 2,
  newyork: 2,
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
const AI_REVIEW_NEAR_LIVE_THRESHOLD = 86;
const AI_REVIEW_CACHE_TTL_MS = 10 * 60_000;
const PREFER_HISTORY_BEFORE_CACHE_SYMBOLS = new Set(['XAUUSD']);
const HISTORY_RATE_LIMIT_BACKOFF_MS = 60_000;

const TIMEFRAME_TO_GRANULARITY: Record<'M15' | 'H1', 900 | 3600> = {
  M15: 900,
  H1: 3600,
};

type ScanResultScope = 'all' | 'current' | 'history';

const liveResultCache = new Map<string, Map<string, ScanResult>>();
let liveResultCacheSyncedAt = 0;
let liveResultCacheSyncPromise: Promise<void> | null = null;
const historyRateLimitBackoffUntil = new Map<string, number>();

// ── Potential trade cache ──
// Potential trades are expensive to recompute every tick.  We cache
// them per-symbol and only refresh when the structural fingerprint
// changes (direction, strategy, or confirmation count) or a TTL expires.

const POTENTIAL_CACHE_TTL_MS = 5 * 60_000; // 5 minutes hard TTL

interface CachedPotential {
  potentials: PotentialTradeSetup[];
  fingerprint: string;
  cachedAt: number;
}

interface CachedAiPotentialReview {
  fingerprint: string;
  reviewedPotential: PotentialTradeSetup;
  cachedAt: number;
}

const potentialCache = new Map<string, CachedPotential>();
const aiPotentialReviewCache = new Map<string, CachedAiPotentialReview>();

function usesFixedIndexPoints(symbol: string): boolean {
  return ['NAS100', 'US30'].includes(symbol.trim().toUpperCase());
}

function usesFixedJpyPipTargets(symbol: string): boolean {
  const normalized = symbol.trim().toUpperCase();
  return /^[A-Z]{6}$/.test(normalized) && normalized.endsWith('JPY');
}

function applyFixedSymbolRisk(potential: PotentialTradeSetup): PotentialTradeSetup {
  if (usesFixedIndexPoints(potential.symbol)) {
    const stopLoss = potential.direction === 'buy' ? potential.entry - 100 : potential.entry + 100;
    const takeProfit = potential.direction === 'buy' ? potential.entry + 200 : potential.entry - 200;

    return {
      ...potential,
      stopLoss,
      slReason: 'Fixed index points',
      takeProfit,
      takeProfit2: takeProfit,
    };
  }

  if (usesFixedJpyPipTargets(potential.symbol)) {
    const stopLoss = potential.direction === 'buy' ? potential.entry - 0.30 : potential.entry + 0.30;
    const takeProfit = potential.direction === 'buy' ? potential.entry + 0.60 : potential.entry - 0.60;

    return {
      ...potential,
      stopLoss,
      slReason: 'Fixed JPY pip targets',
      takeProfit,
      takeProfit2: takeProfit,
    };
  }

  return potential;
}

function buildPotentialFingerprint(potentials: PotentialTradeSetup[]): string {
  if (potentials.length === 0) return 'empty';
  return potentials
    .map((p) => `${p.direction}:${p.strategy}:${p.confidenceScore}:${Math.round(p.activationProbability)}`)
    .join('|');
}

function getCachedPotentials(symbol: string, freshPotentials: PotentialTradeSetup[]): PotentialTradeSetup[] | null {
  const cached = potentialCache.get(symbol);
  if (!cached) return null;

  const now = Date.now();
  // Hard TTL expired — force refresh
  if (now - cached.cachedAt > POTENTIAL_CACHE_TTL_MS) return null;

  // Check if the structural fingerprint changed (direction flip, strategy change, score change)
  const freshFingerprint = buildPotentialFingerprint(freshPotentials);
  if (cached.fingerprint !== freshFingerprint) return null;

  // Structure is the same — return cached version (locked entry/SL/TP)
  // but update the currentPrice to reflect the live price.
  const latestPrice = freshPotentials.length > 0 ? freshPotentials[0].currentPrice : null;
  if (latestPrice !== null) {
    return cached.potentials.map((p) => ({ ...p, currentPrice: latestPrice }));
  }

  return cached.potentials;
}

function setCachedPotentials(symbol: string, potentials: PotentialTradeSetup[]): void {
  potentialCache.set(symbol, {
    potentials,
    fingerprint: buildPotentialFingerprint(potentials),
    cachedAt: Date.now(),
  });
}

function buildAiReviewFingerprint(potential: PotentialTradeSetup): string {
  return [
    potential.direction,
    potential.strategy,
    potential.marketRegime,
    potential.emaStack,
    potential.entry.toFixed(5),
    potential.stopLoss.toFixed(5),
    potential.takeProfit.toFixed(5),
    Math.round(potential.activationProbability),
    potential.confidenceScore,
  ].join(':');
}

function mapScannerCandlesToMarketCandles(candles: Candle[]): MarketCandle[] {
  return candles.map((candle) => ({
    timestamp: new Date(candle.time * 1000).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function averageScannerRange(candles: Candle[], sample = 12): number {
  const recent = candles.slice(-Math.min(sample, candles.length));
  if (recent.length === 0) {
    return 0;
  }

  const totalRange = recent.reduce((sum, candle) => sum + Math.max(0, candle.high - candle.low), 0);
  return totalRange / recent.length;
}

function computeRewardMultiple(direction: 'buy' | 'sell', entry: number, stopLoss: number, takeProfit: number | null): number | null {
  if (takeProfit == null) {
    return null;
  }

  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) {
    return null;
  }

  const reward = direction === 'buy' ? takeProfit - entry : entry - takeProfit;
  if (reward <= 0) {
    return null;
  }

  return reward / risk;
}

function projectTargetFromRewardMultiple(direction: 'buy' | 'sell', entry: number, stopLoss: number, rewardMultiple: number | null): number | null {
  if (rewardMultiple == null || rewardMultiple <= 0) {
    return null;
  }

  const risk = Math.abs(entry - stopLoss);
  return direction === 'buy'
    ? entry + risk * rewardMultiple
    : entry - risk * rewardMultiple;
}

function clonePotentialTrade(potential: PotentialTradeSetup): PotentialTradeSetup {
  return {
    ...potential,
    fulfilledConditions: [...potential.fulfilledConditions],
    requiredTriggers: [...potential.requiredTriggers],
    contextLabels: [...potential.contextLabels],
  };
}

async function reviewPotentialTradeWithAi(
  symbol: string,
  candles: Candle[],
  potential: PotentialTradeSetup,
): Promise<PotentialTradeSetup> {
  const fingerprint = buildAiReviewFingerprint(potential);
  const cached = aiPotentialReviewCache.get(symbol);

  if (cached && cached.fingerprint === fingerprint && Date.now() - cached.cachedAt <= AI_REVIEW_CACHE_TTL_MS) {
    return {
      ...cached.reviewedPotential,
      currentPrice: potential.currentPrice,
    };
  }

  const reviewed = clonePotentialTrade(potential);

  try {
    const vision = await analyzeLiveChartCandles(symbol, SCANNER_TIMEFRAME, mapScannerCandlesToMarketCandles(candles));
    const expectedBias = potential.direction === 'buy' ? 'buy' : 'sell';
    const aiBias = vision.entryPlan.bias !== 'none'
      ? vision.entryPlan.bias
      : vision.trend === 'bullish'
        ? 'buy'
        : vision.trend === 'bearish'
          ? 'sell'
          : 'none';
    const biasMismatch = aiBias !== 'none' && aiBias !== expectedBias;
    const reviewRejected = vision.finalVerdict.action === 'avoid' || biasMismatch;
    const avgRange = Math.max(averageScannerRange(candles, 12), potential.entry * 0.0008);
    const entryZone = vision.entryPlan.entryZone;
    const entryTolerance = Math.max(avgRange * 0.6, Math.abs(potential.entry) * 0.0005);
    const aiZoneMin = entryZone ? Math.min(entryZone.min ?? potential.entry, entryZone.max ?? potential.entry) : null;
    const aiZoneMax = entryZone ? Math.max(entryZone.min ?? potential.entry, entryZone.max ?? potential.entry) : null;
    const entryZoneAligned = aiZoneMin != null && aiZoneMax != null
      ? potential.entry >= aiZoneMin - entryTolerance && potential.entry <= aiZoneMax + entryTolerance
      : true;
    const aiPreferredEntry = aiZoneMin != null && aiZoneMax != null ? (aiZoneMin + aiZoneMax) / 2 : null;
    const aiEntryCloseEnough = aiPreferredEntry != null && Math.abs(aiPreferredEntry - potential.entry) <= entryTolerance;

    reviewed.contextLabels.push('AI live-chart review completed');

    if (reviewRejected) {
      reviewed.activationProbability = Math.min(AI_REVIEW_NEAR_LIVE_THRESHOLD - 1, Math.max(58, reviewed.activationProbability - 12));
      reviewed.confidenceScore = Math.max(1, reviewed.confidenceScore - 2);
      reviewed.requiredTriggers.unshift(
        biasMismatch
          ? `AI live-chart review disagrees with the ${potential.direction.toUpperCase()} bias`
          : 'AI live-chart review marked the current structure as avoid',
      );
      reviewed.contextLabels.push(biasMismatch ? 'AI bias conflict' : 'AI rejected setup');
    } else {
      reviewed.fulfilledConditions.push(`AI live-chart review supports ${potential.direction.toUpperCase()} bias`);
      reviewed.contextLabels.push('AI bias confirmed');

      if (vision.quality.confidence >= 70 || vision.finalVerdict.action === 'enter') {
        reviewed.activationProbability = Math.min(95, reviewed.activationProbability + 2);
        reviewed.confidenceScore = Math.min(10, reviewed.confidenceScore + 1);
      }

      if (!entryZoneAligned) {
        reviewed.activationProbability = Math.min(HIGH_CONFIDENCE_POTENTIAL_THRESHOLD - 1, Math.max(62, reviewed.activationProbability - 8));
        reviewed.confidenceScore = Math.max(1, reviewed.confidenceScore - 1);
        if (aiZoneMin != null && aiZoneMax != null) {
          reviewed.requiredTriggers.unshift(`Entry align with AI zone ${aiZoneMin.toFixed(3)}-${aiZoneMax.toFixed(3)}`);
        } else {
          reviewed.requiredTriggers.unshift('AI review wants a cleaner entry location before promotion');
        }
        reviewed.contextLabels.push('AI entry mismatch');
      } else if (entryZone != null) {
        reviewed.fulfilledConditions.push('AI entry zone overlaps scanner entry');
        reviewed.contextLabels.push('AI entry confirmed');

        if (aiEntryCloseEnough && aiPreferredEntry != null && Math.abs(aiPreferredEntry - reviewed.entry) > 0.000001) {
          const tp1Multiple = computeRewardMultiple(reviewed.direction, reviewed.entry, reviewed.stopLoss, reviewed.takeProfit) ?? 2;
          const tp2Multiple = computeRewardMultiple(reviewed.direction, reviewed.entry, reviewed.stopLoss, reviewed.takeProfit2) ?? 3;
          reviewed.entry = aiPreferredEntry;
          if (usesFixedIndexPoints(reviewed.symbol) || usesFixedJpyPipTargets(reviewed.symbol)) {
            const fixedRiskReviewed = applyFixedSymbolRisk(reviewed);
            reviewed.stopLoss = fixedRiskReviewed.stopLoss;
            reviewed.slReason = fixedRiskReviewed.slReason;
            reviewed.takeProfit = fixedRiskReviewed.takeProfit;
            reviewed.takeProfit2 = fixedRiskReviewed.takeProfit2;
          } else {
            reviewed.takeProfit = projectTargetFromRewardMultiple(reviewed.direction, reviewed.entry, reviewed.stopLoss, tp1Multiple) ?? reviewed.takeProfit;
            reviewed.takeProfit2 = projectTargetFromRewardMultiple(reviewed.direction, reviewed.entry, reviewed.stopLoss, tp2Multiple) ?? reviewed.takeProfit;
          }
          reviewed.fulfilledConditions.push('Entry nudged into nearby AI-approved zone midpoint');
          reviewed.contextLabels.push('AI entry refined');
        }
      }
    }
  } catch (error) {
    reviewed.contextLabels.push('AI review unavailable');
    reviewed.requiredTriggers.unshift('AI live-chart review unavailable — using scanner-only validation');
    console.warn(`[Scanner] AI review skipped for ${symbol}:`, error instanceof Error ? error.message : error);
  }

  aiPotentialReviewCache.set(symbol, {
    fingerprint,
    reviewedPotential: reviewed,
    cachedAt: Date.now(),
  });

  return reviewed;
}

async function maybeReviewNearLivePotentialWithAi(
  symbol: string,
  candles: Candle[],
  potentials: PotentialTradeSetup[],
): Promise<PotentialTradeSetup[]> {
  const reviewIndex = potentials.findIndex((potential) => potential.activationProbability >= AI_REVIEW_NEAR_LIVE_THRESHOLD);
  if (reviewIndex === -1) {
    return potentials;
  }

  const reviewedPotential = await reviewPotentialTradeWithAi(symbol, candles, potentials[reviewIndex]);
  const reviewedPotentials = potentials.map((potential, index) => index === reviewIndex ? reviewedPotential : potential);

  return reviewedPotentials.sort((left, right) => right.activationProbability - left.activationProbability);
}

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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return parseInt(hourStr, 10) % 24; // % 24 handles midnight reported as 24
}

function getEstHourForDate(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  return parseInt(hourStr, 10) % 24;
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
  const weekday = getCurrentEstWeekday();
  const hour = getCurrentEstHour();

  if (sessionType === 'volatility') {
    return true;
  }

  if (weekday === 0 || weekday === 6) {
    return false;
  }

  const window = SESSION_WINDOWS[sessionType];
  return hour >= window.startHour && hour < window.endHour;
}

function getVolatilitySessionBucket(hour: number): VolatilitySessionBucket {
  if (hour >= SESSION_WINDOWS.newyork.endHour || hour < SESSION_WINDOWS.london.startHour) {
    return 'asian';
  }

  if (hour < SESSION_WINDOWS.newyork.startHour) {
    return 'london';
  }

  return 'newyork';
}

function getCurrentVolatilitySessionBucket(): VolatilitySessionBucket {
  return getVolatilitySessionBucket(getCurrentEstHour());
}

function getVolatilitySessionBucketForTimestamp(iso: string): VolatilitySessionBucket {
  return getVolatilitySessionBucket(getEstHourForDate(new Date(iso)));
}

export function getCurrentSessionTypes(): SessionType[] {
  const active: SessionType[] = [];
  if (isSessionActive('london')) active.push('london');
  if (isSessionActive('newyork')) active.push('newyork');
  if (isSessionActive('volatility')) active.push('volatility');
  return active;
}

function getRelevantScannerModes(enabledTypes: Set<SessionType>): SessionType[] {
  const relevantModes: SessionType[] = [];

  if (enabledTypes.has('volatility') && isSessionActive('volatility')) {
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

function getHistoryBackoffKey(symbol: string, timeframe: 'M15' | 'H1', limit: number): string {
  return `${symbol}:${timeframe}:${limit}`;
}

function isHistoryRateLimited(symbol: string, timeframe: 'M15' | 'H1', limit: number): boolean {
  const key = getHistoryBackoffKey(symbol, timeframe, limit);
  const until = historyRateLimitBackoffUntil.get(key);
  if (!until) return false;
  if (until <= Date.now()) {
    historyRateLimitBackoffUntil.delete(key);
    return false;
  }
  return true;
}

function isDerivHistoryRateLimitError(error: unknown): boolean {
  return error instanceof Error && /rate limit.*ticks_history|ticks_history.*rate limit/i.test(error.message);
}

async function loadHistoryScannerCandles(symbol: string, timeframe: 'M15' | 'H1', granularity: 900 | 3600, limit: number): Promise<Candle[]> {
  if (isHistoryRateLimited(symbol, timeframe, limit)) {
    return [];
  }

  try {
    const historyCandles = await getDerivHistoryCandles(symbol, granularity, limit);
    return historyCandles.map((candle) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      time: candle.time * 1000,
    }));
  } catch (error) {
    if (isDerivHistoryRateLimitError(error)) {
      const key = getHistoryBackoffKey(symbol, timeframe, limit);
      historyRateLimitBackoffUntil.set(key, Date.now() + HISTORY_RATE_LIMIT_BACKOFF_MS);
      console.warn(`[Scanner] Deriv history rate limited for ${symbol} ${timeframe}; backing off history requests for ${HISTORY_RATE_LIMIT_BACKOFF_MS / 1000}s.`);
      return [];
    }

    throw error;
  }
}

async function loadScannerCandles(symbol: string, timeframe: 'M15' | 'H1', limit: number, minimum = 200): Promise<Candle[]> {
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

  if (PREFER_HISTORY_BEFORE_CACHE_SYMBOLS.has(symbol)) {
    const historyCandles = await loadHistoryScannerCandles(symbol, timeframe, granularity, limit);
    if (historyCandles.length >= minimum) {
      return historyCandles;
    }
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

  const historyCandles = await loadHistoryScannerCandles(symbol, timeframe, granularity, limit);
  if (historyCandles.length >= minimum) {
    return historyCandles;
  }

  return [];
}

function compressReplayCandles(candles: Candle[]): CompressedReplayCandle[] {
  return candles.map((candle) => [
    Math.floor(candle.time),
    candle.open,
    candle.high,
    candle.low,
    candle.close,
  ]);
}

function findClosestReplayIndex(candles: Candle[], timestampMs: number): number {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candles.length; index++) {
    const distance = Math.abs(candles[index].time - timestampMs);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

function sliceReplayCandles(
  candles: Candle[],
  triggeredAt: string,
  closedAt?: string | null,
): { preEntryCandles: Candle[]; replayCandles: Candle[] } {
  const sorted = [...candles].sort((left, right) => left.time - right.time);
  const triggeredAtMs = new Date(triggeredAt).getTime();
  const closedAtMs = closedAt ? new Date(closedAt).getTime() : null;

  if (!Number.isFinite(triggeredAtMs) || sorted.length === 0) {
    return { preEntryCandles: [], replayCandles: [] };
  }

  const entryIndex = findClosestReplayIndex(sorted, triggeredAtMs);
  const closeIndex = closedAtMs != null && Number.isFinite(closedAtMs)
    ? findClosestReplayIndex(sorted, closedAtMs)
    : sorted.length - 1;
  const boundedCloseIndex = Math.max(entryIndex, closeIndex);

  return {
    preEntryCandles: sorted.slice(Math.max(0, entryIndex - 50), entryIndex),
    replayCandles: sorted.slice(entryIndex, boundedCloseIndex + 1),
  };
}

async function upsertTradeReplay(result: ScanResult, options: {
  triggeredAt: string;
  closedAt?: string | null;
  outcome?: TradeReplayOutcome;
}): Promise<TradeReplay | null> {
  const timeframe = result.timeframe === 'H1' ? 'H1' : 'M15';
  const candles = await loadScannerCandles(result.symbol, timeframe, 400, 80);
  if (candles.length < 55) {
    return null;
  }

  const { preEntryCandles, replayCandles } = sliceReplayCandles(candles, options.triggeredAt, options.closedAt);
  if (replayCandles.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from(TRADE_REPLAY_TABLE)
    .upsert({
      scanResultId: result.id,
      userId: result.userId,
      symbol: result.symbol,
      timeframe: result.timeframe,
      direction: result.direction,
      entry: result.entry,
      stopLoss: result.stopLoss,
      takeProfit: result.takeProfit,
      takeProfit2: result.takeProfit2,
      triggeredAt: options.triggeredAt,
      closedAt: options.closedAt ?? null,
      outcome: options.outcome ?? 'open',
      preEntryCandles: compressReplayCandles(preEntryCandles),
      replayCandles: compressReplayCandles(replayCandles),
      updatedAt: new Date().toISOString(),
    }, { onConflict: 'scanResultId' })
    .select('*')
    .single();

  if (error) {
    console.error(`[Scanner] Failed to upsert trade replay for ${result.symbol}:`, error);
    return null;
  }

  return data as TradeReplay;
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

  if (usesFixedIndexPoints(nextPotential.symbol) || usesFixedJpyPipTargets(nextPotential.symbol)) {
    const fixedRiskPotential = applyFixedSymbolRisk(nextPotential);
    fixedRiskPotential.fulfilledConditions.push(usesFixedIndexPoints(nextPotential.symbol) ? 'Fixed NAS100/US30 TP/SL applied' : 'Fixed JPY pair TP/SL applied');
    fixedRiskPotential.contextLabels.push(usesFixedIndexPoints(nextPotential.symbol) ? 'Fixed index risk' : 'Fixed JPY pip risk');
    return fixedRiskPotential;
  }

  const risk = Math.abs(nextPotential.entry - nextPotential.stopLoss);
  const fallbackTakeProfit = nextPotential.direction === 'buy'
    ? nextPotential.entry + risk * 2
    : nextPotential.entry - risk * 2;
  const higherTimeframeTargets = collectHigherTimeframeTargets(nextPotential.direction, h1Context.h1Candles, nextPotential.entry);

  nextPotential.takeProfit = selectDirectionalTarget(
    nextPotential.direction,
    higherTimeframeTargets,
    nextPotential.entry,
    risk * 1.4,
    fallbackTakeProfit,
  );
  nextPotential.takeProfit2 = nextPotential.takeProfit;

  nextPotential.fulfilledConditions.push('H1 target map applied');
  nextPotential.contextLabels.push('Final TP refined with H1 structure');

  return nextPotential;
}

function promotePotentialToScanCycleResult(potential: PotentialTradeSetup): ScanCycleResult {
  return {
    symbol: potential.symbol,
    direction: potential.direction,
    entry: potential.entry,
    stopLoss: potential.stopLoss,
    slReason: potential.slReason ?? null,
    takeProfit: potential.takeProfit,
    takeProfit2: potential.takeProfit2,
    emaMomentum: potential.emaMomentum,
    emaStack: potential.emaStack,
    emaEntryValid: potential.emaEntryValid,
    confidenceScore: potential.confidenceScore,
    marketRegime: potential.marketRegime,
    strategy: potential.strategy.replace(/ Watchlist$/i, ''),
    confirmations: potential.confirmations,
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
    uniqueSymbols.map(async (symbol) => {
      try {
        return [symbol, await loadLatestScannerPrice(symbol)] as const;
      } catch (error) {
        console.error(`[Scanner] Failed to attach live price for ${symbol}:`, error);
        return [symbol, null] as const;
      }
    }),
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

async function hasTakeProfitOneAlert(scanResultId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from(SCANNER_ALERT_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('scanResultId', scanResultId)
    .eq('type', 'trade')
    .like('message', '%TP1 hit%');

  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

async function hasBreakevenAlert(scanResultId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from(SCANNER_ALERT_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('scanResultId', scanResultId)
    .eq('type', 'trade')
    .like('message', '%breakeven%');

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

  if (scope === 'history') {
    return scopedResults.map((result) => ({ ...result, currentPrice: result.currentPrice ?? null }));
  }

  return attachLivePricesToResults(scopedResults);
}

export async function getTradeReplayForUser(userId: string, scanResultId: string): Promise<TradeReplay | null> {
  const { data: resultData, error: resultError } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('*')
    .eq('id', scanResultId)
    .eq('userId', userId)
    .limit(1)
    .maybeSingle();

  if (resultError) {
    throw new Error(resultError.message);
  }

  const result = resultData as ScanResult | null;
  if (!result || !result.triggeredAt) {
    return null;
  }

  const { data, error } = await supabase
    .from(TRADE_REPLAY_TABLE)
    .select('*')
    .eq('scanResultId', scanResultId)
    .eq('userId', userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const replay = data as TradeReplay | null;
  if (replay && (result.status !== 'closed' || replay.outcome === (result.closeReason ?? 'open'))) {
    return replay;
  }

  return upsertTradeReplay(result, {
    triggeredAt: result.triggeredAt,
    closedAt: result.closedAt,
    outcome: result.closeReason ?? 'open',
  });
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

function getFinalTakeProfit(result: ScanResult): number {
  return hasSecondaryTakeProfit(result) ? result.takeProfit2 ?? result.takeProfit : result.takeProfit;
}

function hasSecondaryTakeProfit(result: ScanResult): boolean {
  return result.takeProfit2 != null
    && Number.isFinite(result.takeProfit2)
    && Math.abs(result.takeProfit2 - result.takeProfit) > Number.EPSILON;
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
      await updateScanResult(result.id, {
        status: 'invalidated',
        closedAt: new Date().toISOString(),
      });

      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: `${result.symbol} setup invalidated — price broke through stop loss level before entry`,
        type: 'warning',
      });
      alerts.push(alert);

      sendPushToUser(result.userId, {
        title: 'Trade Invalidated',
        body: `${result.symbol} setup was invalidated before entry after price broke the stop loss level.`,
        tag: `invalidated-${result.id}`,
        url: '/dashboard/scanner',
      }).catch((err) => console.error('[Push] Failed to send invalidation notification:', err));

      return alerts;
    }

    const entryTriggered = result.direction === 'buy'
      ? lowPrice <= result.entry
      : highPrice >= result.entry;

    if (entryTriggered) {
      const triggeredAt = new Date().toISOString();
      await updateScanResult(result.id, {
        status: 'triggered',
        triggeredAt,
      });

      await upsertTradeReplay(result, {
        triggeredAt,
        outcome: 'open',
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

      // Auto trading integration — forward signal to auto trader engine
      processSignal({
        userId: result.userId,
        symbol: result.symbol,
        direction: result.direction,
        entryPrice: result.entry,
        sl: result.stopLoss,
        tp: result.takeProfit,
        confidence: result.confidenceScore >= 80 ? 'A+' : result.confidenceScore >= 65 ? 'A' : 'B',
        marketState: result.marketRegime,
        scanResultId: result.id,
      }).catch((err) => console.error('[AutoTrader] Failed to process signal:', err));

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
    const finalTakeProfit = getFinalTakeProfit(result);
    const risk = Math.abs(result.entry - result.stopLoss);
    const finalReward = Math.abs(finalTakeProfit - result.entry);
    const halfwayToFinalTarget = finalReward * 0.5;
    const breakevenMoveRequirement = Math.max(halfwayToFinalTarget, risk * 1.1);
    const breakevenTriggerPrice = result.direction === 'buy'
      ? result.entry + breakevenMoveRequirement
      : result.entry - breakevenMoveRequirement;
    const hitBreakevenProtectZone = result.direction === 'buy'
      ? highPrice >= breakevenTriggerPrice
      : lowPrice <= breakevenTriggerPrice;
    const hitTakeProfitOne = result.direction === 'buy'
      ? highPrice >= result.takeProfit
      : lowPrice <= result.takeProfit;
    const hitTakeProfit = result.direction === 'buy'
      ? highPrice >= finalTakeProfit
      : lowPrice <= finalTakeProfit;

    const hitStopLoss = result.direction === 'buy'
      ? lowPrice <= result.stopLoss
      : highPrice >= result.stopLoss;

    if (Number.isFinite(risk)
      && risk > 0
      && Number.isFinite(finalReward)
      && finalReward > 0
      && hitBreakevenProtectZone
      && !(await hasBreakevenAlert(result.id))) {
      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: `${result.symbol} breakeven protect zone reached — consider moving SL to entry at ${result.entry.toFixed(decimals)}`,
        type: 'trade',
      });
      alerts.push(alert);

      sendPushToUser(result.userId, {
        title: 'Move SL To Breakeven',
        body: `${result.symbol} reached the breakeven protect zone. Consider moving stop loss to entry at ${result.entry.toFixed(decimals)}.`,
        tag: `breakeven-${result.id}`,
        url: '/dashboard/scanner',
      }).catch((err) => console.error('[Push] Failed to send breakeven notification:', err));
    }

    if (hasSecondaryTakeProfit(result) && hitTakeProfitOne && !hitTakeProfit && !(await hasTakeProfitOneAlert(result.id))) {
      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: `${result.symbol} TP1 hit at ${result.takeProfit.toFixed(decimals)} — trade remains live toward final target`,
        type: 'trade',
      });
      alerts.push(alert);

      sendPushToUser(result.userId, {
        title: 'TP1 Hit',
        body: `${result.symbol} reached TP1 at ${result.takeProfit.toFixed(decimals)}. Trade is still running toward the final target.`,
        tag: `tp1-${result.id}`,
        url: '/dashboard/scanner',
      }).catch((err) => console.error('[Push] Failed to send TP1 notification:', err));
    }

    if (hitTakeProfit || hitStopLoss) {
      const closeReason: ScanCloseReason = hitTakeProfit ? 'tp' : 'sl';
      const closedAt = new Date().toISOString();
      await updateScanResult(result.id, {
        status: 'closed',
        closeReason,
        closedAt,
      });

      if (result.triggeredAt) {
        await upsertTradeReplay(result, {
          triggeredAt: result.triggeredAt,
          closedAt,
          outcome: closeReason ?? 'open',
        });
      }

      const alert = await insertAlert({
        userId: result.userId,
        scanResultId: result.id,
        message: hitTakeProfit
          ? `${result.symbol} trade closed in profit — final take profit hit at ${currentPrice.toFixed(decimals)}`
          : `${result.symbol} trade closed at stop loss — SL hit at ${currentPrice.toFixed(decimals)}`,
        type: hitTakeProfit ? 'trade' : 'warning',
      });
      alerts.push(alert);

      sendPushToUser(result.userId, {
        title: hitTakeProfit ? 'Final Take Profit Hit' : 'Stop Loss Hit',
        body: hitTakeProfit
          ? `${result.symbol} closed in profit at the final target.`
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
  volatility: 5,
};
const SESSION_REASSESS_COOLDOWN_MS = 90 * 60_000;
const SESSION_ENTRY_SPACING_MS = 60 * 60_000;
const SCANNER_ACTIVITY_LOOKBACK_MS = 24 * 60 * 60_000;

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

async function getRecentScannerActivity(userId: string): Promise<RecentScannerActivity[]> {
  const sinceIso = new Date(Date.now() - SCANNER_ACTIVITY_LOOKBACK_MS).toISOString();

  const { data, error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('symbol, direction, sessionType, status, createdAt, closedAt, closeReason')
    .eq('userId', userId)
    .gte('createdAt', sinceIso)
    .in('status', ['active', 'triggered', 'closed', 'invalidated'])
    .order('createdAt', { ascending: false })
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as RecentScannerActivity[];
}

function isSessionInReassessmentCooldown(activities: RecentScannerActivity[], sessionType: SessionType): boolean {
  const now = Date.now();

  return activities.some((activity) => {
    if (activity.sessionType !== sessionType) {
      return false;
    }

    if (activity.status !== 'closed' && activity.status !== 'invalidated') {
      return false;
    }

    const closedAtMs = activity.closedAt ? new Date(activity.closedAt).getTime() : 0;
    return closedAtMs > 0 && now - closedAtMs < SESSION_REASSESS_COOLDOWN_MS;
  });
}

function isSessionEntrySpacingActive(activities: RecentScannerActivity[], sessionType: SessionType): boolean {
  const now = Date.now();

  return activities.some((activity) => {
    if (activity.sessionType !== sessionType) {
      return false;
    }

    const createdAtMs = new Date(activity.createdAt).getTime();
    return createdAtMs > 0 && now - createdAtMs < SESSION_ENTRY_SPACING_MS;
  });
}

function isSymbolInReentryCooldown(activities: RecentScannerActivity[], symbol: string): boolean {
  const now = new Date();

  for (const activity of activities) {
    if (activity.symbol !== symbol) continue;
    if (activity.status !== 'closed' && activity.status !== 'invalidated') continue;

    const cooldownMinutes = getCooldownMinutes({
      symbol,
      result: activity.closeReason as TradeResult,
    });

    if (isSymbolOnCooldown(activity.closedAt, cooldownMinutes, now)) {
      return true;
    }
  }

  return false;
}

/** Find the most recent closed activity for a symbol (used for continuation logic). */
function findLastClosedActivity(
  activities: RecentScannerActivity[],
  symbol: string,
): RecentScannerActivity | null {
  return activities.find(
    (a) => a.symbol === symbol && a.status === 'closed' && (a.closeReason === 'tp' || a.closeReason === 'sl'),
  ) ?? null;
}

function getVolatilityBucketTradeCount(
  activities: RecentScannerActivity[],
  bucket: VolatilitySessionBucket,
): number {
  const dayStartMs = new Date(getStartOfNewYorkDay()).getTime();

  return activities.filter((activity) => {
    if (activity.sessionType !== 'volatility') {
      return false;
    }

    const createdAtMs = new Date(activity.createdAt).getTime();
    if (createdAtMs < dayStartMs) {
      return false;
    }

    return getVolatilitySessionBucketForTimestamp(activity.createdAt) === bucket;
  }).length;
}

// ── Core scanner logic ──

interface ScanCycleResult {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  slReason?: string | null;
  takeProfit: number;
  takeProfit2: number | null;
  emaMomentum: boolean;
  emaStack: 'bullish' | 'bearish' | 'neutral';
  emaEntryValid: boolean;
  confidenceScore: number;
  marketRegime: MarketRegime;
  strategy: string;
  confirmations: TradeConfirmations;
  score: number;
}

async function buildPotentialForSymbol(symbol: string): Promise<PotentialTradeSetup[]> {
  try {
    const candles = await loadScannerCandles(symbol, 'M15', 600);
    if (candles.length < 200) {
      return [];
    }

    const freshPotentials = analyzePotentialTrades(symbol, candles);

    // Check cache — if the setup fingerprint hasn't changed, return
    // the locked version (preserves entry, SL, TP) with updated currentPrice.
    const cached = getCachedPotentials(symbol, freshPotentials);
    if (cached) {
      return cached;
    }

    let potentials = freshPotentials;

    if (!potentials.some((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD)) {
      potentials = await maybeReviewNearLivePotentialWithAi(symbol, candles, potentials);
      setCachedPotentials(symbol, potentials);
      return potentials;
    }

    const h1Candles = await loadScannerCandles(symbol, 'H1', 320, 80);

    if (h1Candles.length < 80) {
      potentials = potentials.map((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD
        ? {
            ...potential,
            activationProbability: Math.min(89, potential.activationProbability - 5),
            requiredTriggers: ['Need H1 confirmation before promoting this setup', ...potential.requiredTriggers],
            contextLabels: [...potential.contextLabels, 'Waiting for H1 confirmation'],
          }
        : potential);
      setCachedPotentials(symbol, potentials);
      return potentials;
    }

    potentials = potentials
      .map((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD
        ? refinePotentialTradeWithH1(potential, { h1Candles })
        : potential)
      .filter((potential): potential is PotentialTradeSetup => potential !== null);

    potentials = await maybeReviewNearLivePotentialWithAi(symbol, candles, potentials);

    setCachedPotentials(symbol, potentials);
    return potentials;
  } catch (err) {
    console.error(`[Scanner] Failed to build potential trade for ${symbol}:`, err);
    return [];
  }
}

async function scanSymbol(symbol: string): Promise<ScanCycleResult | null> {
  try {
    const candles = await loadScannerCandles(symbol, 'M15', 600);
    if (candles.length < 200) {
      return null;
    }

    const potentials = analyzePotentialTrades(symbol, candles);
    const promotablePotential = potentials.find((potential) => potential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD) ?? null;

    if (promotablePotential) {
      const h1Candles = await loadScannerCandles(symbol, 'H1', 320, 80);
      if (h1Candles.length >= 80) {
        const refinedPotential = refinePotentialTradeWithH1(promotablePotential, { h1Candles });
        if (refinedPotential && refinedPotential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD) {
          const aiReviewedPotential = await reviewPotentialTradeWithAi(symbol, candles, refinedPotential);
          if (aiReviewedPotential.activationProbability >= HIGH_CONFIDENCE_POTENTIAL_THRESHOLD) {
            return promotePotentialToScanCycleResult(aiReviewedPotential);
          }
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
      slReason: setup.slReason ?? null,
      takeProfit: setup.takeProfit,
      takeProfit2: setup.takeProfit2,
      emaMomentum: setup.emaMomentum,
      emaStack: setup.emaStack,
      emaEntryValid: setup.emaEntryValid,
      confidenceScore: setup.confidenceScore,
      marketRegime: setup.marketRegime,
      strategy: setup.strategy,
      confirmations: setup.confirmations,
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
  const recentActivity = await getRecentScannerActivity(userId);

  if (dailyCount >= MAX_TRADES_PER_DAY) {
    console.log(`[Scanner] Daily limit reached for user ${userId} (${dailyCount}/${MAX_TRADES_PER_DAY})`);
    return { results: [], alerts: [] };
  }

  const savedResults: ScanResult[] = [];
  const savedAlerts: ScannerAlert[] = [];
  const claimedSymbols = new Set<string>();

  for (const sessionType of relevantSessions) {
    if (isSessionInReassessmentCooldown(recentActivity, sessionType)) {
      continue;
    }

    const maxTradesForSession = MAX_TRADES_PER_DAY_BY_SESSION[sessionType];
    const sessionCount = await getTodayTradeCount(userId, sessionType);
    if (sessionCount >= maxTradesForSession) {
      console.log(`[Scanner] Session limit reached for user ${userId} ${sessionType} (${sessionCount}/${maxTradesForSession})`);
      continue;
    }

    const remainingDaily = MAX_TRADES_PER_DAY - dailyCount;
    const remainingSession = maxTradesForSession - sessionCount;
    let slotsAvailable = Math.min(remainingDaily, remainingSession);

    if (sessionType === 'volatility') {
      const bucket = getCurrentVolatilitySessionBucket();
      const bucketLimit = VOLATILITY_BUCKET_LIMITS[bucket];
      const bucketCount = getVolatilityBucketTradeCount(recentActivity, bucket);
      const remainingBucket = bucketLimit - bucketCount;

      if (remainingBucket <= 0) {
        continue;
      }

      slotsAvailable = Math.min(slotsAvailable, remainingBucket);
    }

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

      if (isSessionEntrySpacingActive(recentActivity, sessionType)) {
        break;
      }

      if (claimedSymbols.has(result.symbol)) {
        continue;
      }

      if (isSymbolInReentryCooldown(recentActivity, result.symbol)) {
        const lastClosed = findLastClosedActivity(recentActivity, result.symbol);
        if (
          lastClosed &&
          allowContinuation({
            lastDirection: lastClosed.direction as 'buy' | 'sell',
            lastResult: lastClosed.closeReason as TradeResult,
            newDirection: result.direction,
            confidenceScore: result.confidenceScore,
          })
        ) {
          console.log(`[Scanner] Continuation allowed for ${result.symbol} (${result.direction}, confidence ${result.confidenceScore}) after win`);
        } else {
          console.log(`[Scanner] Cooldown active for ${result.symbol}, skipping`);
          continue;
        }
      }

      if (isDuplicate(userId, result.symbol, result.direction)) {
        continue;
      }

      const existingOpenResult = await getOpenResultForUserSymbol(userId, result.symbol);
      if (existingOpenResult) {
        claimedSymbols.add(result.symbol);
        continue;
      }

      if (!passesPostFirstTradeFilter({ sessionTradeCount: sessionCount, confidenceScore: result.confidenceScore })) {
        console.log(`[Scanner] Confidence filter blocked ${result.symbol} (confidence ${result.confidenceScore}, sessionCount ${sessionCount})`);
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
        emaMomentum: result.emaMomentum,
        emaStack: result.emaStack,
        emaEntryValid: result.emaEntryValid,
        confidenceScore: result.confidenceScore,
        marketRegime: result.marketRegime,
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
      recentActivity.unshift({
        symbol: scanResult.symbol,
        direction: scanResult.direction,
        sessionType: scanResult.sessionType,
        status: scanResult.status,
        createdAt: scanResult.createdAt,
        closedAt: scanResult.closedAt,
        closeReason: scanResult.closeReason,
      });
      dailyCount += 1;

      // Fire-and-forget: generate chart snapshot in the background
      loadScannerCandles(result.symbol, SCANNER_TIMEFRAME, 600)
        .then((snapshotCandles) =>
          generateAndUploadSnapshot(scanResult.id, {
            symbol: result.symbol,
            direction: result.direction,
            entry: result.entry,
            stopLoss: result.stopLoss,
            takeProfit: result.takeProfit,
            takeProfit2: result.takeProfit2,
            candles: snapshotCandles,
          }),
        )
        .catch((err) => console.error(`[Scanner] Snapshot generation failed for ${result.symbol}:`, err));

      const directionLabel = result.direction.toUpperCase();
      const modeLabel = sessionType === 'volatility' ? 'Volatility 24/7' : `${sessionType === 'london' ? 'London' : 'New York'} Session`;
      const alert = await insertAlert({
        userId,
        scanResultId: scanResult.id,
        message: `High-quality ${modeLabel} setup detected on ${result.symbol} (${directionLabel}) — Score ${result.score}/9, ${result.strategy}, final TP 1:2 mapped.`,
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
