import type { TickPoint } from './store';

export interface DerivedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

export function buildCandles(ticks: TickPoint[], timeframeSec: number): DerivedCandle[] {
  const candles: DerivedCandle[] = [];
  let bucket: TickPoint[] = [];
  let currentTime: number | null = null;

  for (const tick of ticks) {
    const bucketTime = Math.floor(tick.time / timeframeSec) * timeframeSec;

    if (currentTime === null) {
      currentTime = bucketTime;
    }

    if (bucketTime !== currentTime) {
      if (bucket.length > 0) {
        candles.push(createCandle(bucket, currentTime));
      }
      bucket = [];
      currentTime = bucketTime;
    }

    bucket.push(tick);
  }

  if (bucket.length > 0 && currentTime !== null) {
    candles.push(createCandle(bucket, currentTime));
  }

  return candles;
}

export function aggregateCandles(candles: DerivedCandle[], timeframeSec: number): DerivedCandle[] {
  const aggregated: DerivedCandle[] = [];
  let bucket: DerivedCandle[] = [];
  let currentTime: number | null = null;

  for (const candle of candles) {
    const bucketTime = Math.floor(candle.time / timeframeSec) * timeframeSec;

    if (currentTime === null) {
      currentTime = bucketTime;
    }

    if (bucketTime !== currentTime) {
      if (bucket.length > 0) {
        aggregated.push(createAggregateCandle(bucket, currentTime));
      }
      bucket = [];
      currentTime = bucketTime;
    }

    bucket.push(candle);
  }

  if (bucket.length > 0 && currentTime !== null) {
    aggregated.push(createAggregateCandle(bucket, currentTime));
  }

  return aggregated;
}

function createCandle(ticks: TickPoint[], time: number): DerivedCandle {
  return {
    time,
    open: ticks[0].price,
    high: Math.max(...ticks.map((tick) => tick.price)),
    low: Math.min(...ticks.map((tick) => tick.price)),
    close: ticks[ticks.length - 1].price,
  };
}

function createAggregateCandle(candles: DerivedCandle[], time: number): DerivedCandle {
  return {
    time,
    open: candles[0].open,
    high: Math.max(...candles.map((candle) => candle.high)),
    low: Math.min(...candles.map((candle) => candle.low)),
    close: candles[candles.length - 1].close,
  };
}
