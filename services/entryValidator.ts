import type { SMCZone } from './visionAnalysis';

export function validateEntry(entryZone: SMCZone | null, currentPrice: number) {
  if (!entryZone || typeof entryZone.min !== 'number' || typeof entryZone.max !== 'number') {
    return false;
  }

  const zoneLow = Math.min(entryZone.min, entryZone.max);
  const zoneHigh = Math.max(entryZone.min, entryZone.max);
  const zoneSize = Math.abs(zoneHigh - zoneLow);
  const distanceToZone = currentPrice < zoneLow
    ? zoneLow - currentPrice
    : currentPrice > zoneHigh
      ? currentPrice - zoneHigh
      : 0;
  const proximityBuffer = Math.max(zoneSize * 0.5, currentPrice * 0.0015);

  return distanceToZone <= proximityBuffer;
}