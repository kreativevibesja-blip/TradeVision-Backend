export type InstantSignalAssetClass = 'forex' | 'deriv';
export type InstantSignalDirection = 'buy' | 'sell' | 'none';
export type InstantSignalStatus = 'entry_now' | 'no_signal';

export interface InstantSignalCandle {
  time?: number;
  timestamp?: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface InstantSignalEngineInput {
  market: string;
  assetClass: InstantSignalAssetClass;
  timeframe: string;
  candles: InstantSignalCandle[];
  currentPrice?: number | null;
}

export interface InstantSignalEngineOutput {
  market: string;
  assetClass: InstantSignalAssetClass;
  timeframe: string;
  direction: InstantSignalDirection;
  status: InstantSignalStatus;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  confidence: number;
  confirmationRequired: number;
  confirmationText: string | null;
  expiresAt: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundToMarket = (value: number, reference: number) => {
  const abs = Math.abs(reference);
  const decimals = abs >= 1000 ? 2 : abs >= 10 ? 3 : 5;
  return Number(value.toFixed(decimals));
};

const sma = (values: number[]) => values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1);

const getExpiryMinutes = (assetClass: InstantSignalAssetClass, timeframe: string) => {
  if (assetClass === 'deriv' && (timeframe === '1m' || timeframe === '5m')) {
    return 30;
  }

  return 90;
};

const isBullish = (candle: InstantSignalCandle) => candle.close > candle.open;
const isBearish = (candle: InstantSignalCandle) => candle.close < candle.open;
const bodySize = (candle: InstantSignalCandle) => Math.abs(candle.close - candle.open);
const rangeSize = (candle: InstantSignalCandle) => Math.max(candle.high - candle.low, Number.EPSILON);

export function generateInstantSignal(input: InstantSignalEngineInput): InstantSignalEngineOutput {
  const candles = input.candles
    .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
    .slice(-160);

  const last = candles[candles.length - 1];
  const currentPrice = Number.isFinite(input.currentPrice ?? NaN) ? Number(input.currentPrice) : last?.close;
  const noSignal = (confidence = 45, confirmationText = 'No clean signal on the visible chart.'): InstantSignalEngineOutput => ({
    market: input.market,
    assetClass: input.assetClass,
    timeframe: input.timeframe,
    direction: 'none',
    status: 'no_signal',
    entry: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: null,
    confidence,
    confirmationRequired: 0,
    confirmationText,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  });

  if (candles.length < 30 || !last || !Number.isFinite(currentPrice)) {
    return noSignal(35, 'Not enough visible candles to produce an actionable signal.');
  }

  const closes = candles.map((candle) => candle.close);
  const recent = candles.slice(-20);
  const previous = candles.slice(-60, -20);
  const recentHigh = Math.max(...recent.map((candle) => candle.high));
  const recentLow = Math.min(...recent.map((candle) => candle.low));
  const previousHigh = previous.length ? Math.max(...previous.map((candle) => candle.high)) : recentHigh;
  const previousLow = previous.length ? Math.min(...previous.map((candle) => candle.low)) : recentLow;
  const averageRange = sma(recent.map(rangeSize));
  const bodyRatio = bodySize(last) / rangeSize(last);
  const shortSma = sma(closes.slice(-8));
  const longSma = sma(closes.slice(-24));
  const trendUp = shortSma > longSma;
  const trendDown = shortSma < longSma;
  const sweptLow = last.low < previousLow && last.close > previousLow;
  const sweptHigh = last.high > previousHigh && last.close < previousHigh;
  const bullishReaction = isBullish(last) && bodyRatio >= 0.45;
  const bearishReaction = isBearish(last) && bodyRatio >= 0.45;
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const closePosition = (last.close - last.low) / rangeSize(last);
  const rejectionBuy = lowerWick >= bodySize(last) * 0.65 && closePosition >= 0.58 && last.low <= recentLow + averageRange * 0.45;
  const rejectionSell = upperWick >= bodySize(last) * 0.65 && closePosition <= 0.42 && last.high >= recentHigh - averageRange * 0.45;
  const nearLow = Math.abs(currentPrice - recentLow) <= averageRange * 1.4;
  const nearHigh = Math.abs(currentPrice - recentHigh) <= averageRange * 1.4;
  const momentumUp = closes.at(-1)! > closes.at(-2)! && closes.at(-2)! >= closes.at(-3)!;
  const momentumDown = closes.at(-1)! < closes.at(-2)! && closes.at(-2)! <= closes.at(-3)!;
  const choppy = averageRange <= 0 || Math.abs(shortSma - longSma) < averageRange * 0.18;
  const recentBearishCount = recent.filter(isBearish).length;
  const recentBullishCount = recent.filter(isBullish).length;
  const hasTwoSidedAuction = recentBearishCount >= 3 && recentBullishCount >= 3;
  const hasBuyStructure = hasTwoSidedAuction && nearLow && (sweptLow || rejectionBuy) && bullishReaction;
  const hasSellStructure = hasTwoSidedAuction && nearHigh && (sweptHigh || rejectionSell) && bearishReaction;

  const buyScore =
    (trendUp ? 18 : 0) +
    (sweptLow ? 22 : 0) +
    (rejectionBuy ? 18 : 0) +
    (nearLow ? 12 : 0) +
    (bullishReaction ? 18 : 0) +
    (momentumUp ? 12 : 0) +
    (last.close > shortSma ? 8 : 0) -
    (sweptHigh ? 18 : 0) -
    (choppy ? 12 : 0);

  const sellScore =
    (trendDown ? 18 : 0) +
    (sweptHigh ? 22 : 0) +
    (rejectionSell ? 18 : 0) +
    (nearHigh ? 12 : 0) +
    (bearishReaction ? 18 : 0) +
    (momentumDown ? 12 : 0) +
    (last.close < shortSma ? 8 : 0) -
    (sweptLow ? 18 : 0) -
    (choppy ? 12 : 0);

  const direction: InstantSignalDirection = buyScore >= sellScore ? 'buy' : 'sell';
  const score = direction === 'buy' ? buyScore : sellScore;
  const validStructure = direction === 'buy' ? hasBuyStructure : hasSellStructure;
  const contradiction = direction === 'buy' ? trendDown && sweptHigh : trendUp && sweptLow;
  const stopDistance = Math.max(averageRange * 1.35, Math.abs(currentPrice - (direction === 'buy' ? recentLow : recentHigh)) + averageRange * 0.25);
  const entry = roundToMarket(currentPrice, currentPrice);
  const stopLoss = roundToMarket(direction === 'buy' ? currentPrice - stopDistance : currentPrice + stopDistance, currentPrice);
  const takeProfit = roundToMarket(direction === 'buy' ? currentPrice + stopDistance * 2 : currentPrice - stopDistance * 2, currentPrice);
  const riskReward = Number((Math.abs(takeProfit - entry) / Math.max(Math.abs(entry - stopLoss), Number.EPSILON)).toFixed(2));
  const confidence = clamp(Math.round(52 + score * 0.55 + (riskReward >= 1.8 ? 8 : 0)), 35, 92);

  if (contradiction || riskReward < 1.5 || confidence < 65 || choppy || !validStructure) {
    return noSignal(
      clamp(confidence, 35, 64),
      !validStructure
        ? 'No valid rejection structure at a clean level.'
        : choppy
          ? 'Market is too choppy for a clean instant signal.'
          : 'Risk reward or directional confluence is not clean enough.',
    );
  }

  const entryNow = confidence >= 70 && validStructure;
  if (!entryNow) {
    return noSignal(clamp(confidence, 35, 69), 'No immediate entry signal from the current rejection structure.');
  }

  const expiresAt = new Date(Date.now() + getExpiryMinutes(input.assetClass, input.timeframe) * 60 * 1000).toISOString();

  return {
    market: input.market,
    assetClass: input.assetClass,
    timeframe: input.timeframe,
    direction,
    status: 'entry_now',
    entry,
    stopLoss,
    takeProfit,
    riskReward,
    confidence,
    confirmationRequired: 0,
    confirmationText: direction === 'buy'
      ? 'Enter now: bullish rejection from a valid demand/liquidity level.'
      : 'Enter now: bearish rejection from a valid supply/liquidity level.',
    expiresAt,
  };
}
