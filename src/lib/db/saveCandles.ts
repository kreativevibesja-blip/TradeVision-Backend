import { supabase } from '../supabase';
import type { DerivedCandle } from '../deriv/candles';

const CANDLES_TABLE = 'candles';

export interface StoredCandleRow {
  symbol: string;
  timeframe: string;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function saveCandles(symbol: string, timeframe: string, candles: DerivedCandle[]) {
  if (candles.length === 0) {
    return;
  }

  const rows = candles.map((candle) => ({
    symbol,
    timeframe,
    time: new Date(candle.time * 1000).toISOString(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from(CANDLES_TABLE).upsert(rows, {
    onConflict: 'symbol,timeframe,time',
    ignoreDuplicates: false,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function getCachedCandles(symbol: string, timeframe: string, limit = 500): Promise<StoredCandleRow[]> {
  const { data, error } = await supabase
    .from(CANDLES_TABLE)
    .select('symbol, timeframe, time, open, high, low, close')
    .eq('symbol', symbol)
    .eq('timeframe', timeframe)
    .order('time', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as StoredCandleRow[]).reverse();
}
