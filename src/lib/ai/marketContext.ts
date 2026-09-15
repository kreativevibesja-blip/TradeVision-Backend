export interface MarketContext {
  label: string;
  family: string;
  behavior: string;
  preferredLenses: string;
  cautions: string;
}

const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, ' ');

export function getMarketContext(symbol: string): MarketContext {
  const normalized = normalize(symbol);
  const isOther = !normalized || normalized === 'OTHER' || normalized === 'UNKNOWN' || normalized === 'N/A';

  if (isOther) {
    return {
      label: 'Unknown instrument until verified from the chart',
      family: 'unknown',
      behavior: 'Identify the symbol, exchange or synthetic-index label from the chart header, watermark, price scale, and platform metadata before applying instrument-specific assumptions.',
      preferredLenses: 'Use recent structure, support/resistance, liquidity sweeps, fair value gaps, order blocks, and break-and-retest only when visibly supported.',
      cautions: 'Do not invent the pair or index. If the instrument cannot be read confidently, lower confidence and prefer wait or no-trade.',
    };
  }

  const isDeriv = /^(R_|1HZ|JD\d+|STPRNG|DSI|RB\d+|RDBULL|RDBEAR|BOOM|CRASH)/.test(normalized)
    || /VOLATILITY|JUMP|STEP|DRIFT|RANGE BREAK|BOOM|CRASH/.test(normalized);
  if (isDeriv) {
    return {
      label: `Deriv synthetic index (${symbol})`,
      family: 'synthetic index',
      behavior: 'Synthetic indices trade continuously and are not driven by scheduled macro news or an exchange session. Read the index-specific price action, volatility regime, tick/candle cadence, and recent swing structure rather than importing forex-session assumptions.',
      preferredLenses: 'Prioritize recent support/resistance, liquidity sweeps, displacement, fair value gaps, order blocks, and break-and-retest structure. For digit-oriented or very fast indices, treat short-term repetition as context only, never as proof of a directional edge.',
      cautions: 'Do not assume a synthetic index behaves like EUR/USD, gold, or a stock index. Avoid overconfidence from a small sample and require visible structure plus a realistic invalidation.',
    };
  }

  if (/^(XAU|GOLD|XAG|SILVER)/.test(normalized)) {
    return {
      label: `Precious metal (${symbol})`,
      family: 'precious metal',
      behavior: 'Metals can expand sharply around liquidity, session opens, macro releases, and dollar-rate repricing. Give extra weight to displacement, rejection from major levels, and the width of the current volatility range.',
      preferredLenses: 'Use higher-timeframe support/resistance, liquidity sweeps, supply/demand, order blocks, fair value gaps, and break-and-retest with wider structural invalidation than a typical major forex pair.',
      cautions: 'Do not use tight stops or assume a clean small pullback during expansion. Check whether the move is extended before approving continuation.',
    };
  }

  if (/^(BTC|ETH|SOL|XRP|ADA|DOGE|BNB|LTC|AVAX|DOT|LINK)([-_/]|USD|USDT|$)/.test(normalized) || /USDT|USDC|BTCUSD|ETHUSD/.test(normalized)) {
    return {
      label: `Crypto asset (${symbol})`,
      family: 'crypto',
      behavior: 'Crypto trades continuously with high intraday volatility, weekend participation, leverage-driven stop runs, and rapid regime changes. Use the latest impulse and current range rather than assuming a traditional session pattern.',
      preferredLenses: 'Prioritize market structure, range liquidity, failed breakouts, displacement, fair value gaps, order blocks, and clean break-and-retest reactions.',
      cautions: 'Expect overshoots and wicks. Require clear invalidation and avoid chasing extended momentum or treating a single sweep as confirmation.',
    };
  }

  if (/^(US30|US100|NAS100|NAS|SPX|SP500|GER40|DE40|UK100|DAX|DJI|NDX)/.test(normalized)) {
    return {
      label: `Market index (${symbol})`,
      family: 'market index',
      behavior: 'Market indices are sensitive to session opens, liquidity around prior highs/lows, volatility expansion, and correlated risk sentiment. Session context and gap or opening-range behavior matter alongside visible structure.',
      preferredLenses: 'Use prior-day/session support and resistance, liquidity sweeps, displacement, fair value gaps, order blocks, and break-and-retest setups.',
      cautions: 'Allow for sharp opening moves and wider point ranges. Do not confuse an opening liquidity run with confirmed reversal until price closes back through structure.',
    };
  }

  if (/^[A-Z]{3,6}([/_-])[A-Z]{3,6}$/.test(normalized) || /USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF/.test(normalized)) {
    return {
      label: `Forex pair (${symbol})`,
      family: 'forex',
      behavior: 'Forex is session-driven and highly sensitive to relative currency strength, scheduled macro news, spread/liquidity conditions, and the active London/New York overlap. Recent structure still outranks any generic currency assumption.',
      preferredLenses: 'Use session highs/lows, support/resistance, liquidity sweeps, fair value gaps, order blocks, and break-and-retest structure with attention to premium/discount location.',
      cautions: 'Do not infer direction from the currency name alone. Account for news volatility, spread, and whether the setup is forming inside a session range or after displacement.',
    };
  }

  return {
    label: `Unclassified instrument (${symbol})`,
    family: 'unclassified',
    behavior: 'Use the visible instrument behavior, volatility, trading hours, and recent candle structure; do not force it into a familiar asset class.',
    preferredLenses: 'Apply support/resistance, liquidity sweeps, fair value gaps, order blocks, and break-and-retest only where visible and structurally confirmed.',
    cautions: 'Treat the instrument classification as uncertain and lower confidence if the chart does not clearly identify its market.',
  };
}

export function formatMarketContext(symbol: string) {
  const context = getMarketContext(symbol);
  return `
MARKET-SPECIFIC CONTEXT
- Identified instrument: ${context.label}
- Instrument family: ${context.family}
- Typical behavior to consider: ${context.behavior}
- Useful analytical lenses for this market: ${context.preferredLenses}
- Market-specific cautions: ${context.cautions}
- Priority rule: this profile is context, not a prediction or strategy template. The latest visible / supplied structure, price action, and confirmed levels always take priority.
`;
}
