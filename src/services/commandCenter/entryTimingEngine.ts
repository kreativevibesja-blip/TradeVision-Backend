import type { TradeInput, MarketData, TimingResult } from './types';
import { getIndicatorSnapshot } from './indicators';

export function getEntryTiming(trade: TradeInput, market: MarketData): TimingResult {
  const { ema20, atr } = getIndicatorSnapshot(market.candles);
  const price = market.currentPrice;
  const conditions: string[] = [];
  let message: string;
  let candlesEstimate: string;

  if (ema20 == null || atr === 0) {
    return {
      message: 'Insufficient data for timing estimate',
      candlesEstimate: '-',
      conditions: [],
    };
  }

  const distanceToEma20 = Math.abs(price - ema20);
  const emaRatio = distanceToEma20 / atr;

  if (trade.direction === 'buy') {
    if (price > ema20 && emaRatio > 1) {
      message = 'Wait for pullback to EMA 20';
      candlesEstimate = '2-4';
      conditions.push('Touch or approach EMA 20', 'Bullish engulfing or pin bar');
    } else if (price > ema20 && emaRatio <= 1) {
      message = 'Price close to EMA 20 — watch for bounce';
      candlesEstimate = '1-2';
      conditions.push('Bullish rejection at EMA 20');
    } else if (price <= ema20) {
      message = 'Price at or below EMA 20 — ready on bullish confirmation';
      candlesEstimate = '0-1';
      conditions.push('Bullish engulfing', 'Break of recent swing high');
    } else {
      message = 'Monitor for entry setup';
      candlesEstimate = '1-3';
      conditions.push('Wait for structure confirmation');
    }
  } else {
    if (price < ema20 && emaRatio > 1) {
      message = 'Wait for rally back to EMA 20';
      candlesEstimate = '2-4';
      conditions.push('Touch or approach EMA 20', 'Bearish engulfing or shooting star');
    } else if (price < ema20 && emaRatio <= 1) {
      message = 'Price close to EMA 20 — watch for rejection';
      candlesEstimate = '1-2';
      conditions.push('Bearish rejection at EMA 20');
    } else if (price >= ema20) {
      message = 'Price at or above EMA 20 — ready on bearish confirmation';
      candlesEstimate = '0-1';
      conditions.push('Bearish engulfing', 'Break of recent swing low');
    } else {
      message = 'Monitor for entry setup';
      candlesEstimate = '1-3';
      conditions.push('Wait for structure confirmation');
    }
  }

  const distanceToEntry = Math.abs(price - trade.entry);
  const entryRatio = distanceToEntry / atr;
  if (entryRatio < 0.3) {
    conditions.push('Price very close to entry level');
  }

  return { message, candlesEstimate, conditions };
}
