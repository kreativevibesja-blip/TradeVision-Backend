import { interpretSMC } from './smcInterpreter';
import { validateEntry } from './entryValidator';
import type { VisionAnalysisResult } from './visionAnalysis';

export interface TradeSignalResult {
  trend: VisionAnalysisResult['trend'];
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
  provider: 'gemini-vision+smc';
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
  if (rating === 'A') {
    return 'high';
  }
  if (rating === 'B') {
    return 'medium';
  }
  return 'low';
};

export function generateFinalSignal(aiData: VisionAnalysisResult, currentPrice: number): TradeSignalResult {
  const interpreted = interpretSMC(aiData);
  const confirmation = mapConfirmation(aiData.entryPlan.confirmation);
  const setupQuality = mapSetupQuality(aiData.quality.setupRating);
  const signalType = interpreted.signalType;
  const entryZone = aiData.entryPlan.entryZone;

  const shouldValidateEntry = signalType !== 'wait' && aiData.entryPlan.entryType !== 'none';
  const hasValidEntry = !shouldValidateEntry || validateEntry(entryZone, currentPrice);

  const finalSignalType = hasValidEntry ? signalType : 'wait';
  const finalRecommendation = hasValidEntry ? interpreted.recommendation : 'wait';
  const finalMessage = hasValidEntry ? interpreted.message : 'Price is not in a valid execution zone yet. Wait for price to reach a key area.';

  return {
    trend: aiData.trend,
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
    provider: 'gemini-vision+smc',
  };
}
