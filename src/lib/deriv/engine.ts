import { config } from '../../config';
import { saveCandles } from '../db/saveCandles';
import { aggregateCandles, buildCandles } from './candles';
import { getTicksForSymbol, getTrackedLogicalSymbols, setTicksForSymbol } from './store';

let candleEngineTimer: ReturnType<typeof setInterval> | null = null;
let flushInProgress = false;

async function flushCandles() {
  if (flushInProgress) {
    return;
  }

  flushInProgress = true;

  try {
    const trackedSymbols = getTrackedLogicalSymbols();
    if (trackedSymbols.length === 0) {
      return;
    }

    for (const symbol of trackedSymbols) {
      const ticks = getTicksForSymbol(symbol);
      if (ticks.length === 0) {
        continue;
      }

      const candles1m = buildCandles(ticks, 60);
      if (candles1m.length === 0) {
        continue;
      }

      await saveCandles(symbol, 'M1', candles1m);
      await saveCandles(symbol, 'M5', aggregateCandles(candles1m, 300));
      await saveCandles(symbol, 'M15', aggregateCandles(candles1m, 900));

      const cutoffEpoch = Math.floor(Date.now() / 1000) - 2 * 60 * 60;
      const retainedTicks = ticks
        .filter((tick) => tick.time >= cutoffEpoch)
        .slice(-config.deriv.maxStoredTicksPerSymbol);

      setTicksForSymbol(symbol, retainedTicks);
    }

    console.log('[deriv-candle-engine] candles updated');
  } finally {
    flushInProgress = false;
  }
}

export function startCandleEngine() {
  if (candleEngineTimer) {
    return;
  }

  console.log(`[deriv-candle-engine] started (flush every ${config.deriv.candleEngineIntervalMs}ms)`);
  void flushCandles();
  candleEngineTimer = setInterval(() => {
    void flushCandles();
  }, config.deriv.candleEngineIntervalMs);
}
