import type { DerivedCandle } from '../deriv/candles';
import { supabase } from '../supabase';

const CANDLES_TABLE = 'candles';
const SUPPORTED_CANDLE_TIMEFRAMES = new Set(['M1', 'M5', 'M15', 'H1']);

export async function saveClosedCandle(symbol: string, timeframe: string, candle: DerivedCandle) {
  if (!SUPPORTED_CANDLE_TIMEFRAMES.has(timeframe)) {
    throw new Error(`Unsupported candle timeframe for persistence: ${timeframe}`);
  }

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