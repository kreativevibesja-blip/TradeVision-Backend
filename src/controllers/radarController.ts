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

const MIN_CONFIDENCE = 7.5;
const MAX_ACTIVE_TRADES = 5;
const DEFAULT_EXPIRY_MS = 60 * 60 * 1000; // 60 minutes

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

  const direction = (raw.direction || analysis.direction || '').toLowerCase();
  if (direction !== 'buy' && direction !== 'sell') return null;

  const entry = raw.entry ?? analysis.entry;
  const stopLoss = raw.stopLoss ?? analysis.stopLoss;
  const tp1 = raw.takeProfit1 ?? raw.tp1 ?? analysis.tp1;
  if (typeof entry !== 'number' || typeof stopLoss !== 'number' || typeof tp1 !== 'number') return null;

  const confidence = raw.confidence ?? analysis.confidence ?? 0;
  const normalizedConfidence = confidence > 10 ? confidence / 10 : confidence;

  const atrBuffer = Math.abs(entry - stopLoss) * 0.15;
  const entryZoneMin = entry - atrBuffer;
  const entryZoneMax = entry + atrBuffer;

  const conditions: string[] = [];
  if (raw.confirmation) conditions.push(raw.confirmation);
  if (raw.entryLogic?.confirmation) conditions.push(raw.entryLogic.confirmation);
  if (raw.structure?.bos && raw.structure.bos !== 'none') conditions.push(`BOS: ${raw.structure.bos}`);
  if (raw.structure?.choch && raw.structure.choch !== 'none') conditions.push(`CHoCH: ${raw.structure.choch}`);
  if (raw.liquidity?.sweep) conditions.push(`Liquidity: ${raw.liquidity.sweep}`);
  if (conditions.length === 0 && raw.primaryStrategy) conditions.push(raw.primaryStrategy);

  return {
    symbol: analysis.pair || '',
    direction,
    entryZoneMin,
    entryZoneMax,
    stopLoss,
    takeProfit1: tp1,
    confidence: normalizedConfidence,
    conditions,
  };
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
      return res.status(400).json({ error: 'Analysis does not contain valid trade data' });
    }

    if (data.confidence < MIN_CONFIDENCE) {
      return res.status(400).json({ error: `Confidence too low (${data.confidence.toFixed(1)}). Minimum is ${MIN_CONFIDENCE}.` });
    }

    if (data.conditions.length === 0) {
      return res.status(400).json({ error: 'No trade conditions found in this analysis' });
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
