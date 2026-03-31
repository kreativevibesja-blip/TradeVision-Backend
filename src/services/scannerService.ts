import { supabase } from '../lib/supabase';
import { fetchMarketDataForLiveChart, resolveLiveChartSymbol } from './marketData';
import { analyzeLiveChartCandles } from './liveChartAnalysis';
import { generateFinalSignal } from './signalEngine';
import type { VisionAnalysisResult } from './visionAnalysis';

// ── Types ──

export type SessionType = 'london' | 'newyork';
export type ScanResultStatus = 'active' | 'triggered' | 'invalidated' | 'expired';
export type AlertType = 'info' | 'trade' | 'warning';

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
  confidenceScore: number;
  strategy: string | null;
  confirmations: string[];
  sessionType: SessionType;
  status: ScanResultStatus;
  rank: number | null;
  createdAt: string;
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

// ── Table names ──

const SCANNER_SESSION_TABLE = 'ScannerSession';
const SCAN_RESULT_TABLE = 'ScanResult';
const SCANNER_ALERT_TABLE = 'ScannerAlert';

// ── Session windows (EST / America/New_York) ──

interface SessionWindow {
  startHour: number;
  endHour: number;
}

const SESSION_WINDOWS: Record<SessionType, SessionWindow> = {
  london: { startHour: 2, endHour: 11 },
  newyork: { startHour: 8, endHour: 17 },
};

// ── Scanner symbols and timeframe ──

const SCANNER_SYMBOLS = [
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'XAUUSD',
];

const SCANNER_TIMEFRAME = 'M15';

// ── Helpers ──

function getCurrentEstHour(): number {
  const now = new Date();
  const estString = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const hour = parseInt(estString.split(',')[1]?.trim().split(':')[0] ?? '0', 10);
  return hour;
}

function isSessionActive(sessionType: SessionType): boolean {
  const hour = getCurrentEstHour();
  const window = SESSION_WINDOWS[sessionType];
  return hour >= window.startHour && hour < window.endHour;
}

function getCurrentSessionTypes(): SessionType[] {
  const active: SessionType[] = [];
  if (isSessionActive('london')) active.push('london');
  if (isSessionActive('newyork')) active.push('newyork');
  return active;
}

// ── Scoring ──

interface ScoreBreakdown {
  trendAlignment: boolean;
  pullbackZone: boolean;
  hasConfirmation: boolean;
  structureLevel: boolean;
  total: number;
}

function scoreSetup(vision: VisionAnalysisResult): ScoreBreakdown {
  let total = 0;

  // +2 trend alignment
  const trendAlignment =
    (vision.trend === 'bullish' && (vision.structure.bos === 'bullish' || vision.structure.state === 'higher highs')) ||
    (vision.trend === 'bearish' && (vision.structure.bos === 'bearish' || vision.structure.state === 'lower lows'));
  if (trendAlignment) total += 2;

  // +2 pullback zone
  const pullbackZone = Boolean(
    vision.entryPlan.bias !== 'none' &&
    vision.entryPlan.entryZone &&
    (vision.zones.supply || vision.zones.demand)
  );
  if (pullbackZone) total += 2;

  // +2 confirmation
  const confirmationText = [
    vision.entryPlan.confirmation,
    ...(vision.confirmations ?? []),
  ].join(' ').toLowerCase();
  const hasConfirmation =
    /engulf/i.test(confirmationText) ||
    /rejection|wick|pin bar/i.test(confirmationText) ||
    /liquidity sweep/i.test(confirmationText) ||
    /bos|choch/i.test(confirmationText);
  if (hasConfirmation) total += 2;

  // +1 structure level
  const structureLevel = vision.structure.bos !== 'none' || vision.structure.choch !== 'none';
  if (structureLevel) total += 1;

  return { trendAlignment, pullbackZone, hasConfirmation, structureLevel, total };
}

