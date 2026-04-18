import type { EntryZone, TradeInput, MarketData, TradeState } from './types';
import { calculateAtr } from './indicators';

export function computeEntryZone(trade: TradeInput, atr: number): EntryZone {
  const buffer = atr * 0.2;
  return {
    min: trade.entry - buffer,
    max: trade.entry + buffer,
  };
}

function priceInZone(price: number, zone: EntryZone): boolean {
  return price >= zone.min && price <= zone.max;
}

function confirmationsMet(trade: TradeInput): boolean {
  if (!trade.confirmation || trade.confirmation === 'none') return true;
  return trade.confirmation === 'rejection' || trade.confirmation === 'BOS' || trade.confirmation === 'CHoCH';
}

function hitTakeProfit(price: number, trade: TradeInput): boolean {
  if (trade.direction === 'buy') {
    return price >= trade.takeProfit1;
  }
  return price <= trade.takeProfit1;
}

function hitStopLoss(price: number, trade: TradeInput): boolean {
  if (trade.direction === 'buy') {
    return price <= trade.stopLoss;
  }
  return price >= trade.stopLoss;
}

function isInvalidated(price: number, trade: TradeInput): boolean {
  if (trade.invalidationLevel == null) return false;
  if (trade.direction === 'buy') {
    return price < trade.invalidationLevel;
  }
  return price > trade.invalidationLevel;
}

const TRADE_EXPIRY_MS = 20 * 60 * 1000;

export function getTradeState(trade: TradeInput, market: MarketData): TradeState {
  const atr = calculateAtr(market.candles);
  const zone = computeEntryZone(trade, atr);
  const price = market.currentPrice;
  const age = Date.now() - new Date(trade.createdAt).getTime();

  if (hitTakeProfit(price, trade) || hitStopLoss(price, trade)) {
    return 'CLOSED';
  }

  if (isInvalidated(price, trade)) {
    return 'INVALID';
  }

  if (age > TRADE_EXPIRY_MS && !priceInZone(price, zone)) {
    return 'INVALID';
  }

  if (priceInZone(price, zone)) {
    if (confirmationsMet(trade)) {
      return 'READY';
    }
    return 'WAIT';
  }

  const distanceToZone = trade.direction === 'buy'
    ? (zone.min - price) / (atr || 1)
    : (price - zone.max) / (atr || 1);

  if (distanceToZone < 0.3 && distanceToZone > -0.3) {
    return 'TRIGGERED';
  }

  return 'WAIT';
}
