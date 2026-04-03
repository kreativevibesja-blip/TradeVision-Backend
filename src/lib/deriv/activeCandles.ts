import type { DerivedCandle } from './candles';

export interface ActiveCandleState extends DerivedCandle {
  bucketStart: number;
}

const activeCandles = new Map<string, ActiveCandleState>();

function buildKey(symbol: string, timeframeSeconds: number) {
  return `${symbol}:${timeframeSeconds}`;
}

export function getActiveCandle(symbol: string, timeframeSeconds: number) {
  return activeCandles.get(buildKey(symbol, timeframeSeconds));
}

export function setActiveCandle(symbol: string, timeframeSeconds: number, candle: ActiveCandleState) {
  activeCandles.set(buildKey(symbol, timeframeSeconds), candle);
}

export function clearActiveCandle(symbol: string, timeframeSeconds: number) {
  activeCandles.delete(buildKey(symbol, timeframeSeconds));
}