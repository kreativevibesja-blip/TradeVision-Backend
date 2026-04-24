export type StrategyDirection = 'buy' | 'sell';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketSnapshot {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  atr: number;
  ema20: number;
  ema50: number;
  vwap: number;
  averageRange: number;
  candles: Candle[];
  current: Candle;
  previous: Candle | null;
}

export interface MarketRegime {
  trending: boolean;
  ranging: boolean;
  bullishTrend: boolean;
  bearishTrend: boolean;
  trendStrength: number;
  rangeCompression: number;
}

export interface RangeDetection {
  detected: boolean;
  high: number;
  low: number;
  mid: number;
  width: number;
}

export interface LiquiditySweep {
  detected: boolean;
  direction: StrategyDirection | null;
  extreme: number;
  reentryLevel: number;
  depthRatio: number;
  source: 'current' | 'previous' | 'none';
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundLot(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

export function floorLot(value: number): number {
  return Math.floor(value * 100) / 100;
}

export function getRecentAverageRange(candles: Candle[], count = 20): number {
  const window = candles.slice(-count);
  if (!window.length) return 0;
  return window.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / window.length;
}

export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

export function calculateEMA(candles: Candle[], period: number): number {
  if (!candles.length) return 0;
  const multiplier = 2 / (period + 1);
  let ema = candles[0].close;
  for (let index = 1; index < candles.length; index += 1) {
    ema = (candles[index].close - ema) * multiplier + ema;
  }
  return ema;
}

export function calculateVWAP(candles: Candle[], count = 20): number {
  const window = candles.slice(-count);
  if (!window.length) return 0;
  let numerator = 0;
  let denominator = 0;
  for (const candle of window) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    const volume = Math.max(candle.volume, 1);
    numerator += typicalPrice * volume;
    denominator += volume;
  }
  return denominator > 0 ? numerator / denominator : window[window.length - 1]?.close ?? 0;
}

export function buildSnapshot(candles: Candle[], bid: number, ask: number): MarketSnapshot {
  const current = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : null;
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    spread: (ask - bid) * 10,
    atr: calculateATR(candles),
    ema20: calculateEMA(candles, 20),
    ema50: calculateEMA(candles, 50),
    vwap: calculateVWAP(candles),
    averageRange: getRecentAverageRange(candles, 20),
    candles,
    current,
    previous,
  };
}

export function getCandleBody(candle: Candle | null | undefined): number {
  if (!candle) return 0;
  return Math.abs(candle.close - candle.open);
}

export function detectBullishSequence(candles: Candle[], depth = 4): number {
  const recent = candles.slice(-depth);
  let count = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candle = recent[index];
    const previous = index > 0 ? recent[index - 1] : null;
    const bullish = candle.close > candle.open;
    const advancing = previous ? candle.close >= previous.close : true;
    if (!bullish || !advancing) break;
    count += 1;
  }
  return count;
}

export function detectBearishSequence(candles: Candle[], depth = 4): number {
  const recent = candles.slice(-depth);
  let count = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const candle = recent[index];
    const previous = index > 0 ? recent[index - 1] : null;
    const bearish = candle.close < candle.open;
    const declining = previous ? candle.close <= previous.close : true;
    if (!bearish || !declining) break;
    count += 1;
  }
  return count;
}

export function computePullbackRatio(candles: Candle[], direction: StrategyDirection, lookback = 10): number | null {
  const recent = candles.slice(-lookback);
  if (recent.length < 4) return null;
  const swingHigh = Math.max(...recent.map((candle) => candle.high));
  const swingLow = Math.min(...recent.map((candle) => candle.low));
  const range = swingHigh - swingLow;
  if (range <= 0) return null;
  const currentClose = recent[recent.length - 1].close;
  if (direction === 'buy') {
    return (swingHigh - currentClose) / range;
  }
  return (currentClose - swingLow) / range;
}

