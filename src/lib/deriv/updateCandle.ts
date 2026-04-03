import { saveClosedCandle } from '../db/saveClosedCandle';
import { getActiveCandle, setActiveCandle, type ActiveCandleState } from './activeCandles';

const TIMEFRAME_LABELS: Record<number, string> = {
  300: 'M5',
  900: 'M15',
};

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

  await saveClosedCandle(symbol, timeframe, activeCandle);
  setActiveCandle(symbol, timeframeSeconds, buildActiveCandle(bucketStart, price));
}

export async function updateCandlesForTick(symbol: string, price: number, epoch: number) {
  await updateCandle(symbol, price, epoch, 300);
  await updateCandle(symbol, price, epoch, 900);
}