import { analyzeEmaTrend, calculateEmaSeries } from '../../lib/indicators/ema';
import { getSession, type DetectedSession } from '../../utils/sessionDetector';
import type { Candle, TradeConfirmations, MarketRegime } from '../scannerEngine';

export type GoldScalperRejectionReason =
  | 'invalid_session'
  | 'unsupported_symbol'
  | 'insufficient_m1_candles'
  | 'insufficient_m5_candles'
  | 'context_trend_missing'
  | 'pullback_missing'
  | 'low_confirmation_count'
  | 'missing_required_confirmation_combo'
  | 'score_too_low'
  | 'spread_too_high'
  | 'chop_detected'
  | 'sl_too_tight';

export interface GoldScalperConfig {
  maxSpread: number;
  minRiskReward: number;
}

export interface GoldScalperSignal {
  symbol: 'XAUUSD';
  type: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  confidence: number;
  strategy: 'gold_scalper';
  session: DetectedSession;
  rejectionReason: null;
  confirmations: TradeConfirmations;
  score: number;
  marketRegime: MarketRegime;
}

export interface GoldScalperRejection {
  symbol: 'XAUUSD';
  strategy: 'gold_scalper';
  session: DetectedSession;
  rejectionReason: GoldScalperRejectionReason;
  confidence: number;
  score: number;
  confirmations: TradeConfirmations;
}

export type GoldScalperResult = GoldScalperSignal | GoldScalperRejection;

const DEFAULT_CONFIG: GoldScalperConfig = {
  maxSpread: 0.6,
  minRiskReward: 2,
};

function emptyConfirmations(): TradeConfirmations {
  return {
    liquiditySweep: false,
    engulfing: false,
    rejection: false,
    bos: false,
    poiReclaim: false,
    emaAligned: false,
    zoneReaction: false,
    displacement: false,
    momentum: false,
    edgeBase: false,
    breakerBlock: false,
    fvgReaction: false,
    equalLevelSweep: false,
    premiumDiscount: false,
    ote: false,
    mss: false,
  };
}

function averageRange(candles: Candle[], lookback: number): number {
  const recent = candles.slice(-Math.min(lookback, candles.length));
  if (recent.length === 0) return 0;
  return recent.reduce((sum, candle) => sum + Math.abs(candle.high - candle.low), 0) / recent.length;
}

function computeAtr(candles: Candle[], period: number): number {
  if (candles.length < period + 1) {
    return averageRange(candles, Math.min(period, candles.length));
  }

  const recent = candles.slice(-(period + 1));
  let total = 0;

  for (let index = 1; index < recent.length; index++) {
    const candle = recent[index];
    const previous = recent[index - 1];
    total += Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  }

  return total / period;
}

function detectLiquiditySweep(candles: Candle[]): 'buy' | 'sell' | null {
  if (candles.length < 6) return null;
  const current = candles[candles.length - 1];
  const window = candles.slice(-6, -1);
  const priorHigh = Math.max(...window.map((candle) => candle.high));
  const priorLow = Math.min(...window.map((candle) => candle.low));

  if (current.low < priorLow && current.close > priorLow) return 'buy';
  if (current.high > priorHigh && current.close < priorHigh) return 'sell';
  return null;
}

function detectRejection(candle: Candle): 'buy' | 'sell' | null {
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, 0.0001);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);

  if (lowerWick >= body * 1.3 && lowerWick / range >= 0.4 && candle.close > candle.open) return 'buy';
  if (upperWick >= body * 1.3 && upperWick / range >= 0.4 && candle.close < candle.open) return 'sell';
  return null;
}

function detectEngulfing(candles: Candle[]): 'buy' | 'sell' | null {
  if (candles.length < 2) return null;
  const previous = candles[candles.length - 2];
  const current = candles[candles.length - 1];

  if (
    previous.close < previous.open &&
    current.close > current.open &&
    current.open <= previous.close &&
    current.close >= previous.open
  ) {
    return 'buy';
  }

  if (
    previous.close > previous.open &&
    current.close < current.open &&
    current.open >= previous.close &&
    current.close <= previous.open
  ) {
    return 'sell';
  }

  return null;
}

function detectMicroBos(candles: Candle[]): 'buy' | 'sell' | null {
  if (candles.length < 8) return null;
  const recent = candles.slice(-8);
  const current = recent[recent.length - 1];
  const prior = recent.slice(0, -1);
  const swingHigh = Math.max(...prior.map((candle) => candle.high));
  const swingLow = Math.min(...prior.map((candle) => candle.low));

  if (current.close > swingHigh) return 'buy';
  if (current.close < swingLow) return 'sell';
  return null;
}

