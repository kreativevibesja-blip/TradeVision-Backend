import { getCachedCandles } from '../lib/db/saveCandles';
import { getRuntimeCandles } from '../lib/deriv/activeCandles';
import { getLatestTrackedTick } from '../lib/deriv/store';
import { ensureDerivSubscription, getDerivHistoryCandles } from '../lib/deriv/ws';

export interface DerivLiveChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DerivLiveChartMarketData {
  symbol: string;
  granularity: number;
  candles: DerivLiveChartCandle[];
  currentPrice: number;
  source: 'deriv-backend';
}

const SUPPORTED_GRANULARITIES = new Set([60, 300, 900, 1800, 3600, 14400, 86400]);
const DB_TIMEFRAME_MAP: Record<number, string> = {
  900: 'M15',
};

function mapDerivedCandlesToLiveChart(candles: Array<{ time: number; open: number; high: number; low: number; close: number }>) {
  return candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));
}

function mergeLatestTickIntoCandles(
  symbol: string,
  granularity: number,
  candles: Array<{ time: number; open: number; high: number; low: number; close: number }>,
) {
  if (candles.length === 0) {
    return candles;
  }

  const latestTick = getLatestTrackedTick(symbol);
  if (!latestTick) {
    return candles;
  }

  const bucketStart = Math.floor(latestTick.time / granularity) * granularity;
  const nextCandles = [...candles];
  const last = nextCandles[nextCandles.length - 1];

  if (last.time === bucketStart) {
    nextCandles[nextCandles.length - 1] = {
      ...last,
      high: Math.max(last.high, latestTick.price),
      low: Math.min(last.low, latestTick.price),
      close: latestTick.price,
    };
    return nextCandles;
  }

  if (last.time < bucketStart) {
    const open = last.close;
    nextCandles.push({
      time: bucketStart,
      open,
      high: Math.max(open, latestTick.price),
      low: Math.min(open, latestTick.price),
      close: latestTick.price,
    });
  }

  return nextCandles;
}

export function isSupportedDerivGranularity(value: number) {
  return SUPPORTED_GRANULARITIES.has(value);
}

export async function getDerivLiveChartSnapshot(
  symbol: string,
  granularity: number,
  count = 500,
): Promise<DerivLiveChartMarketData> {
  const normalizedSymbol = symbol.trim().toUpperCase();

  if (!normalizedSymbol) {
    throw new Error('Symbol is required');
  }

  if (!isSupportedDerivGranularity(granularity)) {
    throw new Error('Unsupported Deriv granularity');
  }

  await ensureDerivSubscription(normalizedSymbol);

  const runtimeCandles = mergeLatestTickIntoCandles(
    normalizedSymbol,
    granularity,
    getRuntimeCandles(normalizedSymbol, granularity, count, true),
  );
  if (runtimeCandles.length >= Math.min(count, 50)) {
    const candles = mapDerivedCandlesToLiveChart(runtimeCandles);
    const latestTick = getLatestTrackedTick(normalizedSymbol);

    return {
      symbol: normalizedSymbol,
      granularity,
      candles,
      currentPrice: latestTick?.price ?? candles[candles.length - 1]?.close ?? 0,
      source: 'deriv-backend',
    };
  }

  const dbTimeframe = DB_TIMEFRAME_MAP[granularity];
  if (dbTimeframe) {
    const cached = await getCachedCandles(normalizedSymbol, dbTimeframe, count);
    if (cached.length >= Math.min(count, 50)) {
      const candles = mergeLatestTickIntoCandles(
        normalizedSymbol,
        granularity,
        cached.map((candle) => ({
          time: Math.floor(new Date(candle.time).getTime() / 1000),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        })),
      );
      const latestTick = getLatestTrackedTick(normalizedSymbol);

      return {
        symbol: normalizedSymbol,
        granularity,
        candles,
        currentPrice: latestTick?.price ?? candles[candles.length - 1]?.close ?? 0,
        source: 'deriv-backend',
      };
    }
  }

  const candles = mergeLatestTickIntoCandles(
    normalizedSymbol,
    granularity,
    await getDerivHistoryCandles(normalizedSymbol, granularity, count),
  );
  if (candles.length === 0) {
    throw new Error('No Deriv candles available for this symbol');
  }

  const latestTick = getLatestTrackedTick(normalizedSymbol);

  return {
    symbol: normalizedSymbol,
    granularity,
    candles,
    currentPrice: latestTick?.price ?? candles[candles.length - 1]?.close ?? 0,
    source: 'deriv-backend',
  };
}
