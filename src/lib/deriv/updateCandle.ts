import { saveClosedCandle } from '../db/saveClosedCandle';
import { appendClosedCandle, getActiveCandle, setActiveCandle, type ActiveCandleState } from './activeCandles';

const TIMEFRAME_LABELS: Record<number, string> = {
  60: 'M1',
  300: 'M5',
  900: 'M15',
  1800: 'M30',
  3600: 'H1',
  14400: 'H4',
  86400: 'D1',
};

const LIVE_TIMEFRAMES = Object.keys(TIMEFRAME_LABELS).map(Number);

function buildActiveCandle(bucketStart: number, price: number): ActiveCandleState {
  return {
    bucketStart,
    time: bucketStart,
    open: price,
    high: price,
    low: price,
    close: price,
  };
}

export async function updateCandle(symbol: string, price: number, epoch: number, timeframeSeconds: number) {
  const timeframe = TIMEFRAME_LABELS[timeframeSeconds];
  if (!timeframe) {
    throw new Error(`Unsupported timeframe: ${timeframeSeconds}`);
  }

  const bucketStart = Math.floor(epoch / timeframeSeconds) * timeframeSeconds;
  const activeCandle = getActiveCandle(symbol, timeframeSeconds);

  if (!activeCandle) {
    setActiveCandle(symbol, timeframeSeconds, buildActiveCandle(bucketStart, price));
    return;
  }

  if (bucketStart < activeCandle.bucketStart) {
    return;
  }

  if (bucketStart === activeCandle.bucketStart) {
    setActiveCandle(symbol, timeframeSeconds, {
      ...activeCandle,
      high: Math.max(activeCandle.high, price),
      low: Math.min(activeCandle.low, price),
      close: price,
    });
    return;
  }

  appendClosedCandle(symbol, timeframeSeconds, activeCandle);
  await saveClosedCandle(symbol, timeframe, activeCandle);
  setActiveCandle(symbol, timeframeSeconds, buildActiveCandle(bucketStart, price));
}

export async function updateCandlesForTick(symbol: string, price: number, epoch: number) {
  await Promise.all(LIVE_TIMEFRAMES.map((timeframeSeconds) => updateCandle(symbol, price, epoch, timeframeSeconds)));
}