export function detectRange(snapshot: MarketSnapshot, lookback = 12): RangeDetection {
  const recent = snapshot.candles.slice(-lookback);
  if (!recent.length) {
    return { detected: false, high: snapshot.current.high, low: snapshot.current.low, mid: snapshot.mid, width: 0 };
  }
  const high = Math.max(...recent.map((candle) => candle.high));
  const low = Math.min(...recent.map((candle) => candle.low));
  const width = high - low;
  const mid = (high + low) / 2;
  const detected = width > 0 && width <= Math.max(snapshot.atr * 3.2, snapshot.averageRange * 1.15);
  return { detected, high, low, mid, width };
}

export function detectLiquiditySweep(snapshot: MarketSnapshot, range: RangeDetection, atrBuffer: number): LiquiditySweep {
  const candidates: Array<{ candle: Candle; source: 'current' | 'previous' }> = [
    { candle: snapshot.current, source: 'current' },
  ];
  if (snapshot.previous) {
    candidates.push({ candle: snapshot.previous, source: 'previous' });
  }

  const buffer = Math.max(snapshot.atr * atrBuffer, 0.4);
  for (const candidate of candidates) {
    if (candidate.candle.high > range.high + buffer && candidate.candle.close < range.high) {
      return {
        detected: true,
        direction: 'sell',
        extreme: candidate.candle.high,
        reentryLevel: range.high,
        depthRatio: (candidate.candle.high - range.high) / Math.max(snapshot.atr, 0.01),
        source: candidate.source,
      };
    }
    if (candidate.candle.low < range.low - buffer && candidate.candle.close > range.low) {
      return {
        detected: true,
        direction: 'buy',
        extreme: candidate.candle.low,
        reentryLevel: range.low,
        depthRatio: (range.low - candidate.candle.low) / Math.max(snapshot.atr, 0.01),
        source: candidate.source,
      };
    }
  }

  return {
    detected: false,
    direction: null,
    extreme: 0,
    reentryLevel: 0,
    depthRatio: 0,
    source: 'none',
  };
}

export function analyzeMarketRegime(snapshot: MarketSnapshot): MarketRegime {
  const recent = snapshot.candles.slice(-6);
  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;

  for (let index = 1; index < recent.length; index += 1) {
    if (recent[index].high > recent[index - 1].high) higherHighs += 1;
    if (recent[index].low > recent[index - 1].low) higherLows += 1;
    if (recent[index].high < recent[index - 1].high) lowerHighs += 1;
    if (recent[index].low < recent[index - 1].low) lowerLows += 1;
  }

  const trendStrength = Math.abs(snapshot.ema20 - snapshot.ema50) / Math.max(snapshot.atr, 0.01);
  const bullishTrend = snapshot.current.close > snapshot.ema20 && snapshot.ema20 > snapshot.ema50 && higherHighs >= 2 && higherLows >= 2;
  const bearishTrend = snapshot.current.close < snapshot.ema20 && snapshot.ema20 < snapshot.ema50 && lowerHighs >= 2 && lowerLows >= 2;
  const trending = trendStrength >= 0.2 && (bullishTrend || bearishTrend);
  const rangeCompression = detectRange(snapshot).width / Math.max(snapshot.atr, 0.01);
  const ranging = !trending && rangeCompression <= 3.5;

  return {
    trending,
    ranging,
    bullishTrend,
    bearishTrend,
    trendStrength,
    rangeCompression,
  };
}

export function scoreConfidence(args: {
  trendStrength: number;
  spread: number;
  spreadLimit: number;
  atr: number;
  averageRange: number;
  confirmations: number;
  extra?: number;
}): number {
  const spreadScore = clamp(1 - args.spread / Math.max(args.spreadLimit, 0.01), 0, 1) * 18;
  const trendScore = clamp(args.trendStrength, 0, 2) / 2 * 24;
  const volatilityRatio = args.averageRange > 0 ? args.atr / args.averageRange : 1;
  const volatilityScore = clamp(1.2 - Math.abs(0.9 - volatilityRatio), 0, 1.2) / 1.2 * 18;
  const confirmationScore = clamp(args.confirmations, 0, 4) / 4 * 20;
  const extra = args.extra ?? 0;
  return clamp(Math.round(20 + spreadScore + trendScore + volatilityScore + confirmationScore + extra), 0, 100);
}
