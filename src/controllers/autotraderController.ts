import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  createTradeSignal,
  getTradeSignalById,
  listTradeSignalsForUser,
  listPendingSignalsForUser,
  updateTradeSignal,
  confirmSignalExecution,
  cancelTradeSignal,
  countTodayExecutedSignals,
  getRiskSettings,
  upsertRiskSettings,
  toggleKillSwitch,
  SignalDirection,
  SignalConfidence,
  SignalMarketState,
  SignalStatus,
} from '../lib/supabase';

// ── Trade Signals ──

export const createSignal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const riskSettings = await getRiskSettings(userId);

    if (riskSettings?.killSwitch) {
      return res.status(403).json({ error: 'Kill switch is active. Trading is disabled.' });
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    if (riskSettings) {
      const todayCount = await countTodayExecutedSignals(userId, todayStart.toISOString());
      if (todayCount >= riskSettings.maxTradesPerDay) {
        return res.status(403).json({ error: `Daily trade limit reached (${riskSettings.maxTradesPerDay})` });
      }
    }

    const { symbol, direction, entryPrice, stopLoss, takeProfit, confidence, analysisId, lotSize, label, marketState, strategy, score, confirmations, explanation } = req.body ?? {};
    if (!symbol || !direction || entryPrice == null || stopLoss == null || takeProfit == null) {
      return res.status(400).json({ error: 'symbol, direction, entryPrice, stopLoss, takeProfit are required' });
    }

    const validDirections: SignalDirection[] = ['buy', 'sell'];
    const validMarketStates: SignalMarketState[] = ['trending', 'ranging', 'choppy', 'reversal'];
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: 'direction must be buy or sell' });
    }
    if (marketState != null && !validMarketStates.includes(marketState)) {
      return res.status(400).json({ error: 'marketState must be trending, ranging, choppy, or reversal' });
    }

    const signal = await createTradeSignal({
      userId,
      symbol: String(symbol).toUpperCase(),
      direction,
      entryPrice: Number(entryPrice),
      stopLoss: Number(stopLoss),
      takeProfit: Number(takeProfit),
      confidence: (confidence as SignalConfidence) || 'B',
      status: 'pending',
      analysisId: analysisId ? String(analysisId) : null,
      label: label ? String(label) : null,
      marketState: marketState ?? null,
      strategy: strategy ? String(strategy) : null,
      score: Number.isFinite(Number(score)) ? Number(score) : null,
      confirmations: Array.isArray(confirmations)
        ? confirmations.map((item) => String(item)).filter(Boolean)
        : [],
      explanation: explanation ? String(explanation) : null,
      lotSize: lotSize != null ? Number(lotSize) : null,
    });
    return res.json({ signal });
  } catch (error) {
    console.error('createSignal error:', error);
    return res.status(500).json({ error: 'Failed to create signal' });
  }
};

export const getSignals = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as SignalStatus | undefined;
    const signals = await listTradeSignalsForUser(req.user!.id, status);
    return res.json({ signals });
  } catch (error) {
    console.error('getSignals error:', error);
    return res.status(500).json({ error: 'Failed to list signals' });
  }
};

export const getPendingSignals = async (req: AuthRequest, res: Response) => {
  try {
    const signals = await listPendingSignalsForUser(req.user!.id);
    const riskSettings = await getRiskSettings(req.user!.id);
    return res.json({
      signals,
      killSwitch: riskSettings?.killSwitch ?? false,
      autoMode: riskSettings?.autoMode ?? 'manual',
    });
  } catch (error) {
    console.error('getPendingSignals error:', error);
    return res.status(500).json({ error: 'Failed to list pending signals' });
  }
};

export const approveSignal = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await getTradeSignalById(id, req.user!.id);
    if (!existing) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'Signal is no longer pending' });
    }
    const signal = await updateTradeSignal(id, req.user!.id, { status: 'ready' });
    return res.json({ signal });
  } catch (error) {
    console.error('approveSignal error:', error);
    return res.status(500).json({ error: 'Failed to approve signal' });
  }
};

export const confirmExecution = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { ticket, lotSize } = req.body ?? {};
    if (!ticket) {
      return res.status(400).json({ error: 'ticket is required' });
    }
    const existing = await getTradeSignalById(id, req.user!.id);
    if (!existing) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    if (existing.status !== 'ready' && existing.status !== 'pending') {
      return res.status(409).json({ error: 'Signal cannot be confirmed' });
    }
    const signal = await confirmSignalExecution(id, req.user!.id, String(ticket), lotSize != null ? Number(lotSize) : undefined);
    return res.json({ signal });
  } catch (error) {
    console.error('confirmExecution error:', error);
    return res.status(500).json({ error: 'Failed to confirm execution' });
  }
};

export const cancelSignal = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await getTradeSignalById(id, req.user!.id);
    if (!existing) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    if (existing.status === 'executed' || existing.status === 'cancelled') {
      return res.status(409).json({ error: 'Signal can no longer be cancelled' });
    }
    const signal = await cancelTradeSignal(id, req.user!.id);
    return res.json({ signal });
  } catch (error) {
    console.error('cancelSignal error:', error);
    return res.status(500).json({ error: 'Failed to cancel signal' });
  }
};

// ── Risk Settings ──

export const getSettings = async (req: AuthRequest, res: Response) => {
  try {
    const settings = await getRiskSettings(req.user!.id);
    return res.json({
      settings: settings ?? {
        riskPerTrade: 1.0,
        maxDailyLoss: 5.0,
        maxTradesPerDay: 3,
        autoMode: 'manual',
        killSwitch: false,
      },
    });
  } catch (error) {
    console.error('getSettings error:', error);
    return res.status(500).json({ error: 'Failed to fetch risk settings' });
  }
};

export const updateSettings = async (req: AuthRequest, res: Response) => {
  try {
    const { riskPerTrade, maxDailyLoss, maxTradesPerDay, autoMode, killSwitch } = req.body ?? {};
    const values: Record<string, unknown> = {};
    if (riskPerTrade != null) values.riskPerTrade = Math.max(0.1, Math.min(10, Number(riskPerTrade)));
    if (maxDailyLoss != null) values.maxDailyLoss = Math.max(1, Math.min(50, Number(maxDailyLoss)));
    if (maxTradesPerDay != null) values.maxTradesPerDay = Math.max(1, Math.min(20, Number(maxTradesPerDay)));
    if (autoMode != null && ['manual', 'semi', 'full'].includes(autoMode)) values.autoMode = autoMode;
    if (killSwitch != null) values.killSwitch = Boolean(killSwitch);

    const settings = await upsertRiskSettings(req.user!.id, values);
    return res.json({ settings });
  } catch (error) {
    console.error('updateSettings error:', error);
    return res.status(500).json({ error: 'Failed to update risk settings' });
  }
};

export const toggleKillSwitchHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' });
    }
    const settings = await toggleKillSwitch(req.user!.id, enabled);
    return res.json({ settings });
  } catch (error) {
    console.error('toggleKillSwitch error:', error);
    return res.status(500).json({ error: 'Failed to toggle kill switch' });
  }
};
