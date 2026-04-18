import { calculateEmaSeries, type EmaInputCandle } from '../../lib/indicators/ema';
import type { CommandCenterCandle } from './types';

export interface AtrResult {
  atr: number;
  ema20: number | null;
  ema50: number | null;
}

const ATR_PERIOD = 14;

export function calculateAtr(candles: CommandCenterCandle[]): number {
  if (candles.length < 2) return 0;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }

  const period = Math.min(ATR_PERIOD, trs.length);
  if (period === 0) return 0;

  const slice = trs.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

export function getIndicatorSnapshot(candles: CommandCenterCandle[]): AtrResult {
  const emaCandles: EmaInputCandle[] = candles.map((c) => ({ time: c.time, close: c.close }));
  const ema20Series = calculateEmaSeries(emaCandles, 20);
  const ema50Series = calculateEmaSeries(emaCandles, 50);

  return {
    atr: calculateAtr(candles),
    ema20: ema20Series[ema20Series.length - 1]?.value ?? null,
    ema50: ema50Series[ema50Series.length - 1]?.value ?? null,
  };
}
