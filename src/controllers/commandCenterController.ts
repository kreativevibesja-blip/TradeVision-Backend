import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getAnalysisByIdForUser } from '../lib/supabase';
import { computeSnapshot } from '../services/commandCenter';
import type { TradeInput, CommandCenterCandle } from '../services/commandCenter/types';

function parseCandles(raw: unknown): CommandCenterCandle[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === 'object' && typeof c.close === 'number')
    .map((c) => ({
      time: Number(c.time ?? c.timestamp ?? 0),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
}

function analysisToTradeInput(analysis: any): TradeInput | null {
  const raw = analysis.rawResponse && typeof analysis.rawResponse === 'object' ? analysis.rawResponse : {};

  const direction = (raw.direction || analysis.direction || '').toLowerCase();
  if (direction !== 'buy' && direction !== 'sell') return null;

  const entry = raw.entry ?? analysis.entry;
  const stopLoss = raw.stopLoss ?? analysis.stopLoss;
  const tp1 = raw.takeProfit1 ?? raw.tp1 ?? analysis.tp1;

  if (typeof entry !== 'number' || typeof stopLoss !== 'number' || typeof tp1 !== 'number') return null;

  return {
    id: analysis.id,
    pair: analysis.pair || '',
    timeframe: analysis.timeframe || '',
    direction,
    entry,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: raw.takeProfit2 ?? raw.tp2 ?? analysis.tp2 ?? null,
    takeProfit3: raw.takeProfit3 ?? raw.tp3 ?? analysis.tp3 ?? null,
    confirmation: raw.confirmation || raw.entryLogic?.confirmation || '',
    invalidationLevel: raw.invalidationLevel ?? null,
    invalidationReason: raw.invalidationReason ?? '',
    reasoning: raw.reasoning ?? analysis.explanation ?? '',
    confidence: raw.confidence ?? analysis.confidence ?? 5,
    marketCondition: raw.marketCondition ?? '',
    primaryStrategy: raw.primaryStrategy ?? '',
    structure: raw.structure ?? undefined,
    liquidity: raw.liquidity ?? undefined,
    createdAt: analysis.createdAt || analysis.created_at || new Date().toISOString(),
  };
}

export const getCommandCenter = async (req: AuthRequest, res: Response) => {
  try {
    const analysis = await getAnalysisByIdForUser(req.params.id, req.user!.id);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const trade = analysisToTradeInput(analysis);
    if (!trade) {
      return res.status(400).json({ error: 'This analysis does not have enough trade data for the Command Center' });
    }

    const priceParam = parseFloat(req.query.currentPrice as string);
    const currentPrice = Number.isFinite(priceParam) && priceParam > 0
      ? priceParam
      : (analysis as any).currentPrice ?? trade.entry;

    const candles = parseCandles(req.query.candles || (analysis as any).candles || []);

    const fallbackCandles: CommandCenterCandle[] = candles.length >= 5
      ? candles
      : Array.from({ length: 20 }, (_, i) => ({
          time: Date.now() - (20 - i) * 60000,
          open: currentPrice * (1 + (Math.random() - 0.5) * 0.001),
          high: currentPrice * (1 + Math.random() * 0.001),
          low: currentPrice * (1 - Math.random() * 0.001),
          close: currentPrice * (1 + (Math.random() - 0.5) * 0.001),
        }));

    const market = { currentPrice, candles: fallbackCandles, timestamp: Date.now() };
    const snapshot = computeSnapshot(trade, market);

    return res.json({ commandCenter: snapshot });
  } catch (error) {
    console.error('Command Center error:', error);
    return res.status(500).json({ error: 'Failed to compute Command Center data' });
  }
};
