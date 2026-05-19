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
type SignalStatus = 'active' | 'running_profit' | 'tp_hit' | 'sl_hit' | 'expired';
type SignalGrade = 'A+' | 'A' | 'B+';
type SnapshotTone = 'bullish' | 'bearish' | 'neutral';

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
  reason: string;
  setupLabel: string;
  executionNote: string;
  currentPrice: number;
  rrRatio: number;
  grade: SignalGrade;
  status: SignalStatus;
  confluences: string[];
  quality: {
    structure: number;
    liquidity: number;
    fvg: number;
    session: number;
    trend: number;
    volatility: number;
    rr: number;
  };
  snapshot: {
    candles: SignalCandle[];
    annotations: Array<{
      label: string;
      candleTime: number;
      price: number;
      tone: SnapshotTone;
    }>;
    zones: Array<{
      label: string;
      top: number;
      bottom: number;
      tone: 'entry' | 'risk' | 'target' | 'demand' | 'supply' | 'value';
    }>;
  };
}

export interface SignalScanTarget {
  symbol: string;
  symbolLabel?: string;
  assetClass?: string;
}

export interface ActiveMarketSignal {
  key: string;
  source: SignalSource;
  assetClass: string;
  session: SignalSession;
  direction: SignalDirection;
  symbol: string;
  symbolLabel: string;
  timeframe: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  candleTime: number;
  reason: string;
  executionNote: string;
  setupLabel: string;
  currentPrice: number;
  rrRatio: number;
  grade: SignalGrade;
  status: SignalStatus;
  confluences: string[];
  quality: {
    structure: number;
    liquidity: number;
    fvg: number;
    session: number;
    trend: number;
    volatility: number;
    rr: number;
  };
  snapshot: {
    candles: SignalCandle[];
    annotations: Array<{
      label: string;
      candleTime: number;
      price: number;
      tone: SnapshotTone;
    }>;
    zones: Array<{
      label: string;
      top: number;
      bottom: number;
      tone: 'entry' | 'risk' | 'target' | 'demand' | 'supply' | 'value';
    }>;
  };
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

const round = (value: number, decimals = 4) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const average = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

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

const findSwingHigh = (candles: SignalCandle[], index: number, strength = 2) => {
  if (index <= strength || index >= candles.length - strength) {
    return false;
  }

  const current = candles[index];
  for (let offset = 1; offset <= strength; offset += 1) {
    if (candles[index - offset].high >= current.high || candles[index + offset].high > current.high) {
      return false;
    }
  }

  return true;
};

const findSwingLow = (candles: SignalCandle[], index: number, strength = 2) => {
  if (index <= strength || index >= candles.length - strength) {
    return false;
  }

  const current = candles[index];
  for (let offset = 1; offset <= strength; offset += 1) {
    if (candles[index - offset].low <= current.low || candles[index + offset].low < current.low) {
      return false;
    }
  }

  return true;
};

const findPreviousSwing = (
  candles: SignalCandle[],
  index: number,
  direction: 'high' | 'low',
  strength = 2,
) => {
  for (let cursor = index - strength - 1; cursor >= strength; cursor -= 1) {
    if (direction === 'high' ? findSwingHigh(candles, cursor, strength) : findSwingLow(candles, cursor, strength)) {
      return candles[cursor];
    }
  }

  return null;
};

const scoreToBucket = (value: number) => Math.round(clamp(value, 0, 100));

const getSessionBoost = (session: SignalSession) => {
  if (session === 'london') {
    return 100;
  }

  if (session === 'newyork') {
    return 96;
  }

  return 88;
};

const resolveSignalStatus = (
  direction: SignalDirection,
  currentPrice: number,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  ageSeconds: number,
  expirySeconds: number,
): SignalStatus => {
  if (direction === 'buy') {
    if (currentPrice >= takeProfit) return 'tp_hit';
    if (currentPrice <= stopLoss) return 'sl_hit';
    if (ageSeconds >= expirySeconds) return 'expired';
    if (currentPrice >= entry + (takeProfit - entry) * 0.35) return 'running_profit';
    return 'active';
  }

  if (currentPrice <= takeProfit) return 'tp_hit';
  if (currentPrice >= stopLoss) return 'sl_hit';
  if (ageSeconds >= expirySeconds) return 'expired';
  if (currentPrice <= entry - (entry - takeProfit) * 0.35) return 'running_profit';
  return 'active';
};

const getGrade = (confidence: number): SignalGrade | null => {
  if (confidence >= 92) return 'A+';
  if (confidence >= 85) return 'A';
  if (confidence >= 78) return 'B+';
  return null;
};

const getMarketStructureRange = (candles: SignalCandle[], index: number, lookback = 24) => {
  const window = candles.slice(Math.max(0, index - lookback), index + 1);
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  return {
    high,
    low,
    midpoint: low + (high - low) / 2,
  };
};

const getDecimalsForSymbol = (price: number) => {
  if (Math.abs(price) >= 1000) return 2;
  if (Math.abs(price) >= 10) return 3;
  if (Math.abs(price) >= 1) return 4;
  return 5;
};

const createSnapshot = (
  candles: SignalCandle[],
  signalIndex: number,
  direction: SignalDirection,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  rangeTop: number,
  rangeBottom: number,
  liquidityPrice: number,
  bosPrice: number,
  chochPrice: number,
  fvgTop: number,
  fvgBottom: number,
) => {
  const snapshotCandles = candles.slice(Math.max(0, signalIndex - 24), signalIndex + 8).map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));

  return {
    candles: snapshotCandles,
    annotations: [
      { label: 'BOS', candleTime: candles[signalIndex].time, price: bosPrice, tone: direction === 'buy' ? 'bullish' : 'bearish' as SnapshotTone },
      { label: 'CHOCH', candleTime: candles[Math.max(signalIndex - 2, 0)].time, price: chochPrice, tone: 'neutral' as SnapshotTone },
      { label: 'SWEEP', candleTime: candles[Math.max(signalIndex - 1, 0)].time, price: liquidityPrice, tone: direction === 'buy' ? 'bullish' : 'bearish' as SnapshotTone },
      { label: 'FVG', candleTime: candles[signalIndex].time, price: direction === 'buy' ? fvgBottom : fvgTop, tone: direction === 'buy' ? 'bullish' : 'bearish' as SnapshotTone },
      { label: direction === 'buy' ? 'DEMAND' : 'SUPPLY', candleTime: candles[Math.max(signalIndex - 1, 0)].time, price: direction === 'buy' ? rangeBottom : rangeTop, tone: direction === 'buy' ? 'bullish' : 'bearish' as SnapshotTone },
    ],
    zones: [
      { label: 'ENTRY', top: entry, bottom: entry, tone: 'entry' as const },
      { label: 'SL', top: stopLoss, bottom: stopLoss, tone: 'risk' as const },
      { label: 'TP', top: takeProfit, bottom: takeProfit, tone: 'target' as const },
      { label: direction === 'buy' ? 'FVG' : 'FVG', top: fvgTop, bottom: fvgBottom, tone: 'value' as const },
      {
        label: direction === 'buy' ? 'DEMAND' : 'SUPPLY',
        top: rangeTop,
        bottom: rangeBottom,
        tone: direction === 'buy' ? 'demand' as const : 'supply' as const,
      },
    ],
  };
};