function detectDisplacement(candles: Candle[]): 'buy' | 'sell' | null {
  if (candles.length < 2) return null;
  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const avgRange = Math.max(averageRange(candles, 10), 0.0001);
  const body = Math.abs(current.close - current.open);

  if (body < avgRange * 1.15) return null;
  if (current.close > current.open && current.close > previous.high) return 'buy';
  if (current.close < current.open && current.close < previous.low) return 'sell';
  return null;
}

function detectChop(m1Candles: Candle[], m5Candles: Candle[]): boolean {
  const m5Trend = analyzeEmaTrend(m5Candles);
  const ema200Series = calculateEmaSeries(m5Candles, 200);
  const ema50Series = calculateEmaSeries(m5Candles, 50);
  const recentM1 = m1Candles.slice(-10);

  const ema200Slope = Math.abs((ema200Series[ema200Series.length - 1]?.value ?? 0) - (ema200Series[Math.max(0, ema200Series.length - 4)]?.value ?? 0));
  const m5Atr = Math.max(computeAtr(m5Candles, 14), 0.0001);
  const flat200 = ema200Slope <= m5Atr * 0.08;

  let ema50Crosses = 0;
  for (let index = 1; index < Math.min(recentM1.length, ema50Series.length); index++) {
    const ema50 = ema50Series[ema50Series.length - Math.min(recentM1.length, ema50Series.length) + index]?.value;
    const previousEma50 = ema50Series[ema50Series.length - Math.min(recentM1.length, ema50Series.length) + index - 1]?.value;
    const current = recentM1[index];
    const previous = recentM1[index - 1];
    if (ema50 == null || previousEma50 == null) continue;

    const previousDelta = previous.close - previousEma50;
    const currentDelta = current.close - ema50;
    if ((previousDelta <= 0 && currentDelta > 0) || (previousDelta >= 0 && currentDelta < 0)) {
      ema50Crosses++;
    }
  }

  const directionalCandles = recentM1.reduce((score, candle) => score + Math.sign(candle.close - candle.open), 0);
  const noClearDirection = Math.abs(directionalCandles) <= 2;

  return m5Trend.trend === 'ranging' || flat200 || ema50Crosses >= 4 || noClearDirection;
}

function getRecentStructureTarget(candles: Candle[], direction: 'buy' | 'sell'): number | null {
  const recent = candles.slice(-20);
  if (recent.length === 0) return null;
  return direction === 'buy'
    ? Math.max(...recent.map((candle) => candle.high))
    : Math.min(...recent.map((candle) => candle.low));
}

