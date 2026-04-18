import type { TradeInput, MarketData, InvalidationResult } from './types';

const EXPIRY_MS = 20 * 60 * 1000;
const NO_CONFIRMATION_EXPIRY_MS = 15 * 60 * 1000;

export function getInvalidation(trade: TradeInput, market: MarketData): InvalidationResult {
  const price = market.currentPrice;
  const age = Date.now() - new Date(trade.createdAt).getTime();

  if (trade.invalidationLevel != null) {
    const broken = trade.direction === 'buy'
      ? price < trade.invalidationLevel
      : price > trade.invalidationLevel;

    if (broken) {
      return { isInvalid: true, reason: trade.invalidationReason || 'Structure broken — invalidation level breached' };
    }
  }

  const oppositeSLBreak = trade.direction === 'buy'
    ? price < trade.stopLoss
    : price > trade.stopLoss;

  if (oppositeSLBreak) {
    return { isInvalid: true, reason: 'Price has broken through stop loss level' };
  }

  if (age > EXPIRY_MS) {
    return { isInvalid: true, reason: 'Trade setup has expired (>20 min without entry)' };
  }

  if (trade.confirmation && trade.confirmation !== 'none' && age > NO_CONFIRMATION_EXPIRY_MS) {
    return { isInvalid: true, reason: 'No confirmation received within 15 minutes' };
  }

  return { isInvalid: false, reason: '' };
}
