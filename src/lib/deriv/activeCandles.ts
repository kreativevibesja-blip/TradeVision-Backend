import type { DerivedCandle } from './candles';

export interface ActiveCandleState extends DerivedCandle {
  bucketStart: number;
}

const activeCandles = new Map<string, ActiveCandleState>();
const closedCandles = new Map<string, DerivedCandle[]>();
const MAX_RUNTIME_CANDLES = 2000;

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

export function appendClosedCandle(symbol: string, timeframeSeconds: number, candle: DerivedCandle) {
  const key = buildKey(symbol, timeframeSeconds);
  const existing = closedCandles.get(key) ?? [];
  const last = existing[existing.length - 1];

  if (last?.time === candle.time) {
    existing[existing.length - 1] = candle;
    closedCandles.set(key, existing);
    return;
  }

  const next = [...existing, candle].slice(-MAX_RUNTIME_CANDLES);
  closedCandles.set(key, next);
}

export function getRuntimeCandles(
  symbol: string,
  timeframeSeconds: number,
  limit = 500,
  includeActive = false,
): DerivedCandle[] {
  const key = buildKey(symbol, timeframeSeconds);
  const stored = (closedCandles.get(key) ?? []).slice(-limit);

  if (!includeActive) {
    return stored;
  }

  const active = activeCandles.get(key);
  if (!active) {
    return stored;
  }

  if (stored[stored.length - 1]?.time === active.time) {
    return [...stored.slice(0, -1), active];
  }

  return [...stored, active].slice(-limit);
}