const buildSignalsFromCandles = (source: SignalSource, symbol: string, timeframe: string, candles: SignalCandle[]) => {
  if (candles.length < 220) {
    return [] as SessionSignal[];
  }

  const ema50ByTime = new Map(calculateEmaSeries(candles, 50).map((point) => [point.time, point.value]));
  const ema200ByTime = new Map(calculateEmaSeries(candles, 200).map((point) => [point.time, point.value]));
  const latestTime = candles[candles.length - 1]?.time ?? 0;
  const latestClose = candles[candles.length - 1]?.close ?? 0;
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

    const rangeWindow = candles.slice(Math.max(0, index - 18), index + 1);
    const zoneWindow = candles.slice(Math.max(0, index - 10), index + 1);
    const avgRange = average(rangeWindow.map((item) => Math.max(item.high - item.low, Number.EPSILON)));
    const range = Math.max(candle.high - candle.low, Number.EPSILON);
    const bodySize = Math.abs(candle.close - candle.open);
    const bodyRatio = bodySize / range;
    const topEma = Math.max(ema50, ema200);
    const bottomEma = Math.min(ema50, ema200);
    const crossDistance = Math.abs(ema50 - ema200);
    const emaSlopeStrength = ((ema50 - prevEma50) + (ema200 - prevEma200)) / Math.max(avgRange, Number.EPSILON);
    const bearishSlopeStrength = ((prevEma50 - ema50) + (prevEma200 - ema200)) / Math.max(avgRange, Number.EPSILON);

    const marketRange = getMarketStructureRange(candles, index, 24);
    const previousSwingHigh = findPreviousSwing(candles, index, 'high');
    const previousSwingLow = findPreviousSwing(candles, index, 'low');

    if (!previousSwingHigh || !previousSwingLow) {
      continue;
    }

    const bullishBos = candle.close > previousSwingHigh.high + avgRange * 0.05;
    const bearishBos = candle.close < previousSwingLow.low - avgRange * 0.05;
    const bullishChoch = previous.close < ema50 && candle.close > ema50;
    const bearishChoch = previous.close > ema50 && candle.close < ema50;
    const recentLows = candles.slice(Math.max(0, index - 8), index).map((item) => item.low);
    const recentHighs = candles.slice(Math.max(0, index - 8), index).map((item) => item.high);
    const bullishSweep = recentLows.length > 0 && candle.low < Math.min(...recentLows) && candle.close > candle.open;
    const bearishSweep = recentHighs.length > 0 && candle.high > Math.max(...recentHighs) && candle.close < candle.open;
    const bullishFvg = index >= 2 && candle.low > candles[index - 2].high && bodySize >= avgRange * 0.7;
    const bearishFvg = index >= 2 && candle.high < candles[index - 2].low && bodySize >= avgRange * 0.7;
    const bullishPremiumDiscount = candle.close <= marketRange.midpoint + avgRange * 0.15;
    const bearishPremiumDiscount = candle.close >= marketRange.midpoint - avgRange * 0.15;
    const bullishTrendAligned = ema50 > ema200 && emaSlopeStrength > 0.04;
    const bearishTrendAligned = ema50 < ema200 && bearishSlopeStrength > 0.04;
    const relativeVolatility = avgRange / Math.max(Math.abs(candle.close), Number.EPSILON);
    const volatilityOkay = relativeVolatility >= 0.0007 && relativeVolatility <= 0.028;
    const session = getSessionForTime(candle.time);

    const bullishSetup = bullishBos && bullishChoch && bullishSweep && bullishFvg && bullishPremiumDiscount && bullishTrendAligned && volatilityOkay;
    const bearishSetup = bearishBos && bearishChoch && bearishSweep && bearishFvg && bearishPremiumDiscount && bearishTrendAligned && volatilityOkay;

    if (!bullishSetup && !bearishSetup) {
      continue;
    }

    const direction: SignalDirection = bullishSetup ? 'buy' : 'sell';
    const zoneTop = direction === 'buy'
      ? Math.max(...zoneWindow.map((item) => Math.max(item.open, item.close)))
      : Math.max(...zoneWindow.map((item) => item.high));
    const zoneBottom = direction === 'buy'
      ? Math.min(...zoneWindow.map((item) => item.low))
      : Math.min(...zoneWindow.map((item) => Math.min(item.open, item.close)));

    const stopBuffer = avgRange * 0.22;
    const entry = candle.close;
    const stopLoss = direction === 'buy'
      ? Math.min(zoneBottom, previousSwingLow.low, bottomEma) - stopBuffer
      : Math.max(zoneTop, previousSwingHigh.high, topEma) + stopBuffer;
    const risk = direction === 'buy' ? entry - stopLoss : stopLoss - entry;

    if (!Number.isFinite(risk) || risk <= avgRange * 0.35 || risk >= avgRange * 6) {
      continue;
    }

    const targetLiquidity = direction === 'buy'
      ? Math.max(...candles.slice(index, Math.min(candles.length, index + 18)).map((item) => item.high), entry + risk * 2.3)
      : Math.min(...candles.slice(index, Math.min(candles.length, index + 18)).map((item) => item.low), entry - risk * 2.3);
    const takeProfit = direction === 'buy'
      ? Math.max(entry + risk * 2.2, targetLiquidity)
      : Math.min(entry - risk * 2.2, targetLiquidity);
    const rrRatio = Math.abs((takeProfit - entry) / Math.max(risk, Number.EPSILON));
    const quality = {
      structure: scoreToBucket(72 + bodyRatio * 18 + (direction === 'buy' ? (bullishBos ? 10 : 0) + (bullishChoch ? 8 : 0) : (bearishBos ? 10 : 0) + (bearishChoch ? 8 : 0))),
      liquidity: scoreToBucket(70 + (direction === 'buy' ? (bullishSweep ? 16 : 0) : (bearishSweep ? 16 : 0)) + clamp((crossDistance / Math.max(avgRange, Number.EPSILON)) * 4, 0, 10)),
      fvg: scoreToBucket(68 + (direction === 'buy' ? (bullishFvg ? 18 : 0) : (bearishFvg ? 18 : 0)) + bodyRatio * 10),
      session: getSessionBoost(session),
      trend: scoreToBucket(72 + clamp((direction === 'buy' ? emaSlopeStrength : bearishSlopeStrength) * 18, 0, 14) + (direction === 'buy' ? (bullishTrendAligned ? 10 : 0) : (bearishTrendAligned ? 10 : 0))),
      volatility: scoreToBucket(volatilityOkay ? 86 + clamp((1 - Math.abs(relativeVolatility - 0.006) / 0.01) * 10, 0, 10) : 60),
      rr: scoreToBucket(72 + clamp(rrRatio * 10, 0, 24)),
    };
    const weightedConfidence = Math.round(
      clamp(
        quality.structure * 0.22 +
        quality.liquidity * 0.14 +
        quality.fvg * 0.14 +
        quality.session * 0.1 +
        quality.trend * 0.16 +
        quality.volatility * 0.08 +
        quality.rr * 0.16,
        65,
        98,
      ),
    );
    const grade = getGrade(weightedConfidence);

    if (!grade || rrRatio < 2) {
      continue;
    }

    const ageSeconds = latestTime - candle.time;
    const status = resolveSignalStatus(direction, latestClose, entry, stopLoss, takeProfit, ageSeconds, Math.max(6 * (latestTime - previous.time), 12 * 60 * 60));
    const fvgTop = direction === 'buy' ? candle.low : candles[index - 2].low;
    const fvgBottom = direction === 'buy' ? candles[index - 2].high : candle.high;
    const sweepPrice = direction === 'buy' ? candle.low : candle.high;
    const bosPrice = direction === 'buy' ? previousSwingHigh.high : previousSwingLow.low;
    const chochPrice = direction === 'buy' ? ema50 : ema50;
    const confluences = [
      'BOS',
      'CHOCH',
      'Liquidity sweep',
      direction === 'buy' ? 'Discount array' : 'Premium array',
      'FVG displacement',
      direction === 'buy' ? 'Fresh demand' : 'Fresh supply',
      'HTF trend alignment',
      `${session === 'newyork' ? 'New York' : session === 'london' ? 'London' : 'Asian'} session confirmation`,
      'Volatility filter',
      'RR filter',
    ];
    const decimals = getDecimalsForSymbol(entry);
    const snapshot = createSnapshot(
      candles,
      index,
      direction,
      round(entry, decimals),
      round(stopLoss, decimals),
      round(takeProfit, decimals),
      round(zoneTop, decimals),
      round(zoneBottom, decimals),
      round(sweepPrice, decimals),
      round(bosPrice, decimals),
      round(chochPrice, decimals),
      round(Math.max(fvgTop, fvgBottom), decimals),
      round(Math.min(fvgTop, fvgBottom), decimals),
    );

    candidates.push({
      key: `${source}:${symbol}:${timeframe}:${session}:${direction}:${candle.time}`,
      session,
      direction,
      entry: round(entry, decimals),
      stopLoss: round(stopLoss, decimals),
      takeProfit: round(takeProfit, decimals),
      confidence: weightedConfidence,
      candleTime: candle.time,
      reason: direction === 'buy'
        ? 'Liquidity was swept beneath discount, structure shifted higher, and displacement left a clean fair-value gap into demand.'
        : 'Liquidity was swept above premium, structure shifted lower, and displacement left a clean fair-value gap into supply.',
      setupLabel: direction === 'buy' ? 'SMC continuation displacement' : 'SMC reversal displacement',
      executionNote: direction === 'buy'
        ? 'Execute on the active entry while demand and imbalance remain intact under session momentum.'
        : 'Execute on the active entry while supply and imbalance remain intact under session momentum.',
      currentPrice: round(latestClose, decimals),
      rrRatio: round(rrRatio, 2),
      grade,
      status,
      confluences,
      quality,
      snapshot,
    });
  }

  const freshCandidates = candidates.filter((signal) => latestTime - signal.candleTime <= DAILY_SIGNAL_WINDOW_SECONDS);
  return freshCandidates
    .sort((left, right) => {
      if (left.confidence !== right.confidence) {
        return right.confidence - left.confidence;
      }

      return right.candleTime - left.candleTime;
    })
    .slice(0, 2);
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

