import type { DerivedCandle } from '../deriv/candles';
import { supabase } from '../supabase';

const CANDLES_TABLE = 'candles';

export async function saveClosedCandle(symbol: string, timeframe: string, candle: DerivedCandle) {
  const { error } = await supabase.from(CANDLES_TABLE).upsert(
    {
      symbol,
      timeframe,
      time: new Date(candle.time * 1000).toISOString(),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'symbol,timeframe,time',
      ignoreDuplicates: false,
    },
  );

  if (error) {
    throw new Error(error.message);
  }
}