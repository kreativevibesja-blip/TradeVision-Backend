import { interpretSMC } from './smcInterpreter';
import { validateEntry } from './entryValidator';
import type { VisionAnalysisResult } from './visionAnalysis';

export interface TradeSignalResult {
  trend: VisionAnalysisResult['trend'];
  marketCondition?: VisionAnalysisResult['marketCondition'];
  primaryStrategy?: VisionAnalysisResult['primaryStrategy'];
  confirmations?: VisionAnalysisResult['confirmations'];
  structure: {
    state: VisionAnalysisResult['structure']['state'];
    bos: VisionAnalysisResult['structure']['bos'];
    choch: VisionAnalysisResult['structure']['choch'];
  };
  liquidity: {
    type: VisionAnalysisResult['liquidity']['type'];
    description: string;
    sweep: 'above highs' | 'below lows' | 'none';
    liquidityZones: string[];
  };
  zones: {
    supplyZone: VisionAnalysisResult['zones']['supply'];
    demandZone: VisionAnalysisResult['zones']['demand'];
  };
  pricePosition: VisionAnalysisResult['pricePosition'];
  currentPricePosition: VisionAnalysisResult['pricePosition']['location'];
  entryPlan: VisionAnalysisResult['entryPlan'];
  counterTrendPlan?: VisionAnalysisResult['counterTrendPlan'];
  leftSidePlan?: VisionAnalysisResult['leftSidePlan'];
  entryLogic: {
    type: 'reversal' | 'continuation' | 'none';
    entryZone: VisionAnalysisResult['entryPlan']['entryZone'];
    confirmationRequired: boolean;
    confirmationType: 'bos' | 'choch' | 'rejection' | 'none';
  };
  riskManagement: VisionAnalysisResult['riskManagement'];
  quality: VisionAnalysisResult['quality'];
  setupQuality: 'high' | 'medium' | 'low';
  finalVerdict: VisionAnalysisResult['finalVerdict'];
  signalType: 'wait' | 'pending' | 'instant';
  reasoning: string;
  currentPrice: number;
  entryZone: VisionAnalysisResult['entryPlan']['entryZone'];
  confirmation: 'bos' | 'choch' | 'rejection' | 'none';
  confirmationNeeded: boolean;
  message: string;
  recommendation: 'wait' | 'pending' | 'instant';
  confidence: number;
  invalidationLevel: number | null;
  invalidationReason: string;
  visiblePriceRange: { min: number; max: number } | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  provider: 'tradevision';
}

const sweepFromLiquidity = (type: VisionAnalysisResult['liquidity']['type']): 'above highs' | 'below lows' | 'none' => {
  if (type === 'buy-side') {
    return 'above highs';
  }
  if (type === 'sell-side') {
    return 'below lows';
  }
  return 'none';
};

const liquidityZonesFromDescription = (description: string) => {
  if (!description.trim()) {
    return [];
  }

  return [description.trim()];
};

const mapEntryType = (
  entryType: VisionAnalysisResult['entryPlan']['entryType'],
  bias: VisionAnalysisResult['entryPlan']['bias']
): 'reversal' | 'continuation' | 'none' => {
  if (entryType === 'none' || bias === 'none') {
    return 'none';
  }

  return entryType === 'confirmation' ? 'continuation' : 'reversal';
};

const mapConfirmation = (
  confirmation: VisionAnalysisResult['entryPlan']['confirmation']
): 'bos' | 'choch' | 'rejection' | 'none' => {
  if (confirmation === 'BOS') {
    return 'bos';
  }
  if (confirmation === 'CHoCH') {
    return 'choch';
  }
  if (confirmation === 'rejection') {
    return 'rejection';
  }

  return 'none';
};

const mapSetupQuality = (rating: VisionAnalysisResult['quality']['setupRating']): 'high' | 'medium' | 'low' => {
  if (rating === 'A+') {
    return 'high';
  }
  if (rating === 'B') {
    return 'medium';
  }
  return 'low';
};

const normalizeZoneBounds = (zone: VisionAnalysisResult['zones']['supply'] | VisionAnalysisResult['zones']['demand']) => {
  if (!zone || zone.min == null || zone.max == null) {
    return null;
  }

  return {
    low: Math.min(zone.min, zone.max),
    high: Math.max(zone.min, zone.max),
  };
};

