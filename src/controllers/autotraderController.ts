import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getMt5ConnectionForUser,
  upsertMt5Connection,
  disconnectMt5Connection,
  mt5Heartbeat,
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
  SignalStatus,
  Mt5ConnectionRecord,
} from '../lib/supabase';

const sanitizeConnection = (connection: Mt5ConnectionRecord | null) => {
  if (!connection) {
    return null;
  }

  const { accountPassword, ...safeConnection } = connection;
  return {
    ...safeConnection,
    hasPassword: Boolean(accountPassword),
  };
};

// ── MT5 Connection ──

export const getConnection = async (req: AuthRequest, res: Response) => {
  try {
    const conn = await getMt5ConnectionForUser(req.user!.id);
    return res.json({ connection: sanitizeConnection(conn) });
  } catch (error) {
    console.error('getConnection error:', error);
    return res.status(500).json({ error: 'Failed to fetch MT5 connection' });
  }
};

export const connectMt5 = async (req: AuthRequest, res: Response) => {
  try {
    const { accountId, broker, serverName, accountPassword } = req.body ?? {};
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const conn = await upsertMt5Connection(req.user!.id, {
      accountId: String(accountId),
      broker: String(broker ?? ''),
      serverName: String(serverName ?? ''),
      accountPassword: accountPassword ? String(accountPassword) : null,
    });
    return res.json({ connection: sanitizeConnection(conn) });
  } catch (error) {
    console.error('connectMt5 error:', error);
    return res.status(500).json({ error: 'Failed to connect MT5' });
  }
};

export const disconnectMt5 = async (req: AuthRequest, res: Response) => {
  try {
    await disconnectMt5Connection(req.user!.id);
    return res.json({ success: true });
  } catch (error) {
    console.error('disconnectMt5 error:', error);
    return res.status(500).json({ error: 'Failed to disconnect MT5' });
  }
};

export const heartbeat = async (req: AuthRequest, res: Response) => {
  try {
    const { accountId, broker, serverName, accountName, balance, equity, currency } = req.body ?? {};
    const connection = await mt5Heartbeat(req.user!.id, {
      accountId: accountId != null ? String(accountId) : undefined,
      broker: broker != null ? String(broker) : undefined,
      serverName: serverName != null ? String(serverName) : undefined,
      accountName: accountName != null ? String(accountName) : undefined,
      balance: balance != null ? Number(balance) : undefined,
      equity: equity != null ? Number(equity) : undefined,
      currency: currency != null ? String(currency) : undefined,
    });
    return res.json({ success: true, connection: sanitizeConnection(connection) });
  } catch (error) {
    console.error('heartbeat error:', error);
    return res.status(500).json({ error: 'Heartbeat failed' });
  }
};

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

    const { symbol, direction, entryPrice, stopLoss, takeProfit, confidence, analysisId, lotSize } = req.body ?? {};
    if (!symbol || !direction || entryPrice == null || stopLoss == null || takeProfit == null) {
      return res.status(400).json({ error: 'symbol, direction, entryPrice, stopLoss, takeProfit are required' });
    }

    const validDirections: SignalDirection[] = ['buy', 'sell'];
    if (!validDirections.includes(direction)) {
      return res.status(400).json({ error: 'direction must be buy or sell' });
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
