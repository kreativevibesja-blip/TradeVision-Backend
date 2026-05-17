import {
  getSystemSetting,
  getUserById,
  hasPaidSubscription,
  hasTopTierAccess,
  listSystemSettingsByPrefix,
  upsertSystemSetting,
  type SubscriptionTier,
} from '../lib/supabase';
import { fetchMarketDataForLiveChart, isSupportedLiveChartTimeframe, resolveLiveChartSymbol } from './marketData';
import { getDerivHistoryCandles } from '../lib/deriv/ws';
import { sendPushToUser } from './pushService';

type SignalSource = 'deriv' | 'tradingview';
type SignalSession = 'asian' | 'london' | 'newyork';
type SignalDirection = 'buy' | 'sell';

interface SignalCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SessionSignal {
  key: string;
  session: SignalSession;
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  candleTime: number;
}

interface SignalsWatchlistSetting {
  userId: string;
  source: SignalSource;
  symbol: string;
  timeframe: string;
  enabled?: boolean;
  symbolLabel?: string;
  assetClass?: string;
  syncedAt?: string;
  lastCheckedAt?: string;
  lastDispatchedKeys?: Partial<Record<SignalSession, string>>;
}

const SIGNALS_WATCHLIST_PREFIX = 'signals:watchlist:';
const MONITOR_INTERVAL_MS = 3 * 60_000;
const HISTORY_LOOKBACK_SECONDS = 36 * 60 * 60;
const DAILY_SIGNAL_WINDOW_SECONDS = 24 * 60 * 60;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

const DERIV_TIMEFRAME_GRANULARITY: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

const TRADINGVIEW_TIMEFRAME_SECONDS: Record<string, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const getNewYorkHour = (unixSeconds: number) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(new Date(unixSeconds * 1000));

  return parseInt(parts.find((part) => part.type === 'hour')?.value ?? '0', 10) % 24;
};

const getSessionForTime = (unixSeconds: number): SignalSession => {
  const hour = getNewYorkHour(unixSeconds);

  if (hour >= 19 || hour < 2) {
    return 'asian';
  }

  if (hour >= 2 && hour < 11) {
    return 'london';
  }

  return 'newyork';
};

const calculateEmaSeries = (candles: SignalCandle[], period: number) => {
  if (period <= 0 || candles.length < period) {
    return [] as Array<{ time: number; value: number }>;
  }

  const smoothing = 2 / (period + 1);
  const seed = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const points = [{ time: candles[period - 1].time, value: seed }];

  let ema = seed;
  for (let index = period; index < candles.length; index += 1) {
    ema = (candles[index].close - ema) * smoothing + ema;
    points.push({ time: candles[index].time, value: ema });
  }

  return points;
};

