import type { VisionAnalysisResult } from './visionAnalysis';

export interface InterpretedSMCResult extends VisionAnalysisResult {
  recommendation: 'wait' | 'pending' | 'instant';
  signalType: 'wait' | 'pending' | 'instant';
  confirmationNeeded: boolean;
  message: string;
}

export function interpretSMC(aiData: VisionAnalysisResult): InterpretedSMCResult {
  const structureUnclear = aiData.structure.state === 'transition';
  const inEquilibrium = aiData.pricePosition.location === 'equilibrium';
  const noBias = aiData.entryPlan.bias === 'none';
  const noEntry = aiData.entryPlan.entryType === 'none';
  const lowQuality = aiData.quality.setupRating === 'avoid';
  const waitingAction = aiData.finalVerdict.action === 'wait';
  const avoidAction = aiData.finalVerdict.action === 'avoid';
  const confirmationNeeded = aiData.entryPlan.entryType === 'confirmation';

  if (lowQuality || structureUnclear || avoidAction) {
    return {
      ...aiData,
      recommendation: 'wait',
      signalType: 'wait',
      confirmationNeeded: false,
      message: aiData.finalVerdict.message,
    };
  }

  if (inEquilibrium || noBias || noEntry || waitingAction) {
    return {
      ...aiData,
      recommendation: 'wait',
      signalType: 'wait',
      confirmationNeeded,
      message: aiData.finalVerdict.message,
    };
  }

  if (confirmationNeeded) {
    return {
      ...aiData,
      recommendation: 'pending',
      signalType: 'pending',
      confirmationNeeded: true,
      message: aiData.finalVerdict.message,
    };
  }

  return {
    ...aiData,
    recommendation: 'instant',
    signalType: 'instant',
    confirmationNeeded: false,
    message: aiData.finalVerdict.message,
  };
}
