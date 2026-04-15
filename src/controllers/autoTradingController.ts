import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { encrypt } from '../lib/encryption';
import {
  getAutoTradeSettings,
  upsertAutoTradeSettings,
  listAutoTradesForUser,
  getAutoTradeById,
  updateAutoTrade,
  getOpenAutoTrades,
  getPendingAutoTrades,
  listAutoTradeLogsForUser,
  getAutoPerformance,
  getAllAutoTradeSettings,
  getAllAutoPerformance,
  countTodayAllAutoTrades,
  getTodayAllAutoTradesProfit,
  listAllAutoTradeLogs,
  disableAutoTradeForUser,
  type AutoTradeMode,
  type AutoTradeStatus,
} from '../lib/supabase';
import { processSignal, executeTrade, emergencyStop, updatePerformanceAfterClose } from '../services/autoTraderEngine';
import { connectAccount, getAccountBalance, getOpenTrades } from '../services/ctraderService';

// ── Settings ──

export const getAutoSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const settings = await getAutoTradeSettings(userId);
    const performance = await getAutoPerformance(userId);
    return res.json({
      settings: settings ? {
        autoMode: settings.autoMode,
        riskPerTrade: settings.riskPerTrade,
        maxDailyLoss: settings.maxDailyLoss,
        maxTradesPerDay: settings.maxTradesPerDay,
        allowedSessions: settings.allowedSessions,
        goldOnly: settings.goldOnly,
        isActive: settings.isActive,
        connected: Boolean(settings.ctraderAccountId && settings.apiTokenEncrypted),
        ctraderAccountId: settings.ctraderAccountId,
      } : null,
      performance: performance ? {
        totalTrades: performance.totalTrades,
        wins: performance.wins,
        losses: performance.losses,
        winRate: performance.winRate,
        totalProfit: performance.totalProfit,
        drawdown: performance.drawdown,
      } : null,
    });
  } catch (error) {
    console.error('[autoTrading] getAutoSettings error:', error);
    return res.status(500).json({ error: 'Failed to get settings' });
  }
};

export const updateAutoSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      autoMode,
      riskPerTrade,
      maxDailyLoss,
      maxTradesPerDay,
      allowedSessions,
      goldOnly,
      isActive,
    } = req.body;

    const validModes: AutoTradeMode[] = ['off', 'assisted', 'semi', 'full'];
    const update: Record<string, unknown> = {};

    if (autoMode !== undefined) {
      if (!validModes.includes(autoMode)) {
        return res.status(400).json({ error: 'Invalid auto mode' });
      }
      update.autoMode = autoMode;
    }

    if (riskPerTrade !== undefined) {
      const risk = Number(riskPerTrade);
      if (!Number.isFinite(risk) || risk < 0.1 || risk > 10) {
        return res.status(400).json({ error: 'Risk per trade must be 0.1-10%' });
      }
      update.riskPerTrade = risk;
    }

    if (maxDailyLoss !== undefined) {
      const loss = Number(maxDailyLoss);
      if (!Number.isFinite(loss) || loss < 1 || loss > 50) {
        return res.status(400).json({ error: 'Max daily loss must be 1-50%' });
      }
      update.maxDailyLoss = loss;
    }

    if (maxTradesPerDay !== undefined) {
      const max = Math.floor(Number(maxTradesPerDay));
      if (!Number.isFinite(max) || max < 1 || max > 20) {
        return res.status(400).json({ error: 'Max trades per day must be 1-20' });
      }
      update.maxTradesPerDay = max;
    }

    if (allowedSessions !== undefined) {
      if (!Array.isArray(allowedSessions)) {
        return res.status(400).json({ error: 'Allowed sessions must be an array' });
      }
      const valid = ['london', 'newyork'];
      const filtered = allowedSessions.filter((s: string) => valid.includes(s));
      update.allowedSessions = filtered;
    }

    if (typeof goldOnly === 'boolean') update.goldOnly = goldOnly;
    if (typeof isActive === 'boolean') update.isActive = isActive;

    const settings = await upsertAutoTradeSettings(userId, update);
    return res.json({ settings });
  } catch (error) {
    console.error('[autoTrading] updateAutoSettings error:', error);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
};

// ── cTrader Connection ──

