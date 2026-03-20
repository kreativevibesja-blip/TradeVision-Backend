import type { SMCZone } from './visionAnalysis';

export function validateEntry(entryZone: SMCZone | null, currentPrice: number) {
  if (!entryZone || typeof entryZone.min !== 'number' || typeof entryZone.max !== 'number') {
    return false;
  }

  const mid = (entryZone.min + entryZone.max) / 2;
  const distance = Math.abs(mid - currentPrice);

  const MIN_DISTANCE = currentPrice * 0.002;

  return distance >= MIN_DISTANCE;
}