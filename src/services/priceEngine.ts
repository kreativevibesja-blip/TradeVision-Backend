import { inferAssetClass, roundPrice } from '../utils/volatilityDetector';
import type { FilteredSignalResult } from './signalFilter';
import type { VisionAnalysisResult } from './visionAnalysis';

export interface PriceEngineResult {
  currentPrice: number;
  entry: number | null;
  entryZone: { low: number; high: number } | null;
  stopLoss: number | null;
  takeProfits: number[];
  riskReward: string | null;
  range: number;
  buffer: number;
  priceSource: 'manual';
  executionMode: 'market' | 'zone' | 'none';
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

const sortZone = (a: number, b: number) => ({ low: Math.min(a, b), high: Math.max(a, b) });

const getPendingZone = (currentPrice: number, range: number, buffer: number, bias: FilteredSignalResult['bias'], entryType: FilteredSignalResult['entryType']) => {
  const direction = bias === 'bearish' ? -1 : 1;
  const isRetest = entryType === 'pullback' || entryType === 'reversal';

  if (isRetest) {
    return sortZone(
      currentPrice - direction * range * 0.85,
      currentPrice - direction * buffer * 0.25
    );
  }

  return sortZone(
    currentPrice + direction * buffer * 0.25,
    currentPrice + direction * range * 0.8
  );
};

const getStopDistance = (entryType: FilteredSignalResult['entryType'], range: number) => {
  if (entryType === 'breakout') return range * 1.05;
  if (entryType === 'reversal') return range * 0.9;
  return range * 1.15;
};

export function buildPricePlan(currentPrice: number, pair: string, filtered: FilteredSignalResult): PriceEngineResult {
  const baseRange = currentPrice * 0.002;
  const range = roundPrice(baseRange * assetRangeMultiplier(pair) * trendRangeMultiplier(filtered.trendStrength), pair);
  const buffer = roundPrice(range * 0.3, pair);

  if (filtered.signalType === 'wait' || filtered.bias === 'neutral') {
    return {
      currentPrice,
      entry: null,
      entryZone: null,
      stopLoss: null,
      takeProfits: [],
      riskReward: null,
      range,
      buffer,
      priceSource: 'manual',
      executionMode: 'none',
    };
  }

  const direction = filtered.bias === 'bearish' ? -1 : 1;
  const stopDistance = getStopDistance(filtered.entryType, range);

  if (filtered.signalType === 'instant') {
    const entry = roundPrice(currentPrice, pair);
    const stopLoss = roundPrice(entry - stopDistance * direction, pair);
    const risk = Math.abs(entry - stopLoss);

    return {
      currentPrice,
      entry,
      entryZone: sortZone(entry - buffer * 0.2, entry + buffer * 0.2),
      stopLoss,
      takeProfits: [
        roundPrice(entry + risk * 1.5 * direction, pair),
        roundPrice(entry + risk * 2.25 * direction, pair),
      ],
      riskReward: '1:2.25',
      range,
      buffer,
      priceSource: 'manual',
      executionMode: 'market',
    };
  }

  const entryZone = getPendingZone(currentPrice, range, buffer, filtered.bias, filtered.entryType);
  const midpoint = roundPrice((entryZone.low + entryZone.high) / 2, pair);
  const stopLoss = roundPrice(midpoint - stopDistance * direction, pair);
  const risk = Math.abs(midpoint - stopLoss);

  return {
    currentPrice,
    entry: midpoint,
    entryZone: {
      low: roundPrice(entryZone.low, pair),
      high: roundPrice(entryZone.high, pair),
    },
    stopLoss,
    takeProfits: [
      roundPrice(midpoint + risk * 1.4 * direction, pair),
      roundPrice(midpoint + risk * 2 * direction, pair),
    ],
    riskReward: '1:2',
    range,
    buffer,
    priceSource: 'manual',
    executionMode: 'zone',
  };
}