import { interpretSMC } from './smcInterpreter';
import { validateEntry } from './entryValidator';
import type { VisionAnalysisResult } from './visionAnalysis';

export interface TradeSignalResult {
  trend: VisionAnalysisResult['trend'];
  structure: VisionAnalysisResult['structure'];
  liquidity: VisionAnalysisResult['liquidity'];
  zones: VisionAnalysisResult['zones'];
  currentPricePosition: VisionAnalysisResult['currentPricePosition'];
  entryLogic: VisionAnalysisResult['entryLogic'];
  setupQuality: VisionAnalysisResult['setupQuality'];
  signalType: VisionAnalysisResult['signalType'];
  reasoning: string;
  currentPrice: number;
  entryZone: VisionAnalysisResult['entryLogic']['entryZone'];
  confirmation: VisionAnalysisResult['entryLogic']['confirmationType'];
  confirmationNeeded: boolean;
  message: string;
  recommendation: 'wait' | 'pending' | 'instant';
  confidence: number;
  provider: 'gemini-vision+smc';
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildConfidence = (aiData: VisionAnalysisResult, signalType: TradeSignalResult['signalType']) => {
  let confidence = 35;

  if (aiData.setupQuality === 'high') confidence += 28;
  if (aiData.setupQuality === 'medium') confidence += 14;
  if (aiData.structure.bos !== 'none') confidence += 10;
  if (aiData.structure.choch !== 'none') confidence += 8;
  if (aiData.liquidity.sweep !== 'none') confidence += 10;
  if (aiData.currentPricePosition !== 'equilibrium') confidence += 5;
  if (signalType === 'pending') confidence -= 8;
  if (signalType === 'wait') confidence -= 22;

  return clamp(confidence, 15, 95);
};

export function generateFinalSignal(aiData: VisionAnalysisResult, currentPrice: number): TradeSignalResult {
  const interpreted = interpretSMC(aiData, currentPrice);

  if (interpreted.signalType === 'wait') {
    return {
      trend: aiData.trend,
      structure: aiData.structure,
      liquidity: aiData.liquidity,
      zones: aiData.zones,
      currentPricePosition: aiData.currentPricePosition,
      entryLogic: aiData.entryLogic,
      setupQuality: aiData.setupQuality,
      signalType: 'wait',
      reasoning: aiData.reasoning,
      currentPrice,
      entryZone: null,
      confirmation: 'none',
      confirmationNeeded: aiData.entryLogic.confirmationRequired,
      message: interpreted.reason || 'No valid setup. Wait for better structure.',
      recommendation: 'wait',
      confidence: buildConfidence(aiData, 'wait'),
      provider: 'gemini-vision+smc',
    };
  }

  const isValid = validateEntry(interpreted.entryZone, currentPrice);

  if (!isValid) {
    return {
      trend: aiData.trend,
      structure: aiData.structure,
      liquidity: aiData.liquidity,
      zones: aiData.zones,
      currentPricePosition: aiData.currentPricePosition,
      entryLogic: aiData.entryLogic,
      setupQuality: aiData.setupQuality,
      signalType: 'wait',
      reasoning: aiData.reasoning,
      currentPrice,
      entryZone: interpreted.entryZone,
      confirmation: interpreted.confirmation,
      confirmationNeeded: aiData.entryLogic.confirmationRequired,
      message: 'Entry too close to current price',
      recommendation: 'wait',
      confidence: buildConfidence(aiData, 'wait'),
      provider: 'gemini-vision+smc',
    };
  }

  return {
    trend: aiData.trend,
    structure: aiData.structure,
    liquidity: aiData.liquidity,
    zones: aiData.zones,
    currentPricePosition: aiData.currentPricePosition,
    entryLogic: aiData.entryLogic,
    setupQuality: aiData.setupQuality,
    signalType: interpreted.signalType,
    reasoning: aiData.reasoning,
    currentPrice,
    entryZone: interpreted.entryZone,
    confirmation: interpreted.confirmation,
    confirmationNeeded: aiData.entryLogic.confirmationRequired,
    message: interpreted.signalType === 'pending' ? 'Wait for confirmation before entry' : 'Structure aligned. Manage execution with discipline.',
    recommendation: interpreted.signalType === 'instant' ? 'instant' : 'pending',
    confidence: buildConfidence(aiData, interpreted.signalType),
    provider: 'gemini-vision+smc',
  };
}