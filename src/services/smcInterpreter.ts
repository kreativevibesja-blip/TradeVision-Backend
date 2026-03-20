import type { SMCZone, VisionAnalysisResult } from './visionAnalysis';

export interface InterpretedSMCResult extends VisionAnalysisResult {
  entryZone: SMCZone | null;
  confirmation: VisionAnalysisResult['entryLogic']['confirmationType'];
  reason?: string;
}

export function interpretSMC(aiData: VisionAnalysisResult, currentPrice: number): InterpretedSMCResult {
  const {
    trend,
    structure,
    liquidity,
    zones,
    entryLogic,
    setupQuality,
    signalType,
  } = aiData;

  if (setupQuality === 'low') {
    return {
      ...aiData,
      signalType: 'wait',
      entryZone: null,
      confirmation: 'none',
      reason: 'Low quality structure',
    };
  }

  if (trend === 'ranging' || signalType === 'wait' || entryLogic.type === 'none') {
    return {
      ...aiData,
      signalType: 'wait',
      entryZone: null,
      confirmation: 'none',
      reason: 'No clean SMC structure yet',
    };
  }

  if (entryLogic.type === 'reversal' && liquidity.sweep === 'none') {
    return {
      ...aiData,
      signalType: 'wait',
      entryZone: null,
      confirmation: 'none',
      reason: 'No liquidity sweep detected',
    };
  }

  if (entryLogic.confirmationRequired) {
    return {
      ...aiData,
      signalType: 'pending',
      entryZone: entryLogic.entryZone,
      confirmation: entryLogic.confirmationType,
      reason: 'Confirmation required before entry',
    };
  }

  return {
    ...aiData,
    signalType,
    entryZone: entryLogic.entryZone,
    confirmation: entryLogic.confirmationType,
    reason: 'SMC structure is aligned',
  };
}