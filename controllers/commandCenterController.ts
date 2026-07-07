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

/** Try to parse a number from various sources */
function toNum(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}

/** Extract numeric price levels from arrays, comma-separated strings, etc. */
function extractLevels(src: unknown): number[] {
  if (!src) return [];
  if (Array.isArray(src)) return src.map(toNum).filter((n): n is number => n !== null);
  if (typeof src === 'string') return src.split(/[,;|\s]+/).map(Number).filter(isFinite);
  return [];
}

function analysisToTradeInput(analysis: any): TradeInput | null {
  const raw = analysis.rawResponse && typeof analysis.rawResponse === 'object' ? analysis.rawResponse : {};

  // --- Direction: accept buy/sell/bullish/bearish/long/short ---
  const dirRaw = (
    raw.direction || raw.bias || raw.tradeDirection ||
    analysis.direction || analysis.bias || ''
  ).toString().toLowerCase().trim();
  let direction: 'buy' | 'sell' | null = null;
  if (dirRaw === 'buy' || dirRaw === 'bullish' || dirRaw === 'long') direction = 'buy';
  else if (dirRaw === 'sell' || dirRaw === 'bearish' || dirRaw === 'short') direction = 'sell';
  if (!direction) return null;

  // --- Entry: try structured zone, raw entry, currentPrice as fallback ---
  let entry = toNum(raw.entry) ?? toNum(analysis.entry) ?? toNum(raw.entryPrice) ?? toNum(analysis.currentPrice);

  const entryZoneObj = raw.entryZone || raw.entry_zone;
  if (!entry && entryZoneObj && typeof entryZoneObj === 'object') {
    const min = toNum(entryZoneObj.min) ?? toNum(entryZoneObj.low) ?? toNum(entryZoneObj.from);
    const max = toNum(entryZoneObj.max) ?? toNum(entryZoneObj.high) ?? toNum(entryZoneObj.to);
    if (min != null && max != null) entry = (min + max) / 2;
  }
  if (!entry) return null;

  // --- Stop Loss: try multiple sources, fall back to support/resistance ---
  let stopLoss = toNum(raw.stopLoss) ?? toNum(analysis.stopLoss) ?? toNum(raw.stop_loss);

  if (stopLoss == null) {
    const supports = extractLevels(raw.support || raw.supportLevels || raw.keyLevels?.support);
    const resistances = extractLevels(raw.resistance || raw.resistanceLevels || raw.keyLevels?.resistance);
    if (direction === 'buy' && supports.length > 0) {
      stopLoss = supports.filter((s) => s < entry!).sort((a, b) => b - a)[0] ?? null;
    } else if (direction === 'sell' && resistances.length > 0) {
      stopLoss = resistances.filter((r) => r > entry!).sort((a, b) => a - b)[0] ?? null;
    }
    // Last resort: 1% from entry
    if (stopLoss == null) stopLoss = direction === 'buy' ? entry * 0.99 : entry * 1.01;
  }

  // --- Take Profit: try multiple sources, fall back to 1:1 RR ---
  let tp1 = toNum(raw.takeProfit1) ?? toNum(raw.tp1) ?? toNum(analysis.tp1) ?? toNum(raw.takeProfit);
  const tp2 = toNum(raw.takeProfit2) ?? toNum(raw.tp2) ?? toNum(analysis.tp2) ?? null;
  const tp3 = toNum(raw.takeProfit3) ?? toNum(raw.tp3) ?? toNum(analysis.tp3) ?? null;

  if (tp1 == null) {
    const supports = extractLevels(raw.support || raw.supportLevels || raw.keyLevels?.support);
    const resistances = extractLevels(raw.resistance || raw.resistanceLevels || raw.keyLevels?.resistance);
    if (direction === 'buy' && resistances.length > 0) {
      tp1 = resistances.filter((r) => r > entry!).sort((a, b) => a - b)[0] ?? null;
    } else if (direction === 'sell' && supports.length > 0) {
      tp1 = supports.filter((s) => s < entry!).sort((a, b) => b - a)[0] ?? null;
    }
    // Last resort: 1:1 RR from SL distance
    if (tp1 == null) {
      const dist = Math.abs(entry - stopLoss);
      tp1 = direction === 'buy' ? entry + dist : entry - dist;
    }
  }

  const confidence = toNum(raw.confidence) ?? toNum(analysis.confidence) ?? 5;

  return {
    id: analysis.id,
    pair: analysis.pair || '',
    timeframe: analysis.timeframe || '',
    direction,
    entry,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3,
    confirmation: raw.confirmation || raw.entryLogic?.confirmation || '',
    invalidationLevel: toNum(raw.invalidationLevel) ?? null,
    invalidationReason: raw.invalidationReason ?? '',
    reasoning: raw.reasoning ?? analysis.explanation ?? '',
    confidence: confidence > 10 ? confidence / 10 : confidence,
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