const buildSignalsFromCandles = (source: SignalSource, symbol: string, timeframe: string, candles: SignalCandle[]) => {
  if (candles.length < 220) {
    return [] as SessionSignal[];
  }

  const ema50ByTime = new Map(calculateEmaSeries(candles, 50).map((point) => [point.time, point.value]));
  const ema200ByTime = new Map(calculateEmaSeries(candles, 200).map((point) => [point.time, point.value]));
  const latestTime = candles[candles.length - 1]?.time ?? 0;
  const candidates: SessionSignal[] = [];

  for (let index = 200; index < candles.length; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const ema50 = ema50ByTime.get(candle.time);
    const ema200 = ema200ByTime.get(candle.time);
    const prevEma50 = ema50ByTime.get(previous.time);
    const prevEma200 = ema200ByTime.get(previous.time);

    if (ema50 == null || ema200 == null || prevEma50 == null || prevEma200 == null) {
      continue;
    }

    if (latestTime - candle.time > HISTORY_LOOKBACK_SECONDS) {
      continue;
    }

    const rangeWindow = candles.slice(Math.max(0, index - 14), index + 1);
    const zoneWindow = candles.slice(Math.max(0, index - 8), index + 1);
    const avgRange = average(rangeWindow.map((item) => Math.max(item.high - item.low, Number.EPSILON)));
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    const bodySize = Math.abs(candle.close - candle.open);
    const bodyRatio = bodySize / range;
    const topEma = Math.max(ema50, ema200);
    const bottomEma = Math.min(ema50, ema200);
    const crossDistance = Math.abs(ema50 - ema200);
    const emaSlopeStrength = ((ema50 - prevEma50) + (ema200 - prevEma200)) / Math.max(avgRange, Number.EPSILON);
    const bearishSlopeStrength = ((prevEma50 - ema50) + (prevEma200 - ema200)) / Math.max(avgRange, Number.EPSILON);

    const bullishCross =
      ema50 > ema200 &&
      candle.close > topEma &&
      previous.close <= Math.max(prevEma50, prevEma200) &&
      candle.low <= topEma + avgRange * 0.18 &&
      candle.close > candle.open &&
      bodyRatio >= 0.48 &&
      candle.close - topEma <= avgRange * 1.3;

    const bearishCross =
      ema50 < ema200 &&
      candle.close < bottomEma &&
      previous.close >= Math.min(prevEma50, prevEma200) &&
      candle.high >= bottomEma - avgRange * 0.18 &&
      candle.close < candle.open &&
      bodyRatio >= 0.48 &&
      bottomEma - candle.close <= avgRange * 1.3;

    if (!bullishCross && !bearishCross) {
      continue;
    }

    const stopBuffer = avgRange * 0.22;
    const entry = candle.close;
    const stopLoss = bullishCross
      ? Math.min(...zoneWindow.map((item) => item.low), bottomEma) - stopBuffer
      : Math.max(...zoneWindow.map((item) => item.high), topEma) + stopBuffer;
    const risk = bullishCross ? entry - stopLoss : stopLoss - entry;

    if (!Number.isFinite(risk) || risk <= avgRange * 0.35 || risk >= avgRange * 6) {
      continue;
    }

    const direction: SignalDirection = bullishCross ? 'buy' : 'sell';
    const takeProfit = bullishCross ? entry + risk * 2 : entry - risk * 2;
    const confidence = Math.round(
      clamp(
        58 +
          bodyRatio * 18 +
          clamp((crossDistance / Math.max(avgRange, Number.EPSILON)) * 5, 0, 10) +
          clamp((bullishCross ? emaSlopeStrength : bearishSlopeStrength) * 9, 0, 10),
        55,
        96,
      ),
    );
    const session = getSessionForTime(candle.time);

    candidates.push({
      key: `${source}:${symbol}:${timeframe}:${session}:${direction}:${candle.time}`,
      session,
      direction,
      entry,
      stopLoss,
      takeProfit,
      confidence,
      candleTime: candle.time,
    });
  }

  const freshCandidates = candidates.filter((signal) => latestTime - signal.candleTime <= DAILY_SIGNAL_WINDOW_SECONDS);
  const sessionOrder: SignalSession[] = ['asian', 'london', 'newyork'];

  return sessionOrder.flatMap((session) => {
    const topSignal = freshCandidates
      .filter((signal) => signal.session === session)
      .sort((left, right) => {
        if (left.confidence !== right.confidence) {
          return right.confidence - left.confidence;
        }

        return right.candleTime - left.candleTime;
      })[0];

    return topSignal ? [topSignal] : [];
  });
};

const getWatchlistKey = (userId: string, source: SignalSource) => `${SIGNALS_WATCHLIST_PREFIX}${userId}:${source}`;

const getAllowedForSource = (subscription: SubscriptionTier, source: SignalSource) =>
  source === 'deriv' ? hasTopTierAccess(subscription) : hasPaidSubscription(subscription);

const parseWatchlistValue = (value: unknown): SignalsWatchlistSetting | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const source = record.source;
  const symbol = record.symbol;
  const timeframe = record.timeframe;
  const userId = record.userId;

  if ((source !== 'deriv' && source !== 'tradingview') || typeof symbol !== 'string' || typeof timeframe !== 'string' || typeof userId !== 'string') {
    return null;
  }

  return {
    userId,
    source,
    symbol,
    timeframe,
    enabled: record.enabled !== false,
    symbolLabel: typeof record.symbolLabel === 'string' ? record.symbolLabel : undefined,
    assetClass: typeof record.assetClass === 'string' ? record.assetClass : undefined,
    syncedAt: typeof record.syncedAt === 'string' ? record.syncedAt : undefined,
    lastCheckedAt: typeof record.lastCheckedAt === 'string' ? record.lastCheckedAt : undefined,
    lastDispatchedKeys: typeof record.lastDispatchedKeys === 'object' && record.lastDispatchedKeys
      ? (record.lastDispatchedKeys as Partial<Record<SignalSession, string>>)
      : undefined,
  };
};

