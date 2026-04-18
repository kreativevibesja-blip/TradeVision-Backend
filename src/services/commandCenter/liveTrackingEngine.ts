import type { TradeInput, MarketData, LiveStatusMessage, EntryZone } from './types';
import { calculateAtr } from './indicators';

export function getLiveStatus(
  trade: TradeInput,
  market: MarketData,
  entryZone: EntryZone,
): LiveStatusMessage {
  const price = market.currentPrice;
  const atr = calculateAtr(market.candles);
  const buffer = atr * 0.3;

  const inZone = price >= entryZone.min && price <= entryZone.max;
  const nearZone = price >= entryZone.min - buffer && price <= entryZone.max + buffer;

  if (inZone) {
    if (trade.confirmation && trade.confirmation !== 'none') {
      return 'wait for confirmation';
    }
    return 'price in entry zone';
  }

  if (nearZone) {
    return 'approaching entry';
  }

  const distToTP1 = Math.abs(price - trade.takeProfit1);
  const distToSL = Math.abs(price - trade.stopLoss);

  if (atr > 0 && distToTP1 / atr < 0.5) {
    return 'approaching TP';
  }

  if (atr > 0 && distToSL / atr < 0.5) {
    return 'exit warning';
  }

  const recentCandles = market.candles.slice(-3);
  if (recentCandles.length >= 3) {
    const allInDirection = trade.direction === 'buy'
      ? recentCandles.every((c) => c.close > c.open)
      : recentCandles.every((c) => c.close < c.open);

    if (allInDirection) return 'momentum strong';

    const allAgainst = trade.direction === 'buy'
      ? recentCandles.every((c) => c.close < c.open)
      : recentCandles.every((c) => c.close > c.open);

    if (allAgainst) return 'momentum fading';
  }

  return 'watching structure';
}