export async function scanSignalsMarket(source: SignalSource, timeframe: string, targets: SignalScanTarget[]) {
  const trimmedTargets = targets
    .map((target) => ({
      symbol: typeof target.symbol === 'string' ? target.symbol.trim() : '',
      symbolLabel: typeof target.symbolLabel === 'string' ? target.symbolLabel.trim() : '',
      assetClass: typeof target.assetClass === 'string' ? target.assetClass.trim() : '',
    }))
    .filter((target) => target.symbol.length > 0);

  const timeframeSeconds = source === 'deriv'
    ? DERIV_TIMEFRAME_GRANULARITY[timeframe] ?? 900
    : TRADINGVIEW_TIMEFRAME_SECONDS[timeframe] ?? 900;

  const freshnessWindow = Math.max(timeframeSeconds * 2, 12 * 60);
  const nowSeconds = Math.floor(Date.now() / 1000);

  const settled = await Promise.allSettled(
    trimmedTargets.map(async (target) => {
      const candles = await fetchCandlesForWatchlist({
        userId: 'scan',
        source,
        symbol: target.symbol,
        timeframe,
        enabled: true,
      });

      return buildSignalsFromCandles(source, target.symbol, timeframe, candles)
        .filter((signal) => nowSeconds - signal.candleTime <= freshnessWindow)
        .map((signal) => ({
          key: signal.key,
          source,
          assetClass: target.assetClass || 'Unclassified',
          session: signal.session,
          direction: signal.direction,
          symbol: target.symbol,
          symbolLabel: target.symbolLabel || target.symbol,
          timeframe,
          entry: signal.entry,
          stopLoss: signal.stopLoss,
          takeProfit: signal.takeProfit,
          confidence: signal.confidence,
          candleTime: signal.candleTime,
          reason: signal.reason,
          executionNote: signal.executionNote,
          setupLabel: signal.setupLabel,
          currentPrice: signal.currentPrice,
          rrRatio: signal.rrRatio,
          grade: signal.grade,
          status: signal.status,
          confluences: signal.confluences,
          quality: signal.quality,
          snapshot: signal.snapshot,
        } satisfies ActiveMarketSignal));
    }),
  );

  return settled
    .flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    .sort((left, right) => {
      const gradePriority: Record<SignalGrade, number> = { 'A+': 3, A: 2, 'B+': 1 };
      if (gradePriority[left.grade] !== gradePriority[right.grade]) {
        return gradePriority[right.grade] - gradePriority[left.grade];
      }

      if (left.candleTime !== right.candleTime) {
        return right.candleTime - left.candleTime;
      }

      return right.confidence - left.confidence;
    })
    .slice(0, 16);
}

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
      title: `${watchlist.symbolLabel ?? watchlist.symbol} ${signal.direction.toUpperCase()} ${signal.grade}`,
      body: `${signal.session.toUpperCase()} · ${watchlist.timeframe} · ${signal.confidence}% confidence · Entry ${signal.entry} · TP ${signal.takeProfit}`,
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
