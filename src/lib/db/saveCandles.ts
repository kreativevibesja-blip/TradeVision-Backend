import { supabase } from '../supabase';

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
