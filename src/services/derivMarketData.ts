import { getCachedCandles } from '../lib/db/saveCandles';
import { getRuntimeCandles } from '../lib/deriv/activeCandles';
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
  300: 'M5',
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

  const runtimeCandles = getRuntimeCandles(normalizedSymbol, granularity, count, true);
  if (runtimeCandles.length >= Math.min(count, 50)) {
    const candles = mapDerivedCandlesToLiveChart(runtimeCandles);

    return {
      symbol: normalizedSymbol,
      granularity,
      candles,
      currentPrice: candles[candles.length - 1]?.close ?? 0,
      source: 'deriv-backend',
    };
  }

  const dbTimeframe = DB_TIMEFRAME_MAP[granularity];
  if (dbTimeframe) {
    const cached = await getCachedCandles(normalizedSymbol, dbTimeframe, count);
    if (cached.length >= Math.min(count, 50)) {
      const candles = cached.map((candle) => ({
        time: Math.floor(new Date(candle.time).getTime() / 1000),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      return {
        symbol: normalizedSymbol,
        granularity,
        candles,
        currentPrice: candles[candles.length - 1]?.close ?? 0,
        source: 'deriv-backend',
      };
    }
  }

  const candles = await getDerivHistoryCandles(normalizedSymbol, granularity, count);
  if (candles.length === 0) {
    throw new Error('No Deriv candles available for this symbol');
  }

  return {
    symbol: normalizedSymbol,
    granularity,
    candles,
    currentPrice: candles[candles.length - 1]?.close ?? 0,
    source: 'deriv-backend',
  };
}
