export interface DerivScannerSymbolConfig {
  symbol: string;
  aliases: string[];
}

function buildAliases(symbol: string, extras: string[] = []) {
  const compact = symbol.toLowerCase();
  const slash = symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}`.toLowerCase() : compact;
  return Array.from(new Set([compact, slash, ...extras.map((value) => value.toLowerCase())]));
}

export const DERIV_SCANNER_SYMBOLS: DerivScannerSymbolConfig[] = [
  { symbol: 'EURUSD', aliases: buildAliases('EURUSD', ['frxeurusd']) },
  { symbol: 'GBPUSD', aliases: buildAliases('GBPUSD', ['frxgbpusd']) },
  { symbol: 'USDJPY', aliases: buildAliases('USDJPY', ['frxusdjpy']) },
  { symbol: 'USDCHF', aliases: buildAliases('USDCHF', ['frxusdchf']) },
  { symbol: 'USDCAD', aliases: buildAliases('USDCAD', ['frxusdcad']) },
  { symbol: 'AUDUSD', aliases: buildAliases('AUDUSD', ['frxaudusd']) },
  { symbol: 'NZDUSD', aliases: buildAliases('NZDUSD', ['frxnzdusd']) },
  { symbol: 'EURGBP', aliases: buildAliases('EURGBP', ['frxeurgbp']) },
  { symbol: 'EURJPY', aliases: buildAliases('EURJPY', ['frxeurjpy']) },
  { symbol: 'EURCHF', aliases: buildAliases('EURCHF', ['frxdurchf', 'frxeurchf']) },
  { symbol: 'EURAUD', aliases: buildAliases('EURAUD', ['frxeuraud']) },
  { symbol: 'EURNZD', aliases: buildAliases('EURNZD', ['frxeurnzd']) },
  { symbol: 'GBPJPY', aliases: buildAliases('GBPJPY', ['frxgbpjpy']) },
  { symbol: 'GBPCHF', aliases: buildAliases('GBPCHF', ['frxgbpchf']) },
  { symbol: 'GBPAUD', aliases: buildAliases('GBPAUD', ['frxgbpaud']) },
  { symbol: 'AUDJPY', aliases: buildAliases('AUDJPY', ['frxaudjpy']) },
  { symbol: 'AUDNZD', aliases: buildAliases('AUDNZD', ['frxaudnzd']) },
  { symbol: 'AUDCAD', aliases: buildAliases('AUDCAD', ['frxaudcad']) },
  { symbol: 'CADJPY', aliases: buildAliases('CADJPY', ['frxcadjpy']) },
  { symbol: 'CHFJPY', aliases: buildAliases('CHFJPY', ['frxchfjpy']) },
  { symbol: 'NZDJPY', aliases: buildAliases('NZDJPY', ['frxnzdjpy']) },
  { symbol: 'XAUUSD', aliases: buildAliases('XAUUSD', ['frxxauusd', 'gold']) },
  { symbol: 'XAGUSD', aliases: buildAliases('XAGUSD', ['frxxagusd', 'silver']) },
  { symbol: 'USOIL', aliases: buildAliases('USOIL', ['wti', 'westtexas', 'crudeoil']) },
  { symbol: 'BRENT', aliases: buildAliases('BRENT', ['brentoil', 'ukoil']) },
  { symbol: 'NATGAS', aliases: buildAliases('NATGAS', ['naturalgas']) },
  { symbol: 'NAS100', aliases: buildAliases('NAS100', ['nasdaq', 'nasdaq100', 'ustech']) },
  { symbol: 'US30', aliases: buildAliases('US30', ['wallstreet', 'dowjones', 'ws30', 'dji']) },
  { symbol: 'SPX500', aliases: buildAliases('SPX500', ['sp500', 'us500', 'sandp500', 'spx']) },
  { symbol: 'GER40', aliases: buildAliases('GER40', ['de40', 'dax']) },
  { symbol: 'UK100', aliases: buildAliases('UK100', ['uk100', 'ftse100']) },
  { symbol: 'JP225', aliases: buildAliases('JP225', ['jpn225', 'nikkei']) },
  { symbol: 'BTCUSD', aliases: buildAliases('BTCUSD', ['crybtcusd', 'bitcoin']) },
  { symbol: 'ETHUSD', aliases: buildAliases('ETHUSD', ['cryethusd', 'ethereum']) },
  { symbol: 'SOLUSD', aliases: buildAliases('SOLUSD', ['crysolusd', 'solana']) },
  { symbol: 'XRPUSD', aliases: buildAliases('XRPUSD', ['cryxrpusd', 'ripple']) },
  { symbol: 'ADAUSD', aliases: buildAliases('ADAUSD', ['cryadausd', 'cardano']) },
  { symbol: 'LTCUSD', aliases: buildAliases('LTCUSD', ['cryltcusd', 'litecoin']) },
];

export const SESSION_SCANNER_SYMBOL_IDS = DERIV_SCANNER_SYMBOLS.map((item) => item.symbol);

export const VOLATILITY_SCANNER_SYMBOL_IDS = [
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
] as const;

export const DERIV_SCANNER_SYMBOL_IDS = [...SESSION_SCANNER_SYMBOL_IDS, ...VOLATILITY_SCANNER_SYMBOL_IDS];