const fetchCandlesForWatchlist = async (watchlist: SignalsWatchlistSetting) => {
  if (watchlist.source === 'tradingview') {
    if (!isSupportedLiveChartTimeframe(watchlist.timeframe) || !resolveLiveChartSymbol(watchlist.symbol)) {
      throw new Error('Unsupported TradingView watchlist configuration');
    }

    const marketData = await fetchMarketDataForLiveChart(watchlist.symbol, watchlist.timeframe);
    return marketData.candles.map((candle) => ({
      time: Math.floor(new Date(candle.timestamp).getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
  }

  const granularity = DERIV_TIMEFRAME_GRANULARITY[watchlist.timeframe];
  if (!granularity) {
    throw new Error('Unsupported Deriv watchlist timeframe');
  }

  const candles = await getDerivHistoryCandles(watchlist.symbol, granularity, 500);
  return candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
};

const maybeDispatchSignals = async (watchlistKey: string, watchlist: SignalsWatchlistSetting, subscription: SubscriptionTier) => {
  if (!watchlist.enabled || !getAllowedForSource(subscription, watchlist.source)) {
    return;
  }

  const candles = await fetchCandlesForWatchlist(watchlist);
  const signals = buildSignalsFromCandles(watchlist.source, watchlist.symbol, watchlist.timeframe, candles);
  const freshnessWindow = Math.max(
    watchlist.source === 'deriv'
      ? DERIV_TIMEFRAME_GRANULARITY[watchlist.timeframe] ?? 900
      : TRADINGVIEW_TIMEFRAME_SECONDS[watchlist.timeframe] ?? 900,
    900,
  ) * 2;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const nextDispatched = { ...(watchlist.lastDispatchedKeys ?? {}) };

  for (const signal of signals) {
    if (nowSeconds - signal.candleTime > freshnessWindow) {
      continue;
    }

    if (nextDispatched[signal.session] === signal.key) {
      continue;
    }

    await sendPushToUser(watchlist.userId, {
      title: `${watchlist.symbolLabel ?? watchlist.symbol} ${signal.direction.toUpperCase()} signal`,
      body: `${signal.session.toUpperCase()} · ${watchlist.timeframe} · Entry ${signal.entry} · SL ${signal.stopLoss} · TP ${signal.takeProfit}`,
      tag: `signals-monitor:${signal.key}`,
      url: watchlist.source === 'tradingview' ? '/dashboard/tradingview' : '/dashboard/signals',
    });

    nextDispatched[signal.session] = signal.key;
  }

  if (JSON.stringify(nextDispatched) !== JSON.stringify(watchlist.lastDispatchedKeys ?? {})) {
    await upsertSystemSetting(watchlistKey, {
      ...watchlist,
      lastDispatchedKeys: nextDispatched,
      lastCheckedAt: new Date().toISOString(),
    });
    return;
  }

  if (!watchlist.lastCheckedAt || Date.now() - new Date(watchlist.lastCheckedAt).getTime() > MONITOR_INTERVAL_MS * 4) {
    await upsertSystemSetting(watchlistKey, {
      ...watchlist,
      lastCheckedAt: new Date().toISOString(),
    });
  }
};

async function tick() {
  if (running) {
    return;
  }

  running = true;
  try {
    const settings = await listSystemSettingsByPrefix(SIGNALS_WATCHLIST_PREFIX);
    for (const setting of settings) {
      const watchlist = parseWatchlistValue(setting.value);
      if (!watchlist) {
        continue;
      }

      const user = await getUserById(watchlist.userId);
      if (!user) {
        continue;
      }

      try {
        await maybeDispatchSignals(setting.key, watchlist, user.subscription);
      } catch (error) {
        console.error(`[signals-monitor] failed for ${setting.key}:`, error);
      }
    }
  } catch (error) {
    console.error('[signals-monitor] tick failed:', error);
  } finally {
    running = false;
  }
}

export async function getSignalsWatchlist(userId: string, source: SignalSource) {
  const setting = await getSystemSetting(getWatchlistKey(userId, source));
  return parseWatchlistValue(setting?.value ?? null);
}

export async function saveSignalsWatchlist(userId: string, payload: Omit<SignalsWatchlistSetting, 'userId' | 'lastCheckedAt' | 'lastDispatchedKeys'>) {
  const existing = await getSignalsWatchlist(userId, payload.source);
  const nextValue: SignalsWatchlistSetting = {
    userId,
    source: payload.source,
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    enabled: payload.enabled !== false,
    symbolLabel: payload.symbolLabel,
    assetClass: payload.assetClass,
    syncedAt: new Date().toISOString(),
    lastCheckedAt: existing?.lastCheckedAt,
    lastDispatchedKeys: existing?.lastDispatchedKeys ?? {},
  };

  await upsertSystemSetting(getWatchlistKey(userId, payload.source), nextValue);
  return nextValue;
}

export function startSignalsMonitor() {
  if (monitorTimer) {
    return;
  }

  console.log(`[signals-monitor] started (poll every ${MONITOR_INTERVAL_MS}ms)`);
  void tick();
  monitorTimer = setInterval(() => {
    void tick();
  }, MONITOR_INTERVAL_MS);
}
