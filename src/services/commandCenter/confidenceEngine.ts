import { analyzeEmaTrend, isEmaDirectionAligned, type EmaInputCandle } from '../../lib/indicators/ema';
import { getSession } from '../../utils/sessionDetector';
import type { TradeInput, MarketData, ConfidenceResult, ConfidenceReason } from './types';
import { calculateAtr } from './indicators';

export function getConfidence(trade: TradeInput, market: MarketData): ConfidenceResult {
  const reasons: ConfidenceReason[] = [];
  let score = 0;

  const emaCandles: EmaInputCandle[] = market.candles.map((c) => ({ time: c.time, close: c.close }));
  const emaTrend = analyzeEmaTrend(emaCandles);
  const trendAligned = isEmaDirectionAligned(trade.direction, emaTrend);
  reasons.push({ label: 'Trend aligned', status: trendAligned });
  if (trendAligned) score += 2;

  const hasLiquiditySweep = trade.liquidity?.sweep === 'above highs' || trade.liquidity?.sweep === 'below lows';
  reasons.push({ label: 'Liquidity sweep', status: hasLiquiditySweep });
  if (hasLiquiditySweep) score += 2;

  const recentCandles = market.candles.slice(-5);
  const avgBody = recentCandles.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / (recentCandles.length || 1);
  const atr = calculateAtr(market.candles);
  const displacementStrong = atr > 0 && avgBody / atr > 0.5;
  reasons.push({ label: 'Displacement present', status: displacementStrong });
  if (displacementStrong) score += 2;

  const session = getSession();
  const goodSession = session === 'london_killzone' || session === 'newyork_killzone';
  reasons.push({ label: 'Active session timing', status: goodSession });
  if (goodSession) score += 1.5;

  const volatilityOk = atr > 0;
  const isVolatile = recentCandles.length > 0
    && recentCandles.some((c) => (c.high - c.low) > atr * 1.5);
  const volatilityHealthy = volatilityOk && !isVolatile;
  reasons.push({ label: 'Healthy volatility', status: volatilityHealthy });
  if (volatilityHealthy) score += 1.5;

  const hasMomentum = recentCandles.length >= 3 && (() => {
    const last3 = recentCandles.slice(-3);
    if (trade.direction === 'buy') {
      return last3.every((c) => c.close > c.open);
    }
    return last3.every((c) => c.close < c.open);
  })();
  reasons.push({ label: 'Momentum in direction', status: hasMomentum });
  if (hasMomentum) score += 1;

  return {
    score: Math.round(Math.min(10, Math.max(0, score)) * 10) / 10,
    reasons,
  };
}