const distanceToZone = (zone: { low: number; high: number } | null, currentPrice: number) => {
  if (!zone) {
    return Number.POSITIVE_INFINITY;
  }

  if (currentPrice < zone.low) {
    return zone.low - currentPrice;
  }

  if (currentPrice > zone.high) {
    return currentPrice - zone.high;
  }

  return 0;
};

const isLocationAligned = (aiData: VisionAnalysisResult) => {
  if (aiData.entryPlan.bias === 'buy') {
    return aiData.pricePosition.location !== 'premium';
  }

  if (aiData.entryPlan.bias === 'sell') {
    return aiData.pricePosition.location !== 'discount';
  }

  return false;
};

const hasWinningTradeConfluence = (aiData: VisionAnalysisResult, currentPrice: number) => {
  const bias = aiData.entryPlan.bias;
  if (bias === 'none') {
    return false;
  }

  const directionalZone = bias === 'buy'
    ? normalizeZoneBounds(aiData.zones.demand)
    : normalizeZoneBounds(aiData.zones.supply);
  const opposingZone = bias === 'buy'
    ? normalizeZoneBounds(aiData.zones.supply)
    : normalizeZoneBounds(aiData.zones.demand);
  const visibleRangeHeight = aiData.visiblePriceRange
    ? Math.abs(aiData.visiblePriceRange.max - aiData.visiblePriceRange.min)
    : 0;
  const target = aiData.takeProfit1;
  const proximityBuffer = Math.max((directionalZone ? Math.abs(directionalZone.high - directionalZone.low) : 0) * 0.75, visibleRangeHeight * 0.025, currentPrice * 0.0015);
  const directionalZoneDistance = distanceToZone(directionalZone, currentPrice);
  const targetBlocked = target != null && opposingZone
    ? bias === 'buy'
      ? opposingZone.low > currentPrice && opposingZone.low < target
      : opposingZone.high < currentPrice && opposingZone.high > target
    : false;
  const structureAligned = (bias === 'buy' && aiData.trend === 'bullish') || (bias === 'sell' && aiData.trend === 'bearish');
  const structureConfirmation = (bias === 'buy' && (aiData.structure.bos === 'bullish' || aiData.structure.choch === 'bullish'))
    || (bias === 'sell' && (aiData.structure.bos === 'bearish' || aiData.structure.choch === 'bearish'));
  const liquidityAligned = (bias === 'buy' && aiData.liquidity.type === 'sell-side') || (bias === 'sell' && aiData.liquidity.type === 'buy-side');
  const confirmationCount = [
    structureConfirmation,
    liquidityAligned,
    aiData.entryPlan.confirmation !== 'none',
    (aiData.confirmations?.length ?? 0) > 0,
  ].filter(Boolean).length;

  return structureAligned
    && isLocationAligned(aiData)
    && directionalZoneDistance <= proximityBuffer
    && confirmationCount >= 2
    && !targetBlocked;
};

const getBreathingRoom = (
  zone: { low: number; high: number } | null,
  visiblePriceRange: VisionAnalysisResult['visiblePriceRange'],
  referencePrice: number
) => {
  const zoneHeight = zone ? Math.abs(zone.high - zone.low) : 0;
  const visibleRangeHeight = visiblePriceRange ? Math.abs(visiblePriceRange.max - visiblePriceRange.min) : 0;
  const percentBuffer = Math.abs(referencePrice) * 0.0005;

  return Math.max(zoneHeight * 0.2, visibleRangeHeight * 0.0025, percentBuffer);
};

