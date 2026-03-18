import { inferAssetClass, roundPrice } from '../utils/volatilityDetector';
import type { VisionAnalysisResult } from './visionAnalysis';

export interface AnchoredPriceResult {
  currentPrice: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  riskReward: string | null;
  range: number;
  buffer: number;
  priceSource: 'manual';
  shouldWait: boolean;
}

const assetRangeMultiplier = (pair: string) => {
  const assetClass = inferAssetClass(pair);

  if (assetClass === 'synthetic') return 1.8;
  if (assetClass === 'crypto') return 1.5;
  if (assetClass === 'indices') return 1.2;
  return 1;
};

const trendRangeMultiplier = (trendStrength: VisionAnalysisResult['trendStrength']) => {
  if (trendStrength === 'strong') return 1.25;
  if (trendStrength === 'moderate') return 1;
  return 0.8;
};

const getEntryOffset = (entryType: VisionAnalysisResult['entryType'], buffer: number) => {
  if (entryType === 'breakout') return buffer;
  if (entryType === 'reversal') return buffer * 0.2;
  return buffer * 0.35;
};

const getStopDistance = (entryType: VisionAnalysisResult['entryType'], range: number) => {
  if (entryType === 'breakout') return range * 1.1;
  if (entryType === 'reversal') return range * 0.9;
  return range * 1.25;
};

export function anchorTradeLevels(currentPrice: number, pair: string, vision: VisionAnalysisResult): AnchoredPriceResult {
  const baseRange = currentPrice * 0.002;
  const range = roundPrice(baseRange * assetRangeMultiplier(pair) * trendRangeMultiplier(vision.trendStrength), pair);
  const buffer = roundPrice(range * 0.3, pair);

  const shouldWait =
    vision.bias === 'neutral' ||
    vision.recommendation === 'wait' ||
    vision.clarity === 'unclear';

  if (shouldWait) {
    return {
      currentPrice,
      entry: null,
      stopLoss: null,
      takeProfits: [],
      riskReward: null,
      range,
      buffer,
      priceSource: 'manual',
      shouldWait: true,
    };
  }

  const entryOffset = getEntryOffset(vision.entryType, buffer);
  const stopDistance = getStopDistance(vision.entryType, range);

  const direction = vision.bias === 'bearish' ? -1 : 1;
  const isPullback = vision.entryType === 'pullback';
  const signedEntryOffset = isPullback ? entryOffset * -direction : entryOffset * direction;
  const entry = roundPrice(currentPrice + signedEntryOffset, pair);
  const stopLoss = roundPrice(entry - stopDistance * direction, pair);
  const risk = Math.abs(entry - stopLoss);
  const takeProfits = [
    roundPrice(entry + risk * 1.5 * direction, pair),
    roundPrice(entry + risk * 2 * direction, pair),
  ];

  return {
    currentPrice,
    entry,
    stopLoss,
    takeProfits,
    riskReward: '1:2',
    range,
    buffer,
    priceSource: 'manual',
    shouldWait: false,
  };
}