function buildSignal(
  direction: 'buy' | 'sell',
  session: DetectedSession,
  m1Candles: Candle[],
  m5Candles: Candle[],
  config: GoldScalperConfig,
): GoldScalperResult {
  const confirmations = emptyConfirmations();
  const lastM1 = m1Candles[m1Candles.length - 1];
  const m5Trend = analyzeEmaTrend(m5Candles);
  const ema20 = m5Trend.ema20;
  const ema50 = m5Trend.ema50;
  const ema200 = m5Trend.ema200;

  if (ema20 == null || ema50 == null || ema200 == null) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'context_trend_missing', confidence: 0, score: 0, confirmations };
  }

  const inTrend = direction === 'buy'
    ? lastM1.close > ema200 && ema20 >= ema50
    : lastM1.close < ema200 && ema20 <= ema50;

  if (!inTrend) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'context_trend_missing', confidence: 0, score: 0, confirmations };
  }

  confirmations.emaAligned = true;

  const pullbackToZone = direction === 'buy'
    ? lastM1.low <= Math.max(ema20, ema50) && lastM1.close >= Math.min(ema20, ema50)
    : lastM1.high >= Math.min(ema20, ema50) && lastM1.close <= Math.max(ema20, ema50);

  if (!pullbackToZone) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'pullback_missing', confidence: 0, score: 1, confirmations };
  }

  confirmations.zoneReaction = true;

  const sweep = detectLiquiditySweep(m1Candles);
  const rejection = detectRejection(lastM1);
  const engulfing = detectEngulfing(m1Candles);
  const bos = detectMicroBos(m1Candles);
  const displacement = detectDisplacement(m1Candles);

  confirmations.liquiditySweep = sweep === direction;
  confirmations.rejection = rejection === direction;
  confirmations.engulfing = engulfing === direction;
  confirmations.bos = bos === direction;
  confirmations.displacement = displacement === direction;
  confirmations.momentum = confirmations.displacement;
  confirmations.edgeBase = confirmations.liquiditySweep || confirmations.bos;
  confirmations.poiReclaim = pullbackToZone;
  confirmations.mss = confirmations.bos;

  const confirmationCount = [
    confirmations.liquiditySweep,
    confirmations.rejection,
    confirmations.engulfing,
    confirmations.bos,
    confirmations.displacement,
  ].filter(Boolean).length;

  if (confirmationCount < 3) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'low_confirmation_count', confidence: confirmationCount * 10, score: confirmationCount, confirmations };
  }

  const hasRequiredCombo = (confirmations.bos || confirmations.engulfing) && (confirmations.rejection || confirmations.displacement);
  if (!hasRequiredCombo) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'missing_required_confirmation_combo', confidence: confirmationCount * 12, score: confirmationCount + 1, confirmations };
  }

  const atr = Math.max(computeAtr(m1Candles, 14), 0.1);
  const recentSwing = direction === 'buy'
    ? Math.min(...m1Candles.slice(-10).map((candle) => candle.low))
    : Math.max(...m1Candles.slice(-10).map((candle) => candle.high));
  const sweepAnchor = sweep === 'buy'
    ? Math.min(lastM1.low, recentSwing)
    : sweep === 'sell'
      ? Math.max(lastM1.high, recentSwing)
      : recentSwing;

  const sl = direction === 'buy'
    ? sweepAnchor - atr * 1.2
    : sweepAnchor + atr * 1.2;
  const slDistance = Math.abs(lastM1.close - sl);

  if (slDistance < atr * 0.75) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'sl_too_tight', confidence: confirmationCount * 12, score: confirmationCount + 2, confirmations };
  }

  const structureTarget = getRecentStructureTarget(m5Candles, direction);
  const minTp = direction === 'buy'
    ? lastM1.close + slDistance * config.minRiskReward
    : lastM1.close - slDistance * config.minRiskReward;
  let tp = structureTarget ?? minTp;
  if (direction === 'buy') tp = Math.max(tp, minTp);
  else tp = Math.min(tp, minTp);

  const score = 2
    + confirmationCount
    + Number(confirmations.emaAligned)
    + Number(confirmations.zoneReaction)
    + Number(hasRequiredCombo);

  if (score < 6) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'score_too_low', confidence: score * 10, score, confirmations };
  }

  return {
    symbol: 'XAUUSD',
    type: direction,
    entry: lastM1.close,
    sl,
    tp,
    confidence: Math.min(98, 55 + score * 6 + confirmationCount * 3),
    strategy: 'gold_scalper',
    session,
    rejectionReason: null,
    confirmations,
    score,
    marketRegime: 'trend',
  };
}

export function analyzeGoldScalper(
  symbol: string,
  m1Candles: Candle[],
  m5Candles: Candle[],
  options?: {
    spread?: number;
    now?: Date;
    config?: Partial<GoldScalperConfig>;
  },
): GoldScalperResult {
  const session = getSession(options?.now);
  const config = { ...DEFAULT_CONFIG, ...(options?.config ?? {}) };
  const confirmations = emptyConfirmations();

  if (symbol !== 'XAUUSD') {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'unsupported_symbol', confidence: 0, score: 0, confirmations };
  }

  if (session === 'low_activity') {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'invalid_session', confidence: 0, score: 0, confirmations };
  }

  if (session !== 'london_killzone' && session !== 'newyork_killzone') {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'invalid_session', confidence: 0, score: 0, confirmations };
  }

  if (m1Candles.length < 50) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'insufficient_m1_candles', confidence: 0, score: 0, confirmations };
  }

  if (m5Candles.length < 30) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'insufficient_m5_candles', confidence: 0, score: 0, confirmations };
  }

  if ((options?.spread ?? 0) > config.maxSpread) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'spread_too_high', confidence: 0, score: 0, confirmations };
  }

  if (detectChop(m1Candles, m5Candles)) {
    return { symbol: 'XAUUSD', strategy: 'gold_scalper', session, rejectionReason: 'chop_detected', confidence: 0, score: 0, confirmations };
  }

  const bullish = buildSignal('buy', session, m1Candles, m5Candles, config);
  const bearish = buildSignal('sell', session, m1Candles, m5Candles, config);

  const candidates = [bullish, bearish].filter((result): result is GoldScalperSignal => result.rejectionReason === null);
  if (candidates.length === 0) {
    const rejections = [bullish, bearish] as GoldScalperRejection[];
    return rejections.sort((left, right) => right.score - left.score || right.confidence - left.confidence)[0];
  }

  return candidates.sort((left, right) => right.score - left.score || right.confidence - left.confidence)[0];
}
