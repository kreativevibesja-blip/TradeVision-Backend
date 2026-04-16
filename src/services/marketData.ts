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

export interface LiveMarketQuote {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
}

export interface LiveChartSymbolDefinition {
  id: string;
  label: string;
  tvSymbol: string;
  dataSymbol: string;
  category: 'forex-major' | 'forex-minor' | 'commodities' | 'indices' | 'crypto';
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

interface TwelveDataQuotePayload {
  symbol?: string;
  close?: string | number;
  price?: string | number;
  bid?: string | number;
  ask?: string | number;
  message?: string;
  status?: string;
}

const QUOTE_CACHE_TTL_MS = 5_000;
const quoteCache = new Map<string, { quote: LiveMarketQuote; cachedAt: number }>();

const LIVE_CHART_SYMBOLS: LiveChartSymbolDefinition[] = [
  { id: 'EURUSD', label: 'EUR/USD', tvSymbol: 'OANDA:EURUSD', dataSymbol: 'EUR/USD', category: 'forex-major' },
  { id: 'GBPUSD', label: 'GBP/USD', tvSymbol: 'OANDA:GBPUSD', dataSymbol: 'GBP/USD', category: 'forex-major' },
  { id: 'USDJPY', label: 'USD/JPY', tvSymbol: 'OANDA:USDJPY', dataSymbol: 'USD/JPY', category: 'forex-major' },
  { id: 'USDCHF', label: 'USD/CHF', tvSymbol: 'OANDA:USDCHF', dataSymbol: 'USD/CHF', category: 'forex-major' },
  { id: 'USDCAD', label: 'USD/CAD', tvSymbol: 'OANDA:USDCAD', dataSymbol: 'USD/CAD', category: 'forex-major' },
  { id: 'AUDUSD', label: 'AUD/USD', tvSymbol: 'OANDA:AUDUSD', dataSymbol: 'AUD/USD', category: 'forex-major' },
  { id: 'NZDUSD', label: 'NZD/USD', tvSymbol: 'OANDA:NZDUSD', dataSymbol: 'NZD/USD', category: 'forex-major' },
  { id: 'EURGBP', label: 'EUR/GBP', tvSymbol: 'OANDA:EURGBP', dataSymbol: 'EUR/GBP', category: 'forex-minor' },
  { id: 'EURJPY', label: 'EUR/JPY', tvSymbol: 'OANDA:EURJPY', dataSymbol: 'EUR/JPY', category: 'forex-minor' },
  { id: 'EURCHF', label: 'EUR/CHF', tvSymbol: 'OANDA:EURCHF', dataSymbol: 'EUR/CHF', category: 'forex-minor' },
  { id: 'EURAUD', label: 'EUR/AUD', tvSymbol: 'OANDA:EURAUD', dataSymbol: 'EUR/AUD', category: 'forex-minor' },
  { id: 'EURNZD', label: 'EUR/NZD', tvSymbol: 'OANDA:EURNZD', dataSymbol: 'EUR/NZD', category: 'forex-minor' },
  { id: 'GBPJPY', label: 'GBP/JPY', tvSymbol: 'OANDA:GBPJPY', dataSymbol: 'GBP/JPY', category: 'forex-minor' },
  { id: 'GBPCHF', label: 'GBP/CHF', tvSymbol: 'OANDA:GBPCHF', dataSymbol: 'GBP/CHF', category: 'forex-minor' },
  { id: 'GBPAUD', label: 'GBP/AUD', tvSymbol: 'OANDA:GBPAUD', dataSymbol: 'GBP/AUD', category: 'forex-minor' },
  { id: 'AUDJPY', label: 'AUD/JPY', tvSymbol: 'OANDA:AUDJPY', dataSymbol: 'AUD/JPY', category: 'forex-minor' },
  { id: 'AUDNZD', label: 'AUD/NZD', tvSymbol: 'OANDA:AUDNZD', dataSymbol: 'AUD/NZD', category: 'forex-minor' },
  { id: 'AUDCAD', label: 'AUD/CAD', tvSymbol: 'OANDA:AUDCAD', dataSymbol: 'AUD/CAD', category: 'forex-minor' },
  { id: 'CADJPY', label: 'CAD/JPY', tvSymbol: 'OANDA:CADJPY', dataSymbol: 'CAD/JPY', category: 'forex-minor' },
  { id: 'CHFJPY', label: 'CHF/JPY', tvSymbol: 'OANDA:CHFJPY', dataSymbol: 'CHF/JPY', category: 'forex-minor' },
  { id: 'NZDJPY', label: 'NZD/JPY', tvSymbol: 'OANDA:NZDJPY', dataSymbol: 'NZD/JPY', category: 'forex-minor' },
  { id: 'XAUUSD', label: 'Gold', tvSymbol: 'OANDA:XAUUSD', dataSymbol: 'XAU/USD', category: 'commodities' },
  { id: 'XAGUSD', label: 'Silver', tvSymbol: 'OANDA:XAGUSD', dataSymbol: 'XAG/USD', category: 'commodities' },
  { id: 'USOIL', label: 'WTI Oil', tvSymbol: 'TVC:USOIL', dataSymbol: 'USOIL', category: 'commodities' },
  { id: 'BRENT', label: 'Brent Oil', tvSymbol: 'TVC:UKOIL', dataSymbol: 'BRENT', category: 'commodities' },
  { id: 'NATGAS', label: 'Natural Gas', tvSymbol: 'TVC:NATGAS', dataSymbol: 'NATGAS', category: 'commodities' },
  { id: 'NAS100', label: 'NAS100', tvSymbol: 'CAPITALCOM:US100', dataSymbol: 'NAS100', category: 'indices' },
  { id: 'US30', label: 'US30', tvSymbol: 'CAPITALCOM:US30', dataSymbol: 'DJI', category: 'indices' },
  { id: 'SPX500', label: 'SPX500', tvSymbol: 'CAPITALCOM:US500', dataSymbol: 'SPX', category: 'indices' },
  { id: 'GER40', label: 'GER40', tvSymbol: 'CAPITALCOM:DE40', dataSymbol: 'GER40', category: 'indices' },
  { id: 'UK100', label: 'UK100', tvSymbol: 'CAPITALCOM:UK100', dataSymbol: 'UK100', category: 'indices' },
  { id: 'JP225', label: 'JP225', tvSymbol: 'CAPITALCOM:JPN225', dataSymbol: 'JP225', category: 'indices' },
  { id: 'BTCUSD', label: 'BTC/USD', tvSymbol: 'BITSTAMP:BTCUSD', dataSymbol: 'BTC/USD', category: 'crypto' },
  { id: 'ETHUSD', label: 'ETH/USD', tvSymbol: 'BITSTAMP:ETHUSD', dataSymbol: 'ETH/USD', category: 'crypto' },
  { id: 'SOLUSD', label: 'SOL/USD', tvSymbol: 'BINANCE:SOLUSDT', dataSymbol: 'SOL/USD', category: 'crypto' },
  { id: 'XRPUSD', label: 'XRP/USD', tvSymbol: 'BITSTAMP:XRPUSD', dataSymbol: 'XRP/USD', category: 'crypto' },
  { id: 'ADAUSD', label: 'ADA/USD', tvSymbol: 'BINANCE:ADAUSDT', dataSymbol: 'ADA/USD', category: 'crypto' },
  { id: 'LTCUSD', label: 'LTC/USD', tvSymbol: 'BITSTAMP:LTCUSD', dataSymbol: 'LTC/USD', category: 'crypto' },
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

export const fetchLiveQuoteForSymbol = async (symbol: string): Promise<LiveMarketQuote> => {
  const resolvedSymbol = resolveLiveChartSymbol(symbol);
  if (!resolvedSymbol) {
    throw new Error('Unsupported live quote symbol');
  }

  const cached = quoteCache.get(resolvedSymbol.id);
  if (cached && Date.now() - cached.cachedAt < QUOTE_CACHE_TTL_MS) {
    return cached.quote;
  }

  if (!config.marketData.twelveDataApiKey.trim()) {
    throw new Error('Market data is not configured. Set TWELVEDATA_API_KEY.');
  }

  const url = new URL('/quote', config.marketData.twelveDataBaseUrl);
  url.searchParams.set('symbol', resolvedSymbol.dataSymbol);
  url.searchParams.set('apikey', config.marketData.twelveDataApiKey);

  const response = await fetch(url.toString(), { method: 'GET' });
  const payload = await response.json().catch(() => null) as TwelveDataQuotePayload | null;

  if (!response.ok) {
    throw new Error(payload?.message || `Market quote request failed with status ${response.status}`);
  }

  if (typeof payload?.status === 'string' && payload.status.toLowerCase() === 'error') {
    throw new Error(payload?.message || 'Market quote provider returned an error');
  }

  const bid = toNumeric(payload?.bid);
  const ask = toNumeric(payload?.ask);
  const price = toNumeric(payload?.price) ?? toNumeric(payload?.close);

  if (bid == null || ask == null || price == null) {
    throw new Error(`Live quote for ${resolvedSymbol.id} did not include bid/ask pricing`);
  }

  const quote: LiveMarketQuote = {
    symbol: resolvedSymbol.id,
    price,
    bid,
    ask,
    spread: Math.abs(ask - bid),
  };

  quoteCache.set(resolvedSymbol.id, { quote, cachedAt: Date.now() });
  return quote;
};

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