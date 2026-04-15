import {
  getAutoTradeSettings,
  createAutoTrade,
  createAutoTradeLog,
  countTodayAutoTrades,
  getAutoPerformance,
  updateAutoPerformance,
  getTodayAutoTradesProfit,
  type AutoTradeSettingsRecord,
  type AutoTradeRecord,
} from '../lib/supabase';
import { placeTrade, getAccountBalance, closeTrade, getOpenTrades } from './ctraderService';
import { sendPushToUser } from './pushService';

// ── Types ──

export interface ScannerSignal {
  userId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  sl: number;
  tp: number;
  confidence: string;
  marketState: string;
  scanResultId?: string;
}

export type RejectionReason =
  | 'auto_mode_off'
  | 'not_active'
  | 'no_ctrader_connection'
  | 'gold_only_filter'
  | 'chop_market'
  | 'low_confidence'
  | 'max_trades_exceeded'
  | 'daily_loss_exceeded'
  | 'session_not_allowed'
  | 'duplicate_symbol'
  | 'sl_too_small'
  | 'no_bos'
  | 'kill_switch';

// ── Safety checks ──

const MIN_SL_DISTANCE: Record<string, number> = {
  XAUUSD: 1.0,
  DEFAULT: 0.0005,
};

const getCurrentSession = (): string => {
  const hour = new Date().getUTCHours();
  if (hour >= 7 && hour < 16) return 'london';
  if (hour >= 12 && hour < 21) return 'newyork';
  return 'off-hours';
};

const isSessionAllowed = (allowedSessions: string[]): boolean => {
  const current = getCurrentSession();
  return allowedSessions.includes(current);
};

// ── Core execution logic ──

export const processSignal = async (signal: ScannerSignal): Promise<{
  action: 'executed' | 'pending_confirmation' | 'rejected';
  reason?: string;
  tradeId?: string;
}> => {
  const settings = await getAutoTradeSettings(signal.userId);
  if (!settings) {
    return { action: 'rejected', reason: 'auto_mode_off' };
  }

  // ── Pre-flight checks ──
  const rejection = await validateSignal(signal, settings);
  if (rejection) {
    await createAutoTradeLog({
      userId: signal.userId,
      tradeId: null,
      action: 'rejected',
      reason: rejection,
      metadata: { symbol: signal.symbol, direction: signal.direction },
    });
    return { action: 'rejected', reason: rejection };
  }

  // ── Log signal receipt ──
  await createAutoTradeLog({
    userId: signal.userId,
    tradeId: null,
    action: 'signal_received',
    reason: `${signal.symbol} ${signal.direction} @ ${signal.entryPrice}`,
    metadata: {
      symbol: signal.symbol,
      direction: signal.direction,
      entry: signal.entryPrice,
      sl: signal.sl,
      tp: signal.tp,
      confidence: signal.confidence,
    },
  });

  // ── Mode handling ──
  if (settings.autoMode === 'assisted') {
    // Store as pending – wait for user confirmation
    const trade = await createAutoTrade({
      userId: signal.userId,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      sl: signal.sl,
      tp: signal.tp,
      lotSize: 0, // Calculated on execution
      status: 'pending',
      ctraderOrderId: null,
      confidence: signal.confidence,
      marketState: signal.marketState,
      scanResultId: signal.scanResultId ?? null,
    });

    await sendPushToUser(signal.userId, {
      title: '🔔 Trade Signal Ready',
      body: `${signal.symbol} ${signal.direction.toUpperCase()} @ ${signal.entryPrice} — Tap to review`,
      tag: `auto-signal-${trade.id}`,
      url: '/dashboard/auto-trader',
    });

    return { action: 'pending_confirmation', tradeId: trade.id };
  }

  if (settings.autoMode === 'semi') {
    // Only execute high-confidence signals
    if (signal.confidence !== 'A+' && signal.confidence !== 'A') {
      await createAutoTradeLog({
        userId: signal.userId,
        tradeId: null,
        action: 'rejected',
        reason: 'Semi mode: confidence too low for auto-execution',
        metadata: { confidence: signal.confidence },
      });
      return { action: 'rejected', reason: 'low_confidence' };
    }
  }

  // Full mode or semi with high confidence → execute
  return executeTrade(signal, settings);
};

