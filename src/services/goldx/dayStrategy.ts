import { clamp, computePullbackRatio, detectBearishSequence, detectBullishSequence, roundPrice, scoreConfidence } from './indicators';
import type { StrategyCandidate, StrategyContext, StrategyEvaluation } from './strategyModels';

function buildCandidate(direction: 'buy' | 'sell', ctx: StrategyContext): StrategyCandidate | null {
  const { snapshot, config, regime } = ctx;
  const trendAligned = direction === 'buy'
    ? snapshot.current.close > snapshot.ema20 && regime.bullishTrend
    : snapshot.current.close < snapshot.ema20 && regime.bearishTrend;
  const sequence = direction === 'buy'
    ? detectBullishSequence(snapshot.candles, 4)
    : detectBearishSequence(snapshot.candles, 4);
  const pullbackRatio = computePullbackRatio(snapshot.candles, direction, 10);
  const pullbackValid = pullbackRatio != null
    && pullbackRatio >= config.dayPullbackMinPct
    && pullbackRatio <= config.dayPullbackMaxPct;
  const spreadOk = snapshot.spread <= config.dayMaxSpreadPoints;

  if (!trendAligned || sequence < 2 || !pullbackValid || !spreadOk) {
    return null;
  }

  const confidence = scoreConfidence({
    trendStrength: regime.trendStrength,
    spread: snapshot.spread,
    spreadLimit: config.dayMaxSpreadPoints,
    atr: snapshot.atr,
    averageRange: snapshot.averageRange,
    confirmations: sequence,
    extra: 10,
  });

  if (confidence < config.confidenceThreshold) {
    return null;
  }

  const entry = direction === 'buy' ? snapshot.ask : snapshot.bid;
  const tpDistance = clamp(Math.max(snapshot.atr * 0.45, config.dayTpMin), config.dayTpMin, config.dayTpMax);
  const slDistance = clamp(Math.max(snapshot.atr * 1.15, config.daySlMin), config.daySlMin, config.daySlMax);
  const stopLoss = direction === 'buy' ? entry - slDistance : entry + slDistance;
  const takeProfit = direction === 'buy' ? entry + tpDistance : entry - tpDistance;
  const entriesCount = clamp(3 + Math.floor(Math.max(0, confidence - config.confidenceThreshold) / 10), 3, 5);

  return {
    action: direction,
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    confidence,
    reason: direction === 'buy'
      ? 'Day scalp buy: bullish sequence with measured pullback above EMA20'
      : 'Day scalp sell: bearish sequence with measured pullback below EMA20',
    strategyName: 'day-momentum-pullback',
    trend: true,
    rangeDetected: false,
    spread: snapshot.spread,
    atr: snapshot.atr,
    trendAligned,
    sweepDetected: false,
    bosConfirmed: sequence >= 3,
    entriesCount,
    debug: {
      sequence,
      pullbackRatio,
      spread: snapshot.spread,
      trendStrength: regime.trendStrength,
    },
  };
}

export function generateDaySignal(ctx: StrategyContext): StrategyEvaluation {
  const buyCandidate = buildCandidate('buy', ctx);
  const sellCandidate = buildCandidate('sell', ctx);
  const candidate = [buyCandidate, sellCandidate]
    .filter((value): value is StrategyCandidate => value !== null)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;

  return {
    candidate,
    reason: candidate?.reason ?? 'Day strategy rejected: missing momentum sequence, pullback, or spread confirmation',
    debug: {
      spread: ctx.snapshot.spread,
      ema20: ctx.snapshot.ema20,
      ema50: ctx.snapshot.ema50,
      trendStrength: ctx.regime.trendStrength,
    },
  };
}
