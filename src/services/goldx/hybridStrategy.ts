import { generateDaySignal } from './dayStrategy';
import { generateNightSignal } from './nightStrategy';
import type { StrategyCandidate, StrategyContext, StrategyEvaluation } from './strategyModels';

export function combineSignals(...evaluations: StrategyEvaluation[]): StrategyEvaluation {
  const bestCandidate = evaluations
    .map((evaluation) => evaluation.candidate)
    .filter((candidate): candidate is StrategyCandidate => candidate !== null)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;

  if (bestCandidate) {
    return {
      candidate: bestCandidate,
      reason: bestCandidate.reason,
      debug: bestCandidate.debug,
    };
  }

  return evaluations.find((evaluation) => evaluation.reason)?.candidate
    ? evaluations[0]
    : {
        candidate: null,
        reason: evaluations.map((evaluation) => evaluation.reason).filter(Boolean).join(' | ') || 'No strategy candidate available',
        debug: Object.assign({}, ...evaluations.map((evaluation) => evaluation.debug)),
      };
}

export function generateHybridSignal(ctx: StrategyContext): StrategyEvaluation {
  if (ctx.session === 'day') {
    return generateDaySignal(ctx);
  }
  if (ctx.session === 'night') {
    return generateNightSignal(ctx);
  }
  return {
    candidate: null,
    reason: 'Hybrid strategy inactive: no eligible trading session is open',
    debug: { session: ctx.session },
  };
}

export function generateUnifiedSignal(ctx: StrategyContext): StrategyEvaluation {
  const dayEvaluation = ctx.regime.trending ? generateDaySignal(ctx) : {
    candidate: null,
    reason: 'Unified strategy skipped day logic: market is not trending',
    debug: { trending: ctx.regime.trending, trendStrength: ctx.regime.trendStrength },
  };

  const nightEvaluation = ctx.regime.ranging ? generateNightSignal(ctx) : {
    candidate: null,
    reason: 'Unified strategy skipped night logic: market is not ranging',
    debug: { ranging: ctx.regime.ranging, rangeCompression: ctx.regime.rangeCompression },
  };

  if (!ctx.regime.trending && !ctx.regime.ranging) {
    return generateHybridSignal(ctx);
  }

  return combineSignals(dayEvaluation, nightEvaluation);
}