export const executeTrade = async (
  signal: ScannerSignal,
  settings: AutoTradeSettingsRecord,
): Promise<{
  action: 'executed' | 'rejected';
  reason?: string;
  tradeId?: string;
}> => {
  if (!settings.apiTokenEncrypted || !settings.ctraderAccountId) {
    return { action: 'rejected', reason: 'no_ctrader_connection' };
  }

  try {
    // ── Calculate lot size based on risk ──
    const accountInfo = await getAccountBalance(settings.apiTokenEncrypted, settings.ctraderAccountId);
    const slDistance = Math.abs(signal.entryPrice - signal.sl);
    const riskAmount = accountInfo.balance * (settings.riskPerTrade / 100);
    const lotSize = Math.round((riskAmount / slDistance) * 100) / 100;

    if (lotSize <= 0) {
      return { action: 'rejected', reason: 'sl_too_small' };
    }

    // ── Place trade via cTrader API ──
    const { orderId } = await placeTrade(
      settings.apiTokenEncrypted,
      settings.ctraderAccountId,
      {
        symbol: signal.symbol,
        direction: signal.direction,
        lotSize,
        sl: signal.sl,
        tp: signal.tp,
      },
    );

    // ── Record trade ──
    const trade = await createAutoTrade({
      userId: signal.userId,
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      sl: signal.sl,
      tp: signal.tp,
      lotSize,
      status: 'executed',
      ctraderOrderId: orderId,
      confidence: signal.confidence,
      marketState: signal.marketState,
      scanResultId: signal.scanResultId ?? null,
    });

    // ── Log execution ──
    await createAutoTradeLog({
      userId: signal.userId,
      tradeId: trade.id,
      action: 'executed',
      reason: `${signal.symbol} ${signal.direction} ${lotSize} lots @ ${signal.entryPrice}`,
      metadata: { orderId, lotSize, balance: accountInfo.balance },
    });

    // ── Notify user ──
    await sendPushToUser(signal.userId, {
      title: '✅ Trade Executed',
      body: `${signal.symbol} ${signal.direction.toUpperCase()} ${lotSize} lots @ ${signal.entryPrice}`,
      tag: `auto-trade-${trade.id}`,
      url: '/dashboard/auto-trader',
    });

    return { action: 'executed', tradeId: trade.id };
  } catch (error) {
    console.error('[autoTraderEngine] Trade execution failed:', error);

    await createAutoTradeLog({
      userId: signal.userId,
      tradeId: null,
      action: 'rejected',
      reason: `Execution error: ${error instanceof Error ? error.message : 'Unknown'}`,
      metadata: null,
    });

    return { action: 'rejected', reason: 'execution_error' };
  }
};

// ── Validation ──

const validateSignal = async (
  signal: ScannerSignal,
  settings: AutoTradeSettingsRecord,
): Promise<RejectionReason | null> => {
  if (settings.autoMode === 'off') return 'auto_mode_off';
  if (!settings.isActive) return 'not_active';
  if (!settings.apiTokenEncrypted || !settings.ctraderAccountId) return 'no_ctrader_connection';

  // Gold-only filter
  if (settings.goldOnly && signal.symbol !== 'XAUUSD') return 'gold_only_filter';

  // Market state check
  if (signal.marketState === 'choppy') return 'chop_market';

  // Confidence check
  if (signal.confidence === 'avoid' || signal.confidence === 'B') return 'low_confidence';

  // SL distance check
  const slDistance = Math.abs(signal.entryPrice - signal.sl);
  const minSl = MIN_SL_DISTANCE[signal.symbol] ?? MIN_SL_DISTANCE.DEFAULT;
  if (slDistance < minSl) return 'sl_too_small';

  // Session check
  const allowedSessions = Array.isArray(settings.allowedSessions) ? settings.allowedSessions as string[] : ['london', 'newyork'];
  if (!isSessionAllowed(allowedSessions)) return 'session_not_allowed';

  // Daily trade limit
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayCount = await countTodayAutoTrades(signal.userId, todayStart.toISOString());
  if (todayCount >= settings.maxTradesPerDay) return 'max_trades_exceeded';

  // Daily loss limit
  const todayProfit = await getTodayAutoTradesProfit(signal.userId, todayStart.toISOString());
  if (todayProfit < 0 && Math.abs(todayProfit) >= settings.maxDailyLoss) return 'daily_loss_exceeded';

  return null;
};

// ── Performance update ──

export const updatePerformanceAfterClose = async (
  userId: string,
  result: 'win' | 'loss' | 'breakeven',
  profit: number,
): Promise<void> => {
  const existing = await getAutoPerformance(userId);

  const totalTrades = (existing?.totalTrades ?? 0) + 1;
  const wins = (existing?.wins ?? 0) + (result === 'win' ? 1 : 0);
  const losses = (existing?.losses ?? 0) + (result === 'loss' ? 1 : 0);
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 10000) / 100 : 0;
  const totalProfit = (existing?.totalProfit ?? 0) + profit;
  const drawdown = profit < 0
    ? Math.max(existing?.drawdown ?? 0, Math.abs(profit))
    : existing?.drawdown ?? 0;

  await updateAutoPerformance(userId, {
    totalTrades,
    wins,
    losses,
    winRate,
    totalProfit,
    drawdown,
  });
};

// ── Emergency stop ──

export const emergencyStop = async (
  userId: string,
  closePositions: boolean,
): Promise<{ closedCount: number }> => {
  const settings = await getAutoTradeSettings(userId);
  if (!settings) return { closedCount: 0 };

  let closedCount = 0;

  if (closePositions && settings.apiTokenEncrypted && settings.ctraderAccountId) {
    try {
      const openTrades = await getOpenTrades(settings.apiTokenEncrypted, settings.ctraderAccountId);
      for (const trade of openTrades) {
        try {
          await closeTrade(settings.apiTokenEncrypted, settings.ctraderAccountId, trade.orderId);
          closedCount++;
        } catch (err) {
          console.error(`[autoTraderEngine] Failed to close position ${trade.orderId}:`, err);
        }
      }
    } catch (err) {
      console.error('[autoTraderEngine] Failed to fetch open trades for emergency stop:', err);
    }
  }

  await createAutoTradeLog({
    userId,
    tradeId: null,
    action: 'emergency_stop',
    reason: `Emergency stop activated. ${closedCount} positions closed.`,
    metadata: null,
  });

  await sendPushToUser(userId, {
    title: '🛑 Auto Trading Stopped',
    body: `Emergency stop activated. ${closedCount} trades closed.`,
    tag: 'auto-emergency-stop',
    url: '/dashboard/auto-trader',
  });

  return { closedCount };
};