export const connectCTrader = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { apiToken, accountId } = req.body;

    if (!apiToken || typeof apiToken !== 'string' || apiToken.length < 10) {
      return res.status(400).json({ error: 'Invalid API token' });
    }
    if (!accountId || typeof accountId !== 'string') {
      return res.status(400).json({ error: 'Invalid account ID' });
    }

    // Encrypt token before storage
    const encrypted = encrypt(apiToken);

    // Verify connection works
    try {
      const account = await connectAccount(encrypted, accountId);
      await upsertAutoTradeSettings(userId, {
        ctraderAccountId: accountId,
        apiTokenEncrypted: encrypted,
      });
      return res.json({ success: true, balance: account.balance, currency: account.currency });
    } catch {
      return res.status(400).json({ error: 'Failed to connect to cTrader. Please check your credentials.' });
    }
  } catch (error) {
    console.error('[autoTrading] connectCTrader error:', error);
    return res.status(500).json({ error: 'Failed to connect account' });
  }
};

export const disconnectCTrader = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await upsertAutoTradeSettings(userId, {
      ctraderAccountId: null,
      apiTokenEncrypted: null,
      isActive: false,
      autoMode: 'off' as AutoTradeMode,
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('[autoTrading] disconnectCTrader error:', error);
    return res.status(500).json({ error: 'Failed to disconnect' });
  }
};

export const getBalance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const settings = await getAutoTradeSettings(userId);
    if (!settings?.apiTokenEncrypted || !settings.ctraderAccountId) {
      return res.status(400).json({ error: 'No cTrader account connected' });
    }
    const account = await getAccountBalance(settings.apiTokenEncrypted, settings.ctraderAccountId);
    return res.json(account);
  } catch (error) {
    console.error('[autoTrading] getBalance error:', error);
    return res.status(500).json({ error: 'Failed to get balance' });
  }
};

// ── Trades ──

export const getTrades = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const status = req.query.status as AutoTradeStatus | undefined;
    const trades = await listAutoTradesForUser(userId, status);
    return res.json({ trades });
  } catch (error) {
    console.error('[autoTrading] getTrades error:', error);
    return res.status(500).json({ error: 'Failed to get trades' });
  }
};

export const getActiveTrades = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const trades = await getOpenAutoTrades(userId);
    return res.json({ trades });
  } catch (error) {
    console.error('[autoTrading] getActiveTrades error:', error);
    return res.status(500).json({ error: 'Failed to get active trades' });
  }
};

export const getPending = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const trades = await getPendingAutoTrades(userId);
    return res.json({ trades });
  } catch (error) {
    console.error('[autoTrading] getPending error:', error);
    return res.status(500).json({ error: 'Failed to get pending trades' });
  }
};

export const approvePendingTrade = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const tradeId = req.params.id;
    const trade = await getAutoTradeById(tradeId);

    if (!trade || trade.userId !== userId) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    if (trade.status !== 'pending') {
      return res.status(400).json({ error: 'Trade is not pending' });
    }

    const settings = await getAutoTradeSettings(userId);
    if (!settings) {
      return res.status(400).json({ error: 'Auto trade settings not configured' });
    }

    const result = await executeTrade(
      {
        userId,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        sl: trade.sl,
        tp: trade.tp,
        confidence: trade.confidence ?? 'B',
        marketState: trade.marketState ?? 'trending',
        scanResultId: trade.scanResultId ?? undefined,
      },
      settings,
    );

    if (result.action === 'executed') {
      // Update the pending record to mark as executed
      await updateAutoTrade(tradeId, { status: 'rejected' as any }); // Old pending record superseded
    }

    return res.json(result);
  } catch (error) {
    console.error('[autoTrading] approvePendingTrade error:', error);
    return res.status(500).json({ error: 'Failed to approve trade' });
  }
};

