import type { VisionAnalysisResult } from './visionAnalysis';

export interface FilteredSignalResult extends VisionAnalysisResult {
  filterReason: string;
  filterFlags: string[];
}

const buildRecommendation = (signalType: FilteredSignalResult['signalType']) => {
  if (signalType === 'instant') {
    return 'setup ready';
  }

  if (signalType === 'pending') {
    return 'potential setup forming';
  }

  return 'wait';
};

export function filterTradeSignal(vision: VisionAnalysisResult): FilteredSignalResult {
  let signalType = vision.signalType;
  const filterFlags: string[] = [];

  if (vision.clarity === 'unclear') {
    signalType = 'wait';
    filterFlags.push('Chart clarity is too weak to support a valid trade plan.');
  }

  if (vision.bias === 'neutral') {
    signalType = 'wait';
    filterFlags.push('Directional bias is neutral, so no trade should be forced.');
  }

  if (vision.recommendation === 'wait') {
    signalType = 'wait';
    filterFlags.push('The AI recommendation does not justify an executable setup yet.');
  }

  if (signalType === 'instant' && vision.currentPriceRelation === 'far_from_zone') {
    signalType = 'pending';
    filterFlags.push('Current price is still far from the preferred trade location.');
  }

  if (signalType === 'instant' && vision.confirmationNeeded) {
    signalType = 'pending';
    filterFlags.push('Confirmation is still required before execution is valid.');
  }

  if (signalType === 'instant' && vision.clarity === 'mixed') {
    signalType = 'pending';
    filterFlags.push('Structure is mixed, so the setup is downgraded until it becomes cleaner.');
  }

  if (signalType === 'pending' && vision.currentPriceRelation === 'far_from_zone' && vision.clarity !== 'clear') {
    signalType = 'wait';
    filterFlags.push('Price is not near the zone and the structure is not clean enough to pre-plan execution.');
  }

  const filterReason =
    filterFlags.length > 0
      ? filterFlags.join(' ')
      : 'AI structure, price location, and confirmation state are aligned, so the setup can stay active.';

  return {
    ...vision,
    signalType,
    recommendation: buildRecommendation(signalType),
    filterReason,
    filterFlags,
  };
}