function buildConfirmationLabels(vision: VisionAnalysisResult): string[] {
  const labels: string[] = [];

  if (vision.structure.bos !== 'none') labels.push(`BOS (${vision.structure.bos})`);
  if (vision.structure.choch !== 'none') labels.push(`CHoCH (${vision.structure.choch})`);

  const text = [
    vision.entryPlan.confirmation,
    ...(vision.confirmations ?? []),
  ].join(' ');

  if (/engulf/i.test(text)) labels.push('Engulfing candle');
  if (/rejection|wick|pin bar/i.test(text)) labels.push('Rejection wick');
  if (/liquidity sweep/i.test(text)) labels.push('Liquidity sweep');

  if (vision.liquidity.type !== 'none') {
    const sweepLabel = `Liquidity ${vision.liquidity.type}`;
    if (!labels.includes(sweepLabel)) labels.push(sweepLabel);
  }

  return labels;
}

// ── Deduplication ──

const recentScanKeys = new Map<string, number>();
const DEDUP_WINDOW_MS = 5 * 60_000; // 5 minutes

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
): Promise<ScanResult[]> {
  let query = supabase
    .from(SCAN_RESULT_TABLE)
    .select('*')
    .eq('userId', userId)
    .order('createdAt', { ascending: false })
    .limit(limit);

  if (sessionType) {
    query = query.eq('sessionType', sessionType);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ScanResult[];
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
  sessionType: SessionType,
): Promise<{ total: number; triggered: number; invalidated: number; active: number }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('status')
    .eq('userId', userId)
    .eq('sessionType', sessionType)
    .gte('createdAt', today.toISOString());

  if (error) throw new Error(error.message);

  const results = data ?? [];
  return {
    total: results.length,
    triggered: results.filter((r: any) => r.status === 'triggered').length,
    invalidated: results.filter((r: any) => r.status === 'invalidated').length,
    active: results.filter((r: any) => r.status === 'active').length,
  };
}

