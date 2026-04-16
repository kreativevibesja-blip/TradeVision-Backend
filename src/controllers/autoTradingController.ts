import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { encrypt } from '../lib/encryption';
import { config } from '../config';
import {
  getAutoTradeSettings,
  ensureUserTradingSettings,
  upsertAutoTradeSettings,
  upsertUserTradingSettings,
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
  type StrategyMode,
  type TradingPersonality,
  type AllowedTradingAsset,
  type AllowedTradingSession,
} from '../lib/supabase';
import { processSignal, executeTrade, emergencyStop, updatePerformanceAfterClose } from '../services/autoTraderEngine';
import { connectAccount, getAccountBalance, getOpenTrades, exchangeCodeForTokens, getTradingAccounts } from '../services/ctraderService';

// ── Settings ──

export const getAutoSettings = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const [settings, smartSettings] = await Promise.all([
      getAutoTradeSettings(userId),
      ensureUserTradingSettings(userId),
    ]);
    const performance = await getAutoPerformance(userId);
    return res.json({
      settings: {
        autoMode: settings?.autoMode ?? 'off',
        strategyMode: settings?.strategyMode ?? (smartSettings.strategy_mode === 'gold_scalper' ? 'gold_scalper' : 'standard'),
        riskPerTrade: settings?.riskPerTrade ?? 1,
        maxDailyLoss: settings?.maxDailyLoss ?? 5,
        maxTradesPerDay: settings?.maxTradesPerDay ?? 3,
        allowedSessions: smartSettings.allowed_sessions,
        allowedAssets: smartSettings.allowed_assets,
        personality: smartSettings.personality,
        minConfidence: smartSettings.min_confidence,
        autoPauseEnabled: smartSettings.auto_pause_enabled,
        maxLossesInRow: smartSettings.max_losses_in_row,
        goldOnly: smartSettings.allowed_assets.length === 1 && smartSettings.allowed_assets[0] === 'gold',
        isActive: settings?.isActive ?? false,
        connected: Boolean(settings?.ctraderAccountId && settings?.apiTokenEncrypted),
        ctraderAccountId: settings?.ctraderAccountId ?? null,
      },
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
      strategyMode,
      riskPerTrade,
      maxDailyLoss,
      maxTradesPerDay,
      allowedSessions,
      allowedAssets,
      personality,
      minConfidence,
      autoPauseEnabled,
      maxLossesInRow,
      goldOnly,
      isActive,
    } = req.body;

    const validModes: AutoTradeMode[] = ['off', 'assisted', 'semi', 'full'];
    const validStrategyModes: StrategyMode[] = ['standard', 'gold_scalper'];
    const validPersonalities: TradingPersonality[] = ['conservative', 'balanced', 'aggressive'];
    const validSessions: AllowedTradingSession[] = ['london', 'newyork'];
    const validAssets: AllowedTradingAsset[] = ['gold', 'indices', 'forex'];
    const autoSettingsUpdate: Record<string, unknown> = {};
    const smartSettingsUpdate: Record<string, unknown> = {};

    const currentSmartSettings = await ensureUserTradingSettings(userId);

    if (autoMode !== undefined) {
      if (!validModes.includes(autoMode)) {
        return res.status(400).json({ error: 'Invalid auto mode' });
      }
      autoSettingsUpdate.autoMode = autoMode;
    }

    if (strategyMode !== undefined) {
      if (!validStrategyModes.includes(strategyMode)) {
        return res.status(400).json({ error: 'Invalid strategy mode' });
      }
      autoSettingsUpdate.strategyMode = strategyMode;
      smartSettingsUpdate.strategy_mode = strategyMode;
    }

    if (riskPerTrade !== undefined) {
      const risk = Number(riskPerTrade);
      if (!Number.isFinite(risk) || risk < 0.1 || risk > 10) {
        return res.status(400).json({ error: 'Risk per trade must be 0.1-10%' });
      }
      autoSettingsUpdate.riskPerTrade = risk;
    }

    if (maxDailyLoss !== undefined) {
      const loss = Number(maxDailyLoss);
      if (!Number.isFinite(loss) || loss < 1 || loss > 50) {
        return res.status(400).json({ error: 'Max daily loss must be 1-50%' });
      }
      autoSettingsUpdate.maxDailyLoss = loss;
    }

    if (maxTradesPerDay !== undefined) {
      const max = Math.floor(Number(maxTradesPerDay));
      if (!Number.isFinite(max) || max < 1 || max > 20) {
        return res.status(400).json({ error: 'Max trades per day must be 1-20' });
      }
      autoSettingsUpdate.maxTradesPerDay = max;
    }

    if (allowedSessions !== undefined) {
      if (!Array.isArray(allowedSessions)) {
        return res.status(400).json({ error: 'Allowed sessions must be an array' });
      }
      const filtered = allowedSessions.filter((session: string): session is AllowedTradingSession => validSessions.includes(session as AllowedTradingSession));
      if (filtered.length === 0) {
        return res.status(400).json({ error: 'Select at least one trading session' });
      }
      smartSettingsUpdate.allowed_sessions = filtered;
      autoSettingsUpdate.allowedSessions = filtered;
    }

    if (allowedAssets !== undefined) {
      if (!Array.isArray(allowedAssets)) {
        return res.status(400).json({ error: 'Allowed assets must be an array' });
      }
      const filtered = allowedAssets.filter((asset: string): asset is AllowedTradingAsset => validAssets.includes(asset as AllowedTradingAsset));
      if (filtered.length === 0) {
        return res.status(400).json({ error: 'Select at least one asset group' });
      }
      smartSettingsUpdate.allowed_assets = filtered;
      autoSettingsUpdate.goldOnly = filtered.length === 1 && filtered[0] === 'gold';
    }

    if (personality !== undefined) {
      if (!validPersonalities.includes(personality)) {
        return res.status(400).json({ error: 'Invalid trading personality' });
      }
      smartSettingsUpdate.personality = personality;
    }

    if (minConfidence !== undefined) {
      const parsed = Math.floor(Number(minConfidence));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
        return res.status(400).json({ error: 'Minimum confidence must be between 1 and 10' });
      }
      smartSettingsUpdate.min_confidence = parsed;
    }

    if (autoPauseEnabled !== undefined) {
      if (typeof autoPauseEnabled !== 'boolean') {
        return res.status(400).json({ error: 'Auto pause must be true or false' });
      }
      smartSettingsUpdate.auto_pause_enabled = autoPauseEnabled;
    }

    if (maxLossesInRow !== undefined) {
      const parsed = Math.floor(Number(maxLossesInRow));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
        return res.status(400).json({ error: 'Max losses before pause must be between 1 and 10' });
      }
      smartSettingsUpdate.max_losses_in_row = parsed;
    }

    if (typeof goldOnly === 'boolean') {
      const nextAssets = goldOnly
        ? ['gold']
        : (currentSmartSettings.allowed_assets.length === 1 && currentSmartSettings.allowed_assets[0] === 'gold'
          ? ['gold', 'forex']
          : currentSmartSettings.allowed_assets);
      smartSettingsUpdate.allowed_assets = nextAssets;
      autoSettingsUpdate.goldOnly = goldOnly;
    }

    if (typeof isActive === 'boolean') autoSettingsUpdate.isActive = isActive;

    const [autoSettings, smartSettings] = await Promise.all([
      Object.keys(autoSettingsUpdate).length > 0 ? upsertAutoTradeSettings(userId, autoSettingsUpdate) : getAutoTradeSettings(userId),
      Object.keys(smartSettingsUpdate).length > 0 ? upsertUserTradingSettings(userId, smartSettingsUpdate) : Promise.resolve(currentSmartSettings),
    ]);

    const mergedSettings = {
      autoMode: autoSettings?.autoMode ?? 'off',
      strategyMode: autoSettings?.strategyMode ?? (smartSettings.strategy_mode === 'gold_scalper' ? 'gold_scalper' : 'standard'),
      riskPerTrade: autoSettings?.riskPerTrade ?? 1,
      maxDailyLoss: autoSettings?.maxDailyLoss ?? 5,
      maxTradesPerDay: autoSettings?.maxTradesPerDay ?? 3,
      allowedSessions: smartSettings.allowed_sessions,
      allowedAssets: smartSettings.allowed_assets,
      personality: smartSettings.personality,
      minConfidence: smartSettings.min_confidence,
      autoPauseEnabled: smartSettings.auto_pause_enabled,
      maxLossesInRow: smartSettings.max_losses_in_row,
      goldOnly: smartSettings.allowed_assets.length === 1 && smartSettings.allowed_assets[0] === 'gold',
      isActive: autoSettings?.isActive ?? false,
      connected: Boolean(autoSettings?.ctraderAccountId && autoSettings?.apiTokenEncrypted),
      ctraderAccountId: autoSettings?.ctraderAccountId ?? null,
    };

    return res.json({ settings: mergedSettings });
  } catch (error) {
    console.error('[autoTrading] updateAutoSettings error:', error);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
};

