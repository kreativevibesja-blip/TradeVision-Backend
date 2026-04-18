import { randomUUID } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createTrackedTrade,
  getTrackedTradesForUser,
  countActiveTrackedTrades,
  deleteTrackedTrade,
  getAnalysisByIdForUser,
  type TrackedTradeRecord,
} from '../lib/supabase';

const MAX_ACTIVE_TRADES = 5;
const DEFAULT_EXPIRY_MS = 60 * 60 * 1000; // 60 minutes

/** Try to parse a number from various sources */
function toNum(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (isFinite(n)) return n;
  }
  return null;
}

function extractTradeData(analysis: any): {
  symbol: string;
  direction: 'buy' | 'sell';
  entryZoneMin: number;
  entryZoneMax: number;
  stopLoss: number;
  takeProfit1: number;
  confidence: number;
  conditions: string[];
} | null {
  const raw = analysis.rawResponse && typeof analysis.rawResponse === 'object' ? analysis.rawResponse : {};

  // --- Direction: try many sources ---
  const dirRaw = (
    raw.direction || raw.bias || raw.tradeDirection ||
    analysis.direction || analysis.bias || ''
  ).toString().toLowerCase().trim();
  let direction: 'buy' | 'sell' | null = null;
  if (dirRaw === 'buy' || dirRaw === 'bullish' || dirRaw === 'long') direction = 'buy';
  else if (dirRaw === 'sell' || dirRaw === 'bearish' || dirRaw === 'short') direction = 'sell';
  if (!direction) return null;

  // --- Entry: try structured zone, raw entry, top-level entry, currentPrice as fallback ---
  const entryZoneObj = raw.entryZone || raw.entry_zone;
  let entryZoneMin: number | null = null;
  let entryZoneMax: number | null = null;

  if (entryZoneObj && typeof entryZoneObj === 'object') {
    entryZoneMin = toNum(entryZoneObj.min) ?? toNum(entryZoneObj.low) ?? toNum(entryZoneObj.from);
    entryZoneMax = toNum(entryZoneObj.max) ?? toNum(entryZoneObj.high) ?? toNum(entryZoneObj.to);
  }
  if (typeof entryZoneObj === 'string') {
    const parts = entryZoneObj.replace(/[^0-9.\-,–]/g, ' ').split(/[\s,–-]+/).map(Number).filter(isFinite);
    if (parts.length >= 2) {
      entryZoneMin = Math.min(...parts);
      entryZoneMax = Math.max(...parts);
    }
  }

  const entry = toNum(raw.entry) ?? toNum(analysis.entry) ?? toNum(raw.entryPrice) ?? toNum(analysis.currentPrice);

  // Build entry zone from single entry if not found from zone object
  if (entryZoneMin == null || entryZoneMax == null) {
    if (entry == null) return null;
    // Use SL distance for buffer, or 0.3% of price as fallback
    const sl = toNum(raw.stopLoss) ?? toNum(analysis.stopLoss);
    const buffer = sl != null ? Math.abs(entry - sl) * 0.15 : entry * 0.003;
    entryZoneMin = entry - buffer;
    entryZoneMax = entry + buffer;
  }

  // --- Stop Loss: optional but preferred ---
  const stopLoss = toNum(raw.stopLoss) ?? toNum(analysis.stopLoss) ?? toNum(raw.stop_loss);

  // --- Take Profit: optional but preferred ---
  const tp1 = toNum(raw.takeProfit1) ?? toNum(raw.tp1) ?? toNum(analysis.tp1) ?? toNum(raw.takeProfit);
  const tp2 = toNum(raw.takeProfit2) ?? toNum(raw.tp2) ?? toNum(analysis.tp2);

  // We need at least an entry zone. SL and TP are nice to have but not strictly required.
  const bestTp = tp1 ?? tp2;
  const bestSl = stopLoss;

  // If we have no SL and no TP, use support/resistance from analysis to derive them
  const supports = extractLevels(raw.support || raw.supportLevels || raw.keyLevels?.support);
  const resistances = extractLevels(raw.resistance || raw.resistanceLevels || raw.keyLevels?.resistance);
  const midEntry = (entryZoneMin + entryZoneMax) / 2;

  let finalSl = bestSl;
  let finalTp = bestTp;

  if (finalSl == null) {
    // For buys, SL is below entry; for sells, above
    if (direction === 'buy' && supports.length > 0) {
      finalSl = supports.filter((s) => s < midEntry).sort((a, b) => b - a)[0] ?? null;
    } else if (direction === 'sell' && resistances.length > 0) {
      finalSl = resistances.filter((r) => r > midEntry).sort((a, b) => a - b)[0] ?? null;
    }
    // Last resort: 1% from entry
    if (finalSl == null) finalSl = direction === 'buy' ? midEntry * 0.99 : midEntry * 1.01;
  }

  if (finalTp == null) {
    if (direction === 'buy' && resistances.length > 0) {
      finalTp = resistances.filter((r) => r > midEntry).sort((a, b) => a - b)[0] ?? null;
    } else if (direction === 'sell' && supports.length > 0) {
      finalTp = supports.filter((s) => s < midEntry).sort((a, b) => b - a)[0] ?? null;
    }
    // Last resort: 1:1 RR from SL
    if (finalTp == null) {
      const dist = Math.abs(midEntry - finalSl);
      finalTp = direction === 'buy' ? midEntry + dist : midEntry - dist;
    }
  }

  // --- Confidence ---
  const confidence = toNum(raw.confidence) ?? toNum(analysis.confidence) ?? 5;
  const normalizedConfidence = confidence > 10 ? confidence / 10 : confidence;

  // --- Conditions: gather from many possible sources ---
  const conditions: string[] = [];
  if (raw.confirmation) conditions.push(String(raw.confirmation));
  if (raw.entryLogic?.confirmation) conditions.push(String(raw.entryLogic.confirmation));
  if (raw.structure?.bos && raw.structure.bos !== 'none') conditions.push(`BOS: ${raw.structure.bos}`);
  if (raw.structure?.choch && raw.structure.choch !== 'none') conditions.push(`CHoCH: ${raw.structure.choch}`);
  if (raw.liquidity?.sweep) conditions.push(`Liquidity: ${raw.liquidity.sweep}`);
  if (raw.primaryStrategy) conditions.push(String(raw.primaryStrategy));
  if (raw.marketCondition) conditions.push(String(raw.marketCondition));
  if (analysis.strategy) conditions.push(String(analysis.strategy));
  if (raw.recommendation) conditions.push(String(raw.recommendation));
  // Always have at least one condition — use bias as fallback
  if (conditions.length === 0) conditions.push(`${direction === 'buy' ? 'Bullish' : 'Bearish'} bias`);

  return {
    symbol: analysis.pair || '',
    direction,
    entryZoneMin,
    entryZoneMax,
    stopLoss: finalSl,
    takeProfit1: finalTp,
    confidence: normalizedConfidence,
    conditions,
  };
}

