type AnyAnalysis = Record<string, any>;

interface ConfidenceFactor {
  key: string;
  label: string;
  weight: number;
  score: number;
  summary: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const getNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const getTextArray = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  : [];

const getZoneMidpoint = (zone: { min: number | null; max: number | null } | null | undefined) => {
  if (!zone || typeof zone.min !== 'number' || typeof zone.max !== 'number') {
    return null;
  }

  return (zone.min + zone.max) / 2;
};

export const getReferenceEntryPrice = (analysis: AnyAnalysis) => {
  const directEntry = getNumber(analysis.entry);
  if (directEntry !== null) {
    return directEntry;
  }

  const entryPlanZone = getZoneMidpoint(analysis.entryPlan?.entryZone);
  if (entryPlanZone !== null) {
    return entryPlanZone;
  }

  const entryZone = getZoneMidpoint(analysis.entryZone);
  if (entryZone !== null) {
    return entryZone;
  }

  return getNumber(analysis.currentPrice) ?? null;
};

const getPairPipSize = (pair: string) => {
  const normalized = pair.toUpperCase();

  if (normalized.includes('JPY')) return 0.01;
  if (normalized.includes('XAU')) return 0.1;
  if (normalized.includes('BTC') || normalized.includes('ETH') || normalized.includes('US30') || normalized.includes('NAS100') || normalized.includes('SPX500') || normalized.includes('VOLATILITY') || normalized.includes('BOOM') || normalized.includes('CRASH') || normalized.includes('STEP')) {
    return 1;
  }

  return 0.0001;
};

const describeDistance = (pair: string, value: number) => {
  const pipSize = getPairPipSize(pair);
  const pipDistance = Math.abs(value) / pipSize;
  const rounded = pipSize >= 1 ? Math.round(pipDistance) : Number(pipDistance.toFixed(1));
  return pipSize >= 1 ? `${rounded} pts` : `${rounded} pips`;
};

const buildConfidenceFactors = (analysis: AnyAnalysis): ConfidenceFactor[] => {
  const confirmations = getTextArray(analysis.confirmations);
  const trend = typeof analysis.trend === 'string' ? analysis.trend : 'ranging';
  const entryBias = typeof analysis.entryPlan?.bias === 'string' ? analysis.entryPlan.bias : 'none';
  const structureBos = typeof analysis.structure?.bos === 'string' ? analysis.structure.bos : 'none';
  const structureChoch = typeof analysis.structure?.choch === 'string' ? analysis.structure.choch : 'none';
  const setupQuality = typeof analysis.setupQuality === 'string' ? analysis.setupQuality : 'low';
  const priceLocation = typeof analysis.currentPricePosition === 'string' ? analysis.currentPricePosition : 'equilibrium';
  const hasRiskLevels = getNumber(analysis.stopLoss) !== null && (getNumber(analysis.takeProfit1) !== null || getNumber(analysis.takeProfit2) !== null);
  const hasLiquiditySweep = typeof analysis.liquidity?.sweep === 'string' && analysis.liquidity.sweep !== 'none';
  const liquidityType = typeof analysis.liquidity?.type === 'string' ? analysis.liquidity.type : 'none';
  const confirmationSignal = typeof analysis.confirmation === 'string' ? analysis.confirmation : 'none';
  const dualChart = analysis.isDualChart === true;

  const structureAligned =
    (trend === 'bullish' && (entryBias === 'buy' || structureBos === 'bullish' || structureChoch === 'bullish')) ||
    (trend === 'bearish' && (entryBias === 'sell' || structureBos === 'bearish' || structureChoch === 'bearish'));

  const priceAligned =
    (entryBias === 'buy' && priceLocation === 'discount') ||
    (entryBias === 'sell' && priceLocation === 'premium') ||
    priceLocation === 'equilibrium';

  return [
    {
      key: 'structure',
      label: 'Structure Alignment',
      weight: 24,
      score: structureAligned ? 88 : trend === 'ranging' ? 48 : 34,
      summary: structureAligned
        ? 'Trend, BOS/CHoCH, and entry bias point in the same direction.'
        : 'Structure is mixed, so the setup needs extra confirmation.',
    },
    {
      key: 'liquidity',
      label: 'Liquidity Context',
      weight: 18,
      score: hasLiquiditySweep ? 84 : liquidityType !== 'none' ? 66 : 42,
      summary: hasLiquiditySweep
        ? 'The model found a recent liquidity sweep into the setup.'
        : liquidityType !== 'none'
          ? 'Liquidity is present, but the sweep signal is softer.'
          : 'No strong liquidity event was identified.',
    },
    {
      key: 'entry',
      label: 'Entry Precision',
      weight: 16,
      score: priceAligned ? 82 : 53,
      summary: priceAligned
        ? 'Current price sits in the preferred premium/discount location for the bias.'
        : 'Price location is less ideal, so the entry is more sensitive.',
    },
    {
      key: 'risk',
      label: 'Risk Definition',
      weight: 14,
      score: hasRiskLevels ? 85 : getNumber(analysis.invalidationLevel) !== null ? 62 : 38,
      summary: hasRiskLevels
        ? 'Stop and target structure are well-defined.'
        : getNumber(analysis.invalidationLevel) !== null
          ? 'Invalidation exists, but target structure is partial.'
          : 'Risk boundaries are still loose.',
    },
    {
      key: 'confirmation',
      label: 'Trigger Confirmation',
      weight: 16,
      score: confirmations.length >= 3 ? 86 : confirmations.length >= 1 || confirmationSignal !== 'none' ? 67 : 40,
      summary: confirmations.length >= 3
        ? 'Multiple confirmations are stacked behind the trade idea.'
        : confirmations.length >= 1 || confirmationSignal !== 'none'
          ? 'Some confirmations exist, but not a full stack.'
          : 'The trade idea is mostly anticipatory right now.',
    },
    {
      key: 'consensus',
      label: 'Model Consensus',
      weight: 12,
      score: dualChart ? 82 : setupQuality === 'high' ? 74 : setupQuality === 'medium' ? 60 : 45,
      summary: dualChart
        ? 'Higher-timeframe and lower-timeframe reads are aligned.'
        : setupQuality === 'high'
          ? 'The setup quality suggests strong internal model agreement.'
          : 'Consensus is acceptable, but not fully stacked.',
    },
  ];
};

export const buildConfidenceThermometer = (analysis: AnyAnalysis) => {
  const factors = buildConfidenceFactors(analysis);
  const weightedScore = Math.round(
    factors.reduce((total, factor) => total + (factor.score * factor.weight) / 100, 0)
  );
  const baseScore = getNumber(analysis.confidence);
  const score = clamp(baseScore !== null ? Math.round((weightedScore + baseScore) / 2) : weightedScore, 1, 99);
  const bucket = score >= 75 ? 'high' : score >= 55 ? 'medium' : 'low';

  return {
    score,
    bucket,
    summary:
      bucket === 'high'
        ? 'High-conviction setup with multiple aligned factors.'
        : bucket === 'medium'
          ? 'Tradable setup, but it still needs clean execution.'
          : 'Lower-confidence setup. Waiting for more confirmation is safer.',
    factors,
  };
};

const buildScenarioFrames = (start: number, checkpoints: number[]) => {
  const allPoints = [start, ...checkpoints];
  return allPoints.map((price, index) => ({
    step: index,
    price: Number(price.toFixed(6)),
  }));
};

export const buildTradeReplay = (analysis: AnyAnalysis) => {
  const entry = getReferenceEntryPrice(analysis) ?? getNumber(analysis.currentPrice) ?? 0;
  const stopLoss = getNumber(analysis.stopLoss) ?? getNumber(analysis.invalidationLevel) ?? entry;
  const takeProfit1 = getNumber(analysis.takeProfit1) ?? entry;
  const takeProfit2 = getNumber(analysis.takeProfit2) ?? takeProfit1;
  const takeProfit3 = getNumber(analysis.takeProfit3) ?? takeProfit2;
  const bullish = (typeof analysis.entryPlan?.bias === 'string' ? analysis.entryPlan.bias : analysis.trend) !== 'sell';
  const riskUnit = Math.max(Math.abs(entry - stopLoss), Math.abs(takeProfit1 - entry), Math.abs((entry || 1) * 0.0025), 1e-6);
  const confidence = clamp(getNumber(analysis.confidence) ?? 55, 20, 95);
  const continuationProbability = clamp(Math.round(confidence - 10 + (bullish ? 6 : 0)), 35, 70);
  const reactionProbability = clamp(Math.round((100 - continuationProbability) * 0.6), 15, 40);
  const invalidationProbability = Math.max(100 - continuationProbability - reactionProbability, 10);

  const continuationTarget = bullish ? Math.max(takeProfit2, takeProfit1, entry + riskUnit * 2.2) : Math.min(takeProfit2 || entry, takeProfit1 || entry, entry - riskUnit * 2.2);
  const reactionTarget = bullish ? Math.max(takeProfit1, entry + riskUnit * 1.1) : Math.min(takeProfit1 || entry, entry - riskUnit * 1.1);
  const failTarget = bullish ? Math.min(stopLoss, entry - riskUnit * 1.15) : Math.max(stopLoss, entry + riskUnit * 1.15);

  return {
    referenceEntry: entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    summary: bullish
      ? 'Bullish replay map focused on continuation, pullback reaction, and invalidation paths.'
      : 'Bearish replay map focused on continuation, pullback reaction, and invalidation paths.',
    scenarios: [
      {
        id: 'continuation',
        title: bullish ? 'Bullish Continuation' : 'Bearish Continuation',
        probability: continuationProbability,
        narrative: bullish
          ? 'Price respects the entry zone, reclaims flow, and expands into higher targets.'
          : 'Price rejects the entry zone, extends lower, and pushes into downside targets.',
        frames: buildScenarioFrames(entry, [
          bullish ? entry - riskUnit * 0.25 : entry + riskUnit * 0.25,
          bullish ? entry + riskUnit * 0.8 : entry - riskUnit * 0.8,
          continuationTarget,
          bullish ? Math.max(takeProfit3, continuationTarget) : Math.min(takeProfit3 || continuationTarget, continuationTarget),
        ]),
      },
      {
        id: 'reaction',
        title: bullish ? 'Dip Then Expand' : 'Pop Then Reject',
        probability: reactionProbability,
        narrative: bullish
          ? 'Price digs deeper into the zone before the move resolves upward.'
          : 'Price squeezes above the zone before sellers take control.',
        frames: buildScenarioFrames(entry, [
          bullish ? entry - riskUnit * 0.55 : entry + riskUnit * 0.55,
          bullish ? entry - riskUnit * 0.2 : entry + riskUnit * 0.2,
          reactionTarget,
          bullish ? reactionTarget - riskUnit * 0.18 : reactionTarget + riskUnit * 0.18,
        ]),
      },
      {
        id: 'invalidation',
        title: bullish ? 'Structure Fails' : 'Sellers Lose Control',
        probability: invalidationProbability,
        narrative: bullish
          ? 'Price never confirms and instead breaks the invalidation area.'
          : 'Price invalidates the sell thesis and squeezes through risk.',
        frames: buildScenarioFrames(entry, [
          bullish ? entry + riskUnit * 0.18 : entry - riskUnit * 0.18,
          failTarget,
          bullish ? failTarget - riskUnit * 0.12 : failTarget + riskUnit * 0.12,
        ]),
      },
    ],
  };
};

export const buildReactionChallengeResult = (analysis: AnyAnalysis, userEntry: number) => {
  const pair = typeof analysis.pair === 'string' ? analysis.pair : 'MARKET';
  const aiEntry = getReferenceEntryPrice(analysis) ?? userEntry;
  const stopLoss = getNumber(analysis.stopLoss) ?? getNumber(analysis.invalidationLevel);
  const takeProfit = getNumber(analysis.takeProfit1) ?? getNumber(analysis.takeProfit2) ?? getNumber(analysis.takeProfit3);
  const bias = typeof analysis.entryPlan?.bias === 'string' ? analysis.entryPlan.bias : analysis.trend === 'bearish' ? 'sell' : 'buy';
  const signedDelta = userEntry - aiEntry;
  const distance = Math.abs(signedDelta);
  const riskUnit = Math.max(Math.abs(aiEntry - (stopLoss ?? aiEntry)), Math.abs((aiEntry || 1) * 0.002), 1e-6);
  const normalized = distance / riskUnit;
  const score = clamp(Math.round(100 - normalized * 70), 8, 100);
  const timing = distance <= riskUnit * 0.12
    ? 'nearly exact'
    : bias === 'buy'
      ? userEntry < aiEntry ? 'early' : 'late'
      : userEntry > aiEntry ? 'early' : 'late';

  return {
    userEntry,
    aiEntry,
    stopLoss,
    takeProfit,
    score,
    distance,
    distanceLabel: describeDistance(pair, distance),
    timing,
    verdict:
      timing === 'nearly exact'
        ? 'Your timing matched the AI execution map closely.'
        : timing === 'early'
          ? 'You were aggressive versus the AI entry map.'
          : 'You waited longer than the AI entry map.',
    coaching:
      timing === 'nearly exact'
        ? 'Your entry timing was disciplined and close to the preferred liquidity zone.'
        : timing === 'early'
          ? 'The AI wanted deeper confirmation before entry. Waiting for the full zone tap would reduce heat.'
          : 'The AI entered earlier inside the zone. Waiting this long risks sacrificing reward-to-risk.',
  };
};