export interface DerivScannerSymbolConfig {
  symbol: string;
  aliases: string[];
}

export const DERIV_SCANNER_SYMBOLS: DerivScannerSymbolConfig[] = [
  { symbol: 'EURUSD', aliases: ['frxeurusd', 'eurusd', 'eur/usd'] },
  { symbol: 'GBPUSD', aliases: ['frxgbpusd', 'gbpusd', 'gbp/usd'] },
  { symbol: 'USDJPY', aliases: ['frxusdjpy', 'usdjpy', 'usd/jpy'] },
  { symbol: 'USDCAD', aliases: ['frxusdcad', 'usdcad', 'usd/cad'] },
  { symbol: 'GBPJPY', aliases: ['frxgbpjpy', 'gbpjpy', 'gbp/jpy'] },
  { symbol: 'XAUUSD', aliases: ['frxxauusd', 'xauusd', 'gold'] },
  { symbol: 'NAS100', aliases: ['nas100', 'nasdaq', 'nasdaq100', 'ustech'] },
  { symbol: 'US30', aliases: ['us30', 'wallstreet', 'dowjones', 'ws30'] },
  { symbol: 'SPX500', aliases: ['spx500', 'sp500', 'us500', 'sandp500'] },
  { symbol: 'USOIL', aliases: ['usoil', 'wti', 'westtexas', 'crudeoil'] },
  { symbol: 'BTCUSD', aliases: ['crybtcusd', 'btcusd', 'btc/usd', 'bitcoin'] },
];

export const SESSION_SCANNER_SYMBOL_IDS = DERIV_SCANNER_SYMBOLS.map((item) => item.symbol);

export const VOLATILITY_SCANNER_SYMBOL_IDS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  '1HZ10V',
  '1HZ25V',
  '1HZ50V',
  '1HZ75V',
  '1HZ100V',
] as const;

export const DERIV_SCANNER_SYMBOL_IDS = [...SESSION_SCANNER_SYMBOL_IDS, ...VOLATILITY_SCANNER_SYMBOL_IDS];
