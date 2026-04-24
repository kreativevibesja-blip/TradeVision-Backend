import { clamp, detectLiquiditySweep, detectRange, roundPrice, scoreConfidence } from './indicators';
import type { StrategyCandidate, StrategyContext, StrategyEvaluation } from './strategyModels';

export function generateNightSignal(ctx: StrategyContext): StrategyEvaluation {
  const { snapshot, config, regime } = ctx;
  const range = detectRange(snapshot);
  const sweep = detectLiquiditySweep(snapshot, range, config.nightSweepAtrBuffer);
  const spreadOk = snapshot.spread <= config.nightMaxSpreadPoints;
  const atrTight = snapshot.averageRange > 0 && snapshot.atr <= snapshot.averageRange * 1.1;

  if (!range.detected || !sweep.detected || !sweep.direction || !spreadOk || !atrTight) {
    return {
      candidate: null,
      reason: 'Night strategy rejected: range, sweep, spread, or ATR filter not satisfied',
      debug: {
        rangeDetected: range.detected,
        sweepDetected: sweep.detected,
        spread: snapshot.spread,
        atr: snapshot.atr,
        averageRange: snapshot.averageRange,
      },
    };
  }

  const direction = sweep.direction;
  const entry = direction === 'buy' ? snapshot.ask : snapshot.bid;
  const meanTarget = direction === 'buy'
    ? Math.max(range.mid, snapshot.vwap)
    : Math.min(range.mid, snapshot.vwap);
  const fallbackTpDistance = clamp(snapshot.atr * 0.32, config.nightTpMin, config.nightTpMax);
  const takeProfit = direction === 'buy'
    ? Math.max(meanTarget, entry + fallbackTpDistance)
    : Math.min(meanTarget, entry - fallbackTpDistance);
  const stopBuffer = clamp(snapshot.atr * 0.45, config.nightSlMin, config.nightSlMax);
  const stopLoss = direction === 'buy'
    ? sweep.extreme - stopBuffer
    : sweep.extreme + stopBuffer;

  const confidence = scoreConfidence({
    trendStrength: regime.trendStrength * 0.6,
    spread: snapshot.spread,
    spreadLimit: config.nightMaxSpreadPoints,
    atr: snapshot.atr,
    averageRange: snapshot.averageRange,
    confirmations: sweep.depthRatio >= 0.2 ? 3 : 2,
    extra: range.detected ? 12 : 0,
  });

  if (confidence < config.confidenceThreshold) {
    return {
      candidate: null,
      reason: 'Night strategy rejected: confidence below threshold after sweep confirmation',
      debug: {
        confidence,
        depthRatio: sweep.depthRatio,
      },
    };
  }

  const candidate: StrategyCandidate = {
    action: direction,
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    confidence,
    reason: direction === 'buy'
      ? 'Night scalp buy: liquidity sweep below range low with re-entry back into range'
      : 'Night scalp sell: liquidity sweep above range high with re-entry back into range',
    strategyName: 'night-range-sweep',
    trend: false,
    rangeDetected: true,
    spread: snapshot.spread,
    atr: snapshot.atr,
    trendAligned: direction === 'buy' ? snapshot.current.close >= snapshot.ema20 : snapshot.current.close <= snapshot.ema20,
    sweepDetected: true,
    bosConfirmed: true,
    entriesCount: clamp(2 + Math.floor(Math.max(0, confidence - config.confidenceThreshold) / 12), 2, 4),
    lotMultiplier: 0.7,
    debug: {
      rangeHigh: range.high,
      rangeLow: range.low,
      rangeMid: range.mid,
      sweepSource: sweep.source,
      sweepDepthRatio: sweep.depthRatio,
      vwap: snapshot.vwap,
    },
  };

  return {
    candidate,
    reason: candidate.reason,
    debug: candidate.debug,
  };
}