async function insertScanResult(result: Omit<ScanResult, 'id' | 'createdAt'>): Promise<ScanResult> {
  const { data, error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .insert(result)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ScanResult;
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
  return data as ScannerAlert;
}

// ── Core scanner logic ──

interface ScanCycleResult {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidenceScore: number;
  strategy: string;
  confirmations: string[];
  score: number;
}

async function scanSymbol(symbol: string): Promise<ScanCycleResult | null> {
  const resolved = resolveLiveChartSymbol(symbol);
  if (!resolved) return null;

  try {
    const marketData = await fetchMarketDataForLiveChart(symbol, SCANNER_TIMEFRAME);
    const candlesForAnalysis = marketData.candles.map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const vision = await analyzeLiveChartCandles(resolved.label, SCANNER_TIMEFRAME, candlesForAnalysis);
    const signal = generateFinalSignal(vision, marketData.currentPrice);

    const scoring = scoreSetup(vision);
    if (scoring.total < 5) return null;

    const direction = vision.entryPlan.bias;
    if (direction === 'none') return null;

    const entryMid = vision.entryPlan.entryZone
      ? ((vision.entryPlan.entryZone.min ?? 0) + (vision.entryPlan.entryZone.max ?? 0)) / 2
      : marketData.currentPrice;

    const stopLoss = signal.stopLoss ?? (direction === 'buy' ? entryMid * 0.997 : entryMid * 1.003);
    const takeProfit = signal.takeProfit1 ?? (direction === 'buy' ? entryMid * 1.006 : entryMid * 0.994);

    if ((direction === 'buy' && takeProfit <= entryMid) || (direction === 'sell' && takeProfit >= entryMid)) {
      return null;
    }

    const confirmations = buildConfirmationLabels(vision);
    const strategy = signal.primaryStrategy
      ?? (vision.trend === 'bullish' ? 'Bullish Pullback Continuation' : 'Bearish Pullback Continuation');

    return {
      symbol,
      direction,
      entry: entryMid,
      stopLoss,
      takeProfit,
      confidenceScore: signal.confidence,
      strategy,
      confirmations,
      score: scoring.total,
    };
  } catch (err) {
    console.error(`[Scanner] Failed to scan ${symbol}:`, err);
    return null;
  }
}

export async function runSessionScanner(userId: string): Promise<{ results: ScanResult[]; alerts: ScannerAlert[] }> {
  const activeSessions = getCurrentSessionTypes();
  if (activeSessions.length === 0) {
    return { results: [], alerts: [] };
  }

  // Get user's enabled sessions
  const userSessions = await getActiveSessionsForUser(userId);
  const enabledTypes = new Set(
    userSessions.filter((s) => s.isActive).map((s) => s.sessionType)
  );

  const relevantSessions = activeSessions.filter((s) => enabledTypes.has(s));
  if (relevantSessions.length === 0) {
    return { results: [], alerts: [] };
  }

  // Scan all symbols in parallel
  const scanPromises = SCANNER_SYMBOLS.map((symbol) => scanSymbol(symbol));
  const rawResults = await Promise.all(scanPromises);

  // Filter valid, sort by score, take top 3
  const validResults = rawResults
    .filter((r): r is ScanCycleResult => r !== null)
    .sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore)
    .slice(0, 3);

  const savedResults: ScanResult[] = [];
  const savedAlerts: ScannerAlert[] = [];

  for (let i = 0; i < validResults.length; i++) {
    const result = validResults[i];
    const sessionType = relevantSessions[0]; // Primary session

    // Deduplicate
    if (isDuplicate(userId, result.symbol, result.direction)) {
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
      confidenceScore: result.confidenceScore,
      strategy: result.strategy,
      confirmations: result.confirmations,
      sessionType,
      status: 'active',
      rank: i + 1,
    });

    savedResults.push(scanResult);

    // Create alert
    const directionLabel = result.direction.toUpperCase();
    const alert = await insertAlert({
      userId,
      scanResultId: scanResult.id,
      message: `High-quality setup detected on ${result.symbol} (${directionLabel}) — Score ${result.score}/7, ${result.strategy}`,
      type: 'trade',
    });

    savedAlerts.push(alert);
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
    .eq('status', 'active')
    .order('createdAt', { ascending: false })
    .limit(10);

  if (!activeResults?.length) return [];

  const alerts: ScannerAlert[] = [];

  for (const result of activeResults as ScanResult[]) {
    const resolved = resolveLiveChartSymbol(result.symbol);
    if (!resolved) continue;

    try {
      const marketData = await fetchMarketDataForLiveChart(result.symbol, 'M5');
      const currentPrice = marketData.currentPrice;
      const entryDistance = Math.abs(currentPrice - result.entry);
      const slDistance = Math.abs(result.entry - result.stopLoss);
      const proximityRatio = entryDistance / slDistance;

      // Alert if price is within 30% of entry distance relative to SL
      if (proximityRatio <= 0.3) {
        const alert = await insertAlert({
          userId,
          scanResultId: result.id,
          message: `${result.symbol} approaching ${result.direction === 'buy' ? 'buy' : 'sell'} zone — price is near entry at ${currentPrice.toFixed(result.entry >= 100 ? 2 : 5)}`,
          type: 'warning',
        });
        alerts.push(alert);
      }

      // Invalidate if price blew through stop loss
      const isInvalidated = result.direction === 'buy'
        ? currentPrice < result.stopLoss
        : currentPrice > result.stopLoss;

      if (isInvalidated) {
        await supabase
          .from(SCAN_RESULT_TABLE)
          .update({ status: 'invalidated' })
          .eq('id', result.id);

        await insertAlert({
          userId,
          scanResultId: result.id,
          message: `${result.symbol} setup invalidated — price broke through stop loss level`,
          type: 'warning',
        });
      }
    } catch {
      // Skip symbols that fail to fetch
    }
  }

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

export { isSessionActive, getCurrentSessionTypes, SCANNER_SYMBOLS, SCANNER_TIMEFRAME };
