export type AssetClass = 'forex' | 'crypto' | 'indices' | 'synthetic';
export type SyntheticProfile = 'VIX' | 'Boom' | 'Crash' | 'Jump' | 'Step' | 'Standard';
export type VolatilityClassification = 'low' | 'medium' | 'high' | 'extreme';

type PairTemplate = {
  assetClass: AssetClass;
  referencePrice: number;
  amplitude: number;
  precision: number;
  syntheticProfile: SyntheticProfile;
};

const containsAny = (value: string, needles: string[]) => needles.some((needle) => value.includes(needle));

export const inferSyntheticProfile = (pair: string): SyntheticProfile => {
  const normalized = pair.toLowerCase();
  if (normalized.includes('boom')) return 'Boom';
  if (normalized.includes('crash')) return 'Crash';
  if (normalized.includes('jump')) return 'Jump';
  if (normalized.includes('step')) return 'Step';
  if (normalized.includes('volatility') || normalized.includes('vix')) return 'VIX';
  return 'Standard';
};

export const inferAssetClass = (pair: string): AssetClass => {
  const normalized = pair.toLowerCase();

  if (containsAny(normalized, ['boom', 'crash', 'step', 'jump', 'volatility', 'vix'])) {
    return 'synthetic';
  }

  if (containsAny(normalized, ['btc', 'eth', 'sol', 'xrp', 'crypto'])) {
    return 'crypto';
  }

  if (containsAny(normalized, ['us30', 'nas100', 'spx500', 'ger40', 'uk100', 'dj30'])) {
    return 'indices';
  }

  return 'forex';
};

export const getPairTemplate = (pair: string): PairTemplate => {
  const normalized = pair.toUpperCase();
  const assetClass = inferAssetClass(pair);
  const syntheticProfile = inferSyntheticProfile(pair);

  if (normalized.includes('BTC')) {
    return { assetClass: 'crypto', referencePrice: 65000, amplitude: 4000, precision: 0, syntheticProfile };
  }

  if (normalized.includes('ETH')) {
    return { assetClass: 'crypto', referencePrice: 3200, amplitude: 300, precision: 1, syntheticProfile };
  }

  if (normalized.includes('XAU')) {
    return { assetClass: 'forex', referencePrice: 2150, amplitude: 35, precision: 1, syntheticProfile };
  }

  if (normalized.includes('JPY')) {
    return { assetClass, referencePrice: 150, amplitude: 1.8, precision: 3, syntheticProfile };
  }

  if (normalized.includes('US30')) {
    return { assetClass: 'indices', referencePrice: 39000, amplitude: 450, precision: 0, syntheticProfile };
  }

  if (normalized.includes('NAS100')) {
    return { assetClass: 'indices', referencePrice: 18200, amplitude: 260, precision: 0, syntheticProfile };
  }

  if (normalized.includes('SPX500')) {
    return { assetClass: 'indices', referencePrice: 5200, amplitude: 75, precision: 0, syntheticProfile };
  }

  if (assetClass === 'synthetic') {
    return { assetClass, referencePrice: 1000, amplitude: 120, precision: 2, syntheticProfile };
  }

  return { assetClass, referencePrice: 1.085, amplitude: 0.01, precision: 4, syntheticProfile };
};

export const getPricePrecision = (pair: string) => getPairTemplate(pair).precision;

export const roundPrice = (value: number, pair: string) => {
  const precision = getPricePrecision(pair);
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
};

type VolatilityInput = {
  pair: string;
  priceSpan: number;
  activityScore: number;
  rangeState?: 'compression' | 'balanced' | 'expansion';
};

export const classifyVolatility = ({ pair, priceSpan, activityScore, rangeState }: VolatilityInput): VolatilityClassification => {
  const template = getPairTemplate(pair);
  const normalizedSpan = template.amplitude > 0 ? priceSpan / template.amplitude : priceSpan;
  const combinedScore = normalizedSpan * 0.65 + activityScore * 0.35;

  if (template.syntheticProfile === 'Boom' || template.syntheticProfile === 'Crash') {
    if (combinedScore > 0.95 || rangeState === 'expansion') return 'extreme';
    if (combinedScore > 0.65) return 'high';
    return 'medium';
  }

  if (template.syntheticProfile === 'VIX' || template.syntheticProfile === 'Jump') {
    if (combinedScore > 0.85) return 'extreme';
    if (combinedScore > 0.55) return 'high';
    if (combinedScore > 0.3) return 'medium';
    return 'low';
  }

  if (combinedScore > 0.8) return 'extreme';
  if (combinedScore > 0.5) return 'high';
  if (combinedScore > 0.22) return 'medium';
  return 'low';
};