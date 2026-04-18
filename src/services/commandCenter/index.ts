import type { TradeInput, MarketData, CommandCenterSnapshot } from './types';
import { getTradeState, computeEntryZone } from './tradeStateEngine';
import { getEntryTiming } from './entryTimingEngine';
import { getConfidence } from './confidenceEngine';
import { getInvalidation } from './invalidationEngine';
import { getLiveStatus } from './liveTrackingEngine';
import { getSltpGuidance } from './sltpGuidanceEngine';
import { calculateAtr } from './indicators';

const snapshotCache = new Map<string, { snapshot: CommandCenterSnapshot; ts: number }>();
const CACHE_TTL_MS = 2000;

export function computeSnapshot(trade: TradeInput, market: MarketData): CommandCenterSnapshot {
  const cacheKey = `${trade.id}-${Math.round(market.currentPrice * 100000)}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.snapshot;
  }

  const atr = calculateAtr(market.candles);
  const entryZone = computeEntryZone(trade, atr);
  const state = getTradeState(trade, market);
  const confidence = getConfidence(trade, market);
  const timing = getEntryTiming(trade, market);
  const sltp = getSltpGuidance(trade);
  const invalidation = getInvalidation(trade, market);
  const liveStatus = getLiveStatus(trade, market, entryZone);

  const snapshot: CommandCenterSnapshot = {
    trade,
    state: invalidation.isInvalid ? 'INVALID' : state,
    entryZone,
    confidence,
    timing,
    sltp,
    liveStatus,
    invalidation,
    currentPrice: market.currentPrice,
    updatedAt: new Date().toISOString(),
  };

  snapshotCache.set(cacheKey, { snapshot, ts: Date.now() });

  if (snapshotCache.size > 500) {
    const oldest = [...snapshotCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) {
      snapshotCache.delete(oldest[i][0]);
    }
  }

  return snapshot;
}
