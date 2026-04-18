import type { TradeInput, SltpGuidance } from './types';

export function getSltpGuidance(trade: TradeInput): SltpGuidance {
  const pips = Math.abs(trade.entry - trade.stopLoss);
  const direction = trade.direction === 'buy' ? 'below' : 'above';

  const slInstruction = `Place stop loss ${direction} ${trade.stopLoss.toFixed(5)} (${pips.toFixed(1)} pips from entry)`;

  const tpLevels: { label: string; price: number }[] = [
    { label: 'TP1', price: trade.takeProfit1 },
  ];

  if (trade.takeProfit2 != null) {
    tpLevels.push({ label: 'TP2', price: trade.takeProfit2 });
  }
  if (trade.takeProfit3 != null) {
    tpLevels.push({ label: 'TP3', price: trade.takeProfit3 });
  }

  return { slInstruction, tpLevels };
}
