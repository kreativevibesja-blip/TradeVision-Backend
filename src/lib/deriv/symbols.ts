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
  // Volatility (1s) Indices
  { symbol: '1HZ10V', aliases: ['1hz10v', 'volatility 10 (1s)', 'vol10 1s', 'volatility10(1s)'] },
  { symbol: '1HZ15V', aliases: ['1hz15v', 'volatility 15 (1s)', 'vol15 1s', 'volatility15(1s)'] },
  { symbol: '1HZ25V', aliases: ['1hz25v', 'volatility 25 (1s)', 'vol25 1s', 'volatility25(1s)'] },
  { symbol: '1HZ30V', aliases: ['1hz30v', 'volatility 30 (1s)', 'vol30 1s', 'volatility30(1s)'] },
  { symbol: '1HZ50V', aliases: ['1hz50v', 'volatility 50 (1s)', 'vol50 1s', 'volatility50(1s)'] },
  { symbol: '1HZ75V', aliases: ['1hz75v', 'volatility 75 (1s)', 'vol75 1s', 'volatility75(1s)'] },
  { symbol: '1HZ90V', aliases: ['1hz90v', 'volatility 90 (1s)', 'vol90 1s', 'volatility90(1s)'] },
  { symbol: '1HZ100V', aliases: ['1hz100v', 'volatility 100 (1s)', 'vol100 1s', 'volatility100(1s)'] },
  // Jump Indices
  { symbol: 'JD10', aliases: ['jd10', 'jump 10', 'jump10', 'jump 10 index'] },
  { symbol: 'JD25', aliases: ['jd25', 'jump 25', 'jump25', 'jump 25 index'] },
  { symbol: 'JD50', aliases: ['jd50', 'jump 50', 'jump50', 'jump 50 index'] },
  { symbol: 'JD75', aliases: ['jd75', 'jump 75', 'jump75', 'jump 75 index'] },
  { symbol: 'JD100', aliases: ['jd100', 'jump 100', 'jump100', 'jump 100 index'] },
  // Boom Indices
  { symbol: 'BOOM50', aliases: ['boom50', 'boom 50', 'boom 50 index'] },
  { symbol: 'BOOM150N', aliases: ['boom150n', 'boom 150', 'boom150', 'boom 150 index'] },
  { symbol: 'BOOM300N', aliases: ['boom300n', 'boom 300', 'boom300', 'boom 300 index'] },
  { symbol: 'BOOM500', aliases: ['boom500', 'boom 500', 'boom 500 index'] },
  { symbol: 'BOOM600', aliases: ['boom600', 'boom 600', 'boom 600 index'] },
  { symbol: 'BOOM900', aliases: ['boom900', 'boom 900', 'boom 900 index'] },
  { symbol: 'BOOM1000', aliases: ['boom1000', 'boom 1000', 'boom 1000 index'] },
  // Crash Indices
  { symbol: 'CRASH50', aliases: ['crash50', 'crash 50', 'crash 50 index'] },
  { symbol: 'CRASH150N', aliases: ['crash150n', 'crash 150', 'crash150', 'crash 150 index'] },
  { symbol: 'CRASH300N', aliases: ['crash300n', 'crash 300', 'crash300', 'crash 300 index'] },
  { symbol: 'CRASH500', aliases: ['crash500', 'crash 500', 'crash 500 index'] },
  { symbol: 'CRASH600', aliases: ['crash600', 'crash 600', 'crash 600 index'] },
  { symbol: 'CRASH900', aliases: ['crash900', 'crash 900', 'crash 900 index'] },
  { symbol: 'CRASH1000', aliases: ['crash1000', 'crash 1000', 'crash 1000 index'] },
  // Step Indices
  { symbol: 'stpRNG', aliases: ['stprng', 'step index', 'step 100', 'step index 100'] },
  { symbol: 'stpRNG2', aliases: ['stprng2', 'step index 200', 'step 200'] },
  { symbol: 'stpRNG3', aliases: ['stprng3', 'step index 300', 'step 300'] },
  { symbol: 'stpRNG4', aliases: ['stprng4', 'step index 400', 'step 400'] },
  { symbol: 'stpRNG5', aliases: ['stprng5', 'step index 500', 'step 500'] },
];

export const SESSION_SCANNER_SYMBOL_IDS = [
  'GBPJPY',
  'EURUSD',
  'USDJPY',
  'USDCAD',
  'XAUUSD',
  'USOIL',
  'US30',
  'NAS100',
  'SPX500',
  'BTCUSD',
] as const;

export const VOLATILITY_SCANNER_SYMBOL_IDS = [
  // Volatility Indices (continuous)
  'R_10',
  'R_25',
  'R_50',
  'R_75',
  'R_100',
  // Volatility Indices (1s)
  '1HZ10V',
  '1HZ75V',
] as const;

export const DERIV_SCANNER_SYMBOL_IDS = [...SESSION_SCANNER_SYMBOL_IDS, ...VOLATILITY_SCANNER_SYMBOL_IDS];