/** Extract numeric price levels from various formats (array, comma string, etc.) */
function extractLevels(src: unknown): number[] {
  if (!src) return [];
  if (Array.isArray(src)) return src.map(toNum).filter((n): n is number => n !== null);
  if (typeof src === 'string') {
    return src.split(/[,;|\s]+/).map(Number).filter(isFinite);
  }
  return [];
}

export const addToRadar = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { tradeId } = req.body;

    if (!tradeId || typeof tradeId !== 'string') {
      return res.status(400).json({ error: 'tradeId is required' });
    }

    const analysis = await getAnalysisByIdForUser(tradeId, userId);
    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    const data = extractTradeData(analysis);
    if (!data) {
      return res.status(400).json({ error: 'Analysis does not contain a clear directional bias (bullish/bearish)' });
    }

    if (!data.symbol) {
      return res.status(400).json({ error: 'Analysis is missing a trading pair/symbol' });
    }

    const activeCount = await countActiveTrackedTrades(userId);
    if (activeCount >= MAX_ACTIVE_TRADES) {
      return res.status(400).json({ error: `Maximum ${MAX_ACTIVE_TRADES} active tracked trades allowed` });
    }

    const now = new Date();
    const record: Omit<TrackedTradeRecord, 'updatedAt'> = {
      id: randomUUID(),
      userId,
      analysisId: tradeId,
      symbol: data.symbol,
      direction: data.direction,
      entryZoneMin: data.entryZoneMin,
      entryZoneMax: data.entryZoneMax,
      stopLoss: data.stopLoss,
      takeProfit1: data.takeProfit1,
      confidence: data.confidence,
      conditions: data.conditions,
      state: 'TRACKING',
      expiresAt: new Date(now.getTime() + DEFAULT_EXPIRY_MS).toISOString(),
      createdAt: now.toISOString(),
    };

    const tracked = await createTrackedTrade(record);
    return res.json({ tracked });
  } catch (error) {
    console.error('Add to radar error:', error);
    return res.status(500).json({ error: 'Failed to add trade to radar' });
  }
};

export const getRadar = async (req: AuthRequest, res: Response) => {
  try {
    const trades = await getTrackedTradesForUser(req.user!.id);
    return res.json({ trades });
  } catch (error) {
    console.error('Get radar error:', error);
    return res.status(500).json({ error: 'Failed to load radar' });
  }
};

export const removeFromRadar = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Trade ID is required' });
    }
    await deleteTrackedTrade(id, req.user!.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('Remove from radar error:', error);
    return res.status(500).json({ error: 'Failed to remove trade from radar' });
  }
};
