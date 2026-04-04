export interface EmaInputCandle {
  time: number;
  close: number;
}

export type EmaTrendBias = 'bullish' | 'bearish' | 'ranging';

export interface EmaPoint {
  time: number;
  value: number;
}

export interface EmaTrendContext {
  ema50: number | null;
  ema200: number | null;
  trend: EmaTrendBias;
}

export function calculateEmaSeries<T extends EmaInputCandle>(candles: T[], period: number): EmaPoint[] {
  if (period <= 0 || candles.length < period) {
    return [];
  }

  const smoothing = 2 / (period + 1);
  const seed = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const points: EmaPoint[] = [{ time: candles[period - 1].time, value: seed }];

  let ema = seed;
  for (let index = period; index < candles.length; index++) {
    ema = (candles[index].close - ema) * smoothing + ema;
    points.push({ time: candles[index].time, value: ema });
  }

  return points;
}

export function analyzeEmaTrend<T extends EmaInputCandle>(candles: T[]): EmaTrendContext {
  const ema50Series = calculateEmaSeries(candles, 50);
  const ema200Series = calculateEmaSeries(candles, 200);
  const ema50 = ema50Series[ema50Series.length - 1]?.value ?? null;
  const ema200 = ema200Series[ema200Series.length - 1]?.value ?? null;

  if (ema50 == null || ema200 == null || candles.length === 0) {
    return { ema50, ema200, trend: 'ranging' };
  }

  const close = candles[candles.length - 1].close;
  const ema50Reference = ema50Series[Math.max(0, ema50Series.length - 5)]?.value ?? ema50;
  const ema200Reference = ema200Series[Math.max(0, ema200Series.length - 5)]?.value ?? ema200;
  const ema50Rising = ema50 >= ema50Reference;
  const ema200Rising = ema200 >= ema200Reference;

  if (close > ema50 && ema50 > ema200 && ema50Rising && ema200Rising) {
    return { ema50, ema200, trend: 'bullish' };
  }

  if (close < ema50 && ema50 < ema200 && !ema50Rising && !ema200Rising) {
    return { ema50, ema200, trend: 'bearish' };
  }

  return { ema50, ema200, trend: 'ranging' };
}

export function isEmaDirectionAligned(direction: 'buy' | 'sell', emaTrend: EmaTrendContext): boolean {
  return (direction === 'buy' && emaTrend.trend === 'bullish') || (direction === 'sell' && emaTrend.trend === 'bearish');
}