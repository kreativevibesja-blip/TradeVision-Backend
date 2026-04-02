import { supabase } from '../lib/supabase';
import { fetchMarketDataForLiveChart, resolveLiveChartSymbol } from './marketData';
import { analyzeMarket, type Candle } from './scannerEngine';
import { sendPushToUser } from './pushService';

// ── Types ──

export type SessionType = 'london' | 'newyork';
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

type ScanResultScope = 'all' | 'current' | 'history';

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
): Promise<{ total: number; triggered: number; closed: number; invalidated: number; active: number }> {
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
    closed: results.filter((r: any) => r.status === 'closed').length,
    invalidated: results.filter((r: any) => r.status === 'invalidated').length,
    active: results.filter((r: any) => r.status === 'active').length,
  };
}

async function updateScanResult(
  id: string,
  updates: Partial<Pick<ScanResult, 'status' | 'closeReason' | 'triggeredAt' | 'closedAt'>>,
): Promise<void> {
  const { error } = await supabase
    .from(SCAN_RESULT_TABLE)
    .update(updates)
    .eq('id', id);

  if (error) throw new Error(error.message);
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

// ── Session trade limits ──

const MAX_TRADES_PER_SESSION = 3;
const MAX_TRADES_PER_DAY = 6;

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

    // Convert MarketCandle[] → Candle[] for the pure-logic engine
    const candles: Candle[] = marketData.candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      time: new Date(c.timestamp).getTime(),
    }));

    const setup = analyzeMarket(symbol, candles);
    if (!setup) return null;

    return {
      symbol: setup.symbol,
      direction: setup.direction,
      entry: setup.entry,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
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

  const sessionType = relevantSessions[0]; // Primary session

  // ── Enforce daily & per-session trade limits ──
  const [dailyCount, sessionCount] = await Promise.all([
    getTodayTradeCount(userId),
    getTodayTradeCount(userId, sessionType),
  ]);

  if (dailyCount >= MAX_TRADES_PER_DAY) {
    console.log(`[Scanner] Daily limit reached for user ${userId} (${dailyCount}/${MAX_TRADES_PER_DAY})`);
    return { results: [], alerts: [] };
  }

  if (sessionCount >= MAX_TRADES_PER_SESSION) {
    console.log(`[Scanner] Session limit reached for user ${userId} ${sessionType} (${sessionCount}/${MAX_TRADES_PER_SESSION})`);
    return { results: [], alerts: [] };
  }

  const remainingDaily = MAX_TRADES_PER_DAY - dailyCount;
  const remainingSession = MAX_TRADES_PER_SESSION - sessionCount;
  const slotsAvailable = Math.min(remainingDaily, remainingSession);

  // Scan all symbols in parallel
  const scanPromises = SCANNER_SYMBOLS.map((symbol) => scanSymbol(symbol));
  const rawResults = await Promise.all(scanPromises);

  // Filter valid, sort by score, cap to available slots
  const validResults = rawResults
    .filter((r): r is ScanCycleResult => r !== null)
    .sort((a, b) => b.score - a.score || b.confidenceScore - a.confidenceScore)
    .slice(0, slotsAvailable);

  const savedResults: ScanResult[] = [];
  const savedAlerts: ScannerAlert[] = [];

  for (let i = 0; i < validResults.length; i++) {
    const result = validResults[i];

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
      closeReason: null,
      triggeredAt: null,
      closedAt: null,
      rank: i + 1,
    });

    savedResults.push(scanResult);

    // Create alert
    const directionLabel = result.direction.toUpperCase();
    const alert = await insertAlert({
      userId,
      scanResultId: scanResult.id,
      message: `High-quality setup detected on ${result.symbol} (${directionLabel}) — Score ${result.score}/9, ${result.strategy}`,
      type: 'trade',
    });

    savedAlerts.push(alert);

    // Send browser push notification
    sendPushToUser(userId, {
      title: 'TradeVision Alert \ud83d\udea8',
      body: `${result.symbol} ${directionLabel} setup detected (Score ${result.score}/9)`,
      tag: `scan-${result.symbol}-${result.direction}`,
      url: '/dashboard/scanner',
    }).catch((err) => console.error('[Push] Failed to send:', err));
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
    const resolved = resolveLiveChartSymbol(result.symbol);
    if (!resolved) continue;

    try {
      const marketData = await fetchMarketDataForLiveChart(result.symbol, 'M5');
      const currentPrice = marketData.currentPrice;
      const decimals = result.entry >= 100 ? 2 : 5;

      if (result.status === 'active') {
        const entryDistance = Math.abs(currentPrice - result.entry);
        const slDistance = Math.abs(result.entry - result.stopLoss) || 1;
        const proximityRatio = entryDistance / slDistance;

        const entryTriggered = result.direction === 'buy'
          ? currentPrice <= result.entry && currentPrice > result.stopLoss
          : currentPrice >= result.entry && currentPrice < result.stopLoss;

        if (entryTriggered) {
          await updateScanResult(result.id, {
            status: 'triggered',
            triggeredAt: new Date().toISOString(),
          });

          const alert = await insertAlert({
            userId,
            scanResultId: result.id,
            message: `${result.symbol} ${result.direction.toUpperCase()} trade triggered at ${currentPrice.toFixed(decimals)}`,
            type: 'trade',
          });
          alerts.push(alert);

          sendPushToUser(userId, {
            title: 'Trade Triggered',
            body: `${result.symbol} ${result.direction.toUpperCase()} is now live at ${currentPrice.toFixed(decimals)}`,
            tag: `trigger-${result.id}`,
            url: '/dashboard/scanner',
          }).catch((err) => console.error('[Push] Failed to send trigger notification:', err));

          continue;
        }

        if (proximityRatio <= 0.3) {
          const alert = await insertAlert({
            userId,
            scanResultId: result.id,
            message: `${result.symbol} approaching ${result.direction === 'buy' ? 'buy' : 'sell'} zone — price is near entry at ${currentPrice.toFixed(decimals)}`,
            type: 'warning',
          });
          alerts.push(alert);
        }

        const isInvalidated = result.direction === 'buy'
          ? currentPrice < result.stopLoss
          : currentPrice > result.stopLoss;

        if (isInvalidated) {
          await updateScanResult(result.id, { status: 'invalidated' });

          const alert = await insertAlert({
            userId,
            scanResultId: result.id,
            message: `${result.symbol} setup invalidated — price broke through stop loss level before entry`,
            type: 'warning',
          });
          alerts.push(alert);

          continue;
        }
      }

      if (result.status === 'triggered') {
        const hitTakeProfit = result.direction === 'buy'
          ? currentPrice >= result.takeProfit
          : currentPrice <= result.takeProfit;

        const hitStopLoss = result.direction === 'buy'
          ? currentPrice <= result.stopLoss
          : currentPrice >= result.stopLoss;

        if (hitTakeProfit || hitStopLoss) {
          const closeReason: ScanCloseReason = hitTakeProfit ? 'tp' : 'sl';
          await updateScanResult(result.id, {
            status: 'closed',
            closeReason,
            closedAt: new Date().toISOString(),
          });

          const alert = await insertAlert({
            userId,
            scanResultId: result.id,
            message: hitTakeProfit
              ? `${result.symbol} trade closed in profit — take profit hit at ${currentPrice.toFixed(decimals)}`
              : `${result.symbol} trade closed at stop loss — SL hit at ${currentPrice.toFixed(decimals)}`,
            type: hitTakeProfit ? 'trade' : 'warning',
          });
          alerts.push(alert);

          sendPushToUser(userId, {
            title: hitTakeProfit ? 'Take Profit Hit' : 'Stop Loss Hit',
            body: hitTakeProfit
              ? `${result.symbol} closed in profit.`
              : `${result.symbol} closed at stop loss.`,
            tag: `closed-${result.id}`,
            url: '/dashboard/scanner',
          }).catch((err) => console.error('[Push] Failed to send closure notification:', err));
        }
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
