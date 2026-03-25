import { config } from '../config';

export interface MarketCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketDataResult {
  symbol: string;
  timeframe: string;
  candles: MarketCandle[];
  currentPrice: number;
}

export interface LiveChartSymbolDefinition {
  id: string;
  label: string;
  tvSymbol: string;
  dataSymbol: string;
}

interface TwelveDataValueRow {
  datetime?: string;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
}

interface ParsedMarketDataRow {
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

const LIVE_CHART_SYMBOLS: LiveChartSymbolDefinition[] = [
  { id: 'EURUSD', label: 'EUR/USD', tvSymbol: 'OANDA:EURUSD', dataSymbol: 'EUR/USD' },
  { id: 'GBPUSD', label: 'GBP/USD', tvSymbol: 'OANDA:GBPUSD', dataSymbol: 'GBP/USD' },
  { id: 'USDJPY', label: 'USD/JPY', tvSymbol: 'OANDA:USDJPY', dataSymbol: 'USD/JPY' },
  { id: 'AUDUSD', label: 'AUD/USD', tvSymbol: 'OANDA:AUDUSD', dataSymbol: 'AUD/USD' },
  { id: 'USDCAD', label: 'USD/CAD', tvSymbol: 'OANDA:USDCAD', dataSymbol: 'USD/CAD' },
  { id: 'XAUUSD', label: 'XAU/USD', tvSymbol: 'OANDA:XAUUSD', dataSymbol: 'XAU/USD' },
  { id: 'BTCUSD', label: 'BTC/USD', tvSymbol: 'BITSTAMP:BTCUSD', dataSymbol: 'BTC/USD' },
  { id: 'ETHUSD', label: 'ETH/USD', tvSymbol: 'BITSTAMP:ETHUSD', dataSymbol: 'ETH/USD' },
  { id: 'NAS100', label: 'NAS100', tvSymbol: 'CAPITALCOM:US100', dataSymbol: 'NAS100' },
  { id: 'US30', label: 'US30', tvSymbol: 'CAPITALCOM:US30', dataSymbol: 'DJI' },
  { id: 'SPX500', label: 'SPX500', tvSymbol: 'CAPITALCOM:US500', dataSymbol: 'SPX' },
];

const TIMEFRAME_INTERVALS: Record<string, string> = {
  M1: '1min',
  M5: '5min',
  M15: '15min',
  M30: '30min',
  H1: '1h',
  H4: '4h',
  D1: '1day',
};

const toNumeric = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const listLiveChartSymbols = () => LIVE_CHART_SYMBOLS;

export const resolveLiveChartSymbol = (symbol: string) => {
  const normalized = symbol.trim().toUpperCase();
  return LIVE_CHART_SYMBOLS.find((item) => item.id === normalized) ?? null;
};

export const isSupportedLiveChartTimeframe = (timeframe: string) => Boolean(TIMEFRAME_INTERVALS[timeframe]);

export const fetchMarketDataForLiveChart = async (symbol: string, timeframe: string): Promise<MarketDataResult> => {
  const resolvedSymbol = resolveLiveChartSymbol(symbol);
  if (!resolvedSymbol) {
    throw new Error('Unsupported live chart symbol');
  }

  const interval = TIMEFRAME_INTERVALS[timeframe];
  if (!interval) {
    throw new Error('Unsupported live chart timeframe');
  }

  if (!config.marketData.twelveDataApiKey.trim()) {
    throw new Error('Market data is not configured. Set TWELVEDATA_API_KEY.');
  }

  const url = new URL('/time_series', config.marketData.twelveDataBaseUrl);
  url.searchParams.set('symbol', resolvedSymbol.dataSymbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', String(config.marketData.candleLimit));
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('apikey', config.marketData.twelveDataApiKey);

  const response = await fetch(url.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => null) as any;

  if (!response.ok) {
    throw new Error(payload?.message || `Market data request failed with status ${response.status}`);
  }

  if (typeof payload?.status === 'string' && payload.status.toLowerCase() === 'error') {
    throw new Error(payload?.message || 'Market data provider returned an error');
  }

  const candles: MarketCandle[] = [];

  if (Array.isArray(payload?.values)) {
    const parsedRows: ParsedMarketDataRow[] = [];

    for (const valueRow of payload.values as TwelveDataValueRow[]) {
      parsedRows.push({
        timestamp: typeof valueRow?.datetime === 'string' ? valueRow.datetime : '',
        open: toNumeric(valueRow?.open),
        high: toNumeric(valueRow?.high),
        low: toNumeric(valueRow?.low),
        close: toNumeric(valueRow?.close),
      });
    }

    for (const parsedRow of parsedRows) {
      if (
        parsedRow.timestamp &&
        parsedRow.open !== null &&
        parsedRow.high !== null &&
        parsedRow.low !== null &&
        parsedRow.close !== null
      ) {
        candles.push({
          timestamp: parsedRow.timestamp,
          open: parsedRow.open,
          high: parsedRow.high,
          low: parsedRow.low,
          close: parsedRow.close,
        });
      }
    }

    candles.reverse();
  }

  if (candles.length < 50) {
    throw new Error('Market data provider did not return enough candles for analysis');
  }

  return {
    symbol: resolvedSymbol.label,
    timeframe,
    candles,
    currentPrice: candles[candles.length - 1].close,
  };
};