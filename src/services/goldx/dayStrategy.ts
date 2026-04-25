import { clamp, computePullbackRatio, detectBearishSequence, detectBullishSequence, roundPrice, scoreConfidence } from './indicators';
import type { StrategyCandidate, StrategyContext, StrategyEvaluation } from './strategyModels';

function buildCandidate(direction: 'buy' | 'sell', ctx: StrategyContext): StrategyCandidate | null {
  const { snapshot, config, regime } = ctx;
  const current = snapshot.current;
  const previous = snapshot.previous;
  const trendAligned = direction === 'buy'
    ? snapshot.current.close > snapshot.ema20 && regime.bullishTrend
    : snapshot.current.close < snapshot.ema20 && regime.bearishTrend;
  const sequence = direction === 'buy'
    ? detectBullishSequence(snapshot.candles, 4)
    : detectBearishSequence(snapshot.candles, 4);
  const pullbackRatio = computePullbackRatio(snapshot.candles, direction, 10);
  const relaxedPullbackMin = Math.max(0.12, config.dayPullbackMinPct * 0.5);
  const relaxedPullbackMax = Math.min(0.72, config.dayPullbackMaxPct + 0.18);
  const pullbackValid = pullbackRatio != null
    && pullbackRatio >= relaxedPullbackMin
    && pullbackRatio <= relaxedPullbackMax;
  const spreadOk = snapshot.spread <= config.dayMaxSpreadPoints;
  const pullbackResumeValid = Boolean(previous)
    && trendAligned
    && spreadOk
    && pullbackValid
    && regime.trendStrength >= 0.3
    && (direction === 'buy'
      ? current.close > current.open
        && current.close >= snapshot.ema20
        && current.close >= previous!.high - snapshot.atr * 0.05
      : current.close < current.open
        && current.close <= snapshot.ema20
        && current.close <= previous!.low + snapshot.atr * 0.05);
  const continuationValid = trendAligned
    && spreadOk
    && regime.trendStrength >= 0.35
    && sequence >= 1
    && (direction === 'buy'
      ? snapshot.current.close >= snapshot.ema20 && snapshot.current.close >= snapshot.previous?.close!
      : snapshot.current.close <= snapshot.ema20 && snapshot.current.close <= snapshot.previous?.close!);

  const setupValid = (sequence >= 2 && pullbackValid) || continuationValid || pullbackResumeValid;

  if (!trendAligned || !spreadOk || !setupValid) {
    return null;
  }

  const confidence = scoreConfidence({
    trendStrength: regime.trendStrength,
    spread: snapshot.spread,
    spreadLimit: config.dayMaxSpreadPoints,
    atr: snapshot.atr,
    averageRange: snapshot.averageRange,
    confirmations: sequence,
    extra: pullbackResumeValid ? 14 : pullbackValid ? 12 : 8,
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
      ? pullbackValid
        ? 'Day scalp buy: bullish sequence with measured pullback above EMA20'
        : pullbackResumeValid
          ? 'Day scalp buy: bullish pullback resumption aligned with EMA trend'
          : 'Day scalp buy: bullish continuation aligned with EMA trend'
      : pullbackValid
        ? 'Day scalp sell: bearish sequence with measured pullback below EMA20'
        : pullbackResumeValid
          ? 'Day scalp sell: bearish pullback resumption aligned with EMA trend'
          : 'Day scalp sell: bearish continuation aligned with EMA trend',
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
      pullbackValid,
      pullbackResumeValid,
      continuationValid,
      relaxedPullbackMin,
      relaxedPullbackMax,
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
    reason: candidate?.reason ?? (() => {
      const buySequence = detectBullishSequence(ctx.snapshot.candles, 4);
      const sellSequence = detectBearishSequence(ctx.snapshot.candles, 4);
      const buyPullback = computePullbackRatio(ctx.snapshot.candles, 'buy', 10);
      const sellPullback = computePullbackRatio(ctx.snapshot.candles, 'sell', 10);
      const relaxedPullbackMin = Math.max(0.12, ctx.config.dayPullbackMinPct * 0.5);
      const relaxedPullbackMax = Math.min(0.72, ctx.config.dayPullbackMaxPct + 0.18);
      const spreadOk = ctx.snapshot.spread <= ctx.config.dayMaxSpreadPoints;

      return `Day strategy rejected: trend buy=${ctx.regime.bullishTrend} sell=${ctx.regime.bearishTrend} sequence buy=${buySequence} sell=${sellSequence} pullback buy=${buyPullback?.toFixed(2) ?? 'null'} sell=${sellPullback?.toFixed(2) ?? 'null'} pullbackBand=${relaxedPullbackMin.toFixed(2)}-${relaxedPullbackMax.toFixed(2)} spread=${ctx.snapshot.spread.toFixed(2)} spreadOk=${spreadOk}`;
    })(),
    debug: {
      spread: ctx.snapshot.spread,
      ema20: ctx.snapshot.ema20,
      ema50: ctx.snapshot.ema50,
      trendStrength: ctx.regime.trendStrength,
    },
  };
}