const withBufferedStopLoss = (
  bias: VisionAnalysisResult['entryPlan']['bias'],
  zones: VisionAnalysisResult['zones'],
  visiblePriceRange: VisionAnalysisResult['visiblePriceRange'],
  currentPrice: number,
  rawStopLoss: number | null,
  invalidationLevel: number | null
) => {
  const baseStopLoss = rawStopLoss ?? invalidationLevel;
  const demandZone = normalizeZoneBounds(zones.demand);
  const supplyZone = normalizeZoneBounds(zones.supply);

  if (bias === 'buy' && demandZone) {
    const breathingRoom = getBreathingRoom(demandZone, visiblePriceRange, currentPrice);
    const bufferedZoneStop = demandZone.low - breathingRoom;
    return baseStopLoss == null ? bufferedZoneStop : Math.min(baseStopLoss, bufferedZoneStop);
  }

  if (bias === 'sell' && supplyZone) {
    const breathingRoom = getBreathingRoom(supplyZone, visiblePriceRange, currentPrice);
    const bufferedZoneStop = supplyZone.high + breathingRoom;
    return baseStopLoss == null ? bufferedZoneStop : Math.max(baseStopLoss, bufferedZoneStop);
  }

  return baseStopLoss;
};

export function generateFinalSignal(aiData: VisionAnalysisResult, currentPrice: number): TradeSignalResult {
  const interpreted = interpretSMC(aiData);
  const confirmation = mapConfirmation(aiData.entryPlan.confirmation);
  const setupQuality = mapSetupQuality(aiData.quality.setupRating);
  const signalType = interpreted.signalType;
  const entryZone = aiData.entryPlan.entryZone;
  const stopLoss = withBufferedStopLoss(
    aiData.entryPlan.bias,
    aiData.zones,
    aiData.visiblePriceRange,
    currentPrice,
    aiData.stopLoss,
    aiData.riskManagement.invalidationLevel
  );

  const shouldValidateEntry = signalType !== 'wait' && aiData.entryPlan.entryType !== 'none';
  const hasValidEntry = !shouldValidateEntry || validateEntry(entryZone, currentPrice);
  const matchesWinningModel = !shouldValidateEntry || hasWinningTradeConfluence(aiData, currentPrice);

  const finalSignalType = hasValidEntry && matchesWinningModel ? signalType : 'wait';
  const finalRecommendation = hasValidEntry && matchesWinningModel ? interpreted.recommendation : 'wait';
  const finalMessage = hasValidEntry && matchesWinningModel
    ? interpreted.message
    : 'Wait for a fresh reaction from a clean POI with structure confirmation and clear target space before entering.';

  return {
    trend: aiData.trend,
    marketCondition: aiData.marketCondition,
    primaryStrategy: aiData.primaryStrategy ?? null,
    confirmations: aiData.confirmations ?? [],
    structure: aiData.structure,
    liquidity: {
      type: aiData.liquidity.type,
      description: aiData.liquidity.description,
      sweep: sweepFromLiquidity(aiData.liquidity.type),
      liquidityZones: liquidityZonesFromDescription(aiData.liquidity.description),
    },
    zones: {
      supplyZone: aiData.zones.supply,
      demandZone: aiData.zones.demand,
    },
    pricePosition: aiData.pricePosition,
    currentPricePosition: aiData.pricePosition.location,
    entryPlan: aiData.entryPlan,
    counterTrendPlan: aiData.counterTrendPlan ?? null,
    leftSidePlan: aiData.leftSidePlan ?? null,
    entryLogic: {
      type: mapEntryType(aiData.entryPlan.entryType, aiData.entryPlan.bias),
      entryZone: aiData.entryPlan.entryZone,
      confirmationRequired: aiData.entryPlan.entryType === 'confirmation',
      confirmationType: confirmation,
    },
    riskManagement: aiData.riskManagement,
    quality: aiData.quality,
    setupQuality,
    finalVerdict: aiData.finalVerdict,
    signalType: finalSignalType,
    reasoning: aiData.reasoning,
    currentPrice,
    entryZone,
    confirmation,
    confirmationNeeded: aiData.entryPlan.entryType === 'confirmation',
    message: finalMessage,
    recommendation: finalRecommendation,
    confidence: aiData.quality.confidence,
    invalidationLevel: aiData.riskManagement.invalidationLevel,
    invalidationReason: aiData.riskManagement.invalidationReason,
    visiblePriceRange: aiData.visiblePriceRange,
    stopLoss,
    takeProfit1: aiData.takeProfit1,
    takeProfit2: aiData.takeProfit2,
    takeProfit3: aiData.takeProfit3,
    provider: 'tradevision',
  };
}