export const closeTradeFn = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const tradeId = req.params.id;
    const trade = await getAutoTradeById(tradeId);

    if (!trade || trade.userId !== userId) {
      return res.status(404).json({ error: 'Trade not found' });
    }
    if (trade.status !== 'executed') {
      return res.status(400).json({ error: 'Trade is not open' });
    }

    const settings = await getAutoTradeSettings(userId);
    if (settings?.apiTokenEncrypted && settings.ctraderAccountId && trade.ctraderOrderId) {
      const { closeTrade } = await import('../services/ctraderService');
      await closeTrade(settings.apiTokenEncrypted, settings.ctraderAccountId, trade.ctraderOrderId);
    }

    const profit = Number(req.body.profit) || 0;
    const result = profit > 0 ? 'win' : profit < 0 ? 'loss' : 'breakeven';

    await updateAutoTrade(tradeId, {
      status: 'closed',
      result: result as any,
      profit,
      closedAt: new Date().toISOString(),
    });

    await updatePerformanceAfterClose(userId, result, profit);

    return res.json({ success: true });
  } catch (error) {
    console.error('[autoTrading] closeTrade error:', error);
    return res.status(500).json({ error: 'Failed to close trade' });
  }
};

// ── Emergency Stop ──

export const emergencyStopHandler = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const closePositions = req.body.closePositions !== false;

    // Set mode to off
    await upsertAutoTradeSettings(userId, { autoMode: 'off' as AutoTradeMode, isActive: false });

    const result = await emergencyStop(userId, closePositions);
    return res.json({ success: true, closedCount: result.closedCount });
  } catch (error) {
    console.error('[autoTrading] emergencyStop error:', error);
    return res.status(500).json({ error: 'Failed to execute emergency stop' });
  }
};

// ── Logs ──

export const getLogs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const logs = await listAutoTradeLogsForUser(userId);
    return res.json({ logs });
  } catch (error) {
    console.error('[autoTrading] getLogs error:', error);
    return res.status(500).json({ error: 'Failed to get logs' });
  }
};

// ── Performance ──

export const getPerformance = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const performance = await getAutoPerformance(userId);
    return res.json({ performance });
  } catch (error) {
    console.error('[autoTrading] getPerformance error:', error);
    return res.status(500).json({ error: 'Failed to get performance' });
  }
};

// ── Live positions from cTrader ──

export const getLivePositions = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const settings = await getAutoTradeSettings(userId);
    if (!settings?.apiTokenEncrypted || !settings.ctraderAccountId) {
      return res.json({ positions: [] });
    }
    const positions = await getOpenTrades(settings.apiTokenEncrypted, settings.ctraderAccountId);
    return res.json({ positions });
  } catch (error) {
    console.error('[autoTrading] getLivePositions error:', error);
    return res.status(500).json({ error: 'Failed to get positions' });
  }
};

// ── Admin ──

export const adminGetOverview = async (req: AuthRequest, res: Response) => {
  try {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayIso = todayStart.toISOString();

    const [allSettings, allPerformance, todayCount, todayProfit, recentLogs] = await Promise.all([
      getAllAutoTradeSettings(),
      getAllAutoPerformance(),
      countTodayAllAutoTrades(todayIso),
      getTodayAllAutoTradesProfit(todayIso),
      listAllAutoTradeLogs(50),
    ]);

    return res.json({
      users: allSettings.map((s) => ({
        userId: s.userId,
        email: s.User?.email ?? 'unknown',
        name: s.User?.name ?? null,
        autoMode: s.autoMode,
        isActive: s.isActive,
        connected: Boolean(s.ctraderAccountId),
        performance: allPerformance.find((p) => p.userId === s.userId) ?? null,
      })),
      system: {
        totalTradesToday: todayCount,
        totalProfitToday: todayProfit,
        recentLogs,
      },
    });
  } catch (error) {
    console.error('[autoTrading] adminGetOverview error:', error);
    return res.status(500).json({ error: 'Failed to get admin overview' });
  }
};

export const adminGetUserDetail = async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = req.params.userId;
    const [settings, performance, trades, logs] = await Promise.all([
      getAutoTradeSettings(targetUserId),
      getAutoPerformance(targetUserId),
      listAutoTradesForUser(targetUserId, undefined, 100),
      listAutoTradeLogsForUser(targetUserId, 100),
    ]);

    return res.json({ settings, performance, trades, logs });
  } catch (error) {
    console.error('[autoTrading] adminGetUserDetail error:', error);
    return res.status(500).json({ error: 'Failed to get user detail' });
  }
};

export const adminDisableUser = async (req: AuthRequest, res: Response) => {
  try {
    const targetUserId = req.params.userId;
    await disableAutoTradeForUser(targetUserId);
    return res.json({ success: true });
  } catch (error) {
    console.error('[autoTrading] adminDisableUser error:', error);
    return res.status(500).json({ error: 'Failed to disable user' });
  }
};