// ── cTrader Connection (OAuth) ──

export const getOAuthUrl = async (req: AuthRequest, res: Response) => {
  try {
    if (!config.ctrader.clientId || !config.ctrader.redirectUri) {
      return res.status(500).json({ error: 'cTrader OAuth not configured' });
    }
    const params = new URLSearchParams({
      client_id: config.ctrader.clientId,
      redirect_uri: config.ctrader.redirectUri,
      response_type: 'code',
      scope: 'trading',
    });
    const url = `https://id.ctrader.com/connect/authorize?${params}`;
    return res.json({ url });
  } catch (error) {
    console.error('[autoTrading] getOAuthUrl error:', error);
    return res.status(500).json({ error: 'Failed to generate OAuth URL' });
  }
};

export const connectCTrader = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { code, accountId } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    const encryptedAccess = encrypt(tokens.access_token);
    const encryptedRefresh = encrypt(tokens.refresh_token);

    // If no accountId provided, fetch available accounts so user can pick
    if (!accountId) {
      const accounts = await getTradingAccounts(tokens.access_token);
      return res.json({
        success: true,
        needsAccountSelection: true,
        accounts: accounts.map((a) => ({
          accountId: String(a.accountId),
          accountNumber: a.accountNumber,
          live: a.live,
          brokerName: a.brokerName,
          balance: a.balance,
          currency: a.currency,
        })),
        // Temporarily store encrypted tokens so the next request can use them
        tempAccessToken: encryptedAccess,
        tempRefreshToken: encryptedRefresh,
      });
    }

    // Verify connection works
    try {
      const account = await connectAccount(encryptedAccess, accountId);
      await upsertAutoTradeSettings(userId, {
        ctraderAccountId: accountId,
        apiTokenEncrypted: encryptedAccess,
        refreshTokenEncrypted: encryptedRefresh,
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

export const selectCTraderAccount = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { accountId, encryptedAccessToken, encryptedRefreshToken } = req.body;

    if (!accountId || typeof accountId !== 'string') {
      return res.status(400).json({ error: 'Invalid account ID' });
    }
    if (!encryptedAccessToken || !encryptedRefreshToken) {
      return res.status(400).json({ error: 'Missing token data' });
    }

    // Verify connection with selected account
    try {
      const account = await connectAccount(encryptedAccessToken, accountId);
      await upsertAutoTradeSettings(userId, {
        ctraderAccountId: accountId,
        apiTokenEncrypted: encryptedAccessToken,
        refreshTokenEncrypted: encryptedRefreshToken,
      });
      return res.json({ success: true, balance: account.balance, currency: account.currency });
    } catch {
      return res.status(400).json({ error: 'Failed to connect to the selected account.' });
    }
  } catch (error) {
    console.error('[autoTrading] selectCTraderAccount error:', error);
    return res.status(500).json({ error: 'Failed to select account' });
  }
};

export const disconnectCTrader = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    await upsertAutoTradeSettings(userId, {
      ctraderAccountId: null,
      apiTokenEncrypted: null,
      refreshTokenEncrypted: null,
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
    const smartSettings = await ensureUserTradingSettings(userId);
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
      smartSettings,
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
