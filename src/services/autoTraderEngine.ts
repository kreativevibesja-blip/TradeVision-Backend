import {
  getAutoTradeSettings,
  ensureUserTradingSettings,
  upsertAutoTradeSettings,
  createAutoTrade,
  createAutoTradeLog,
  countTodayAutoTrades,
  getAutoPerformance,
  updateAutoPerformance,
  getTodayAutoTradesProfit,
  listAutoTradeLogsForUser,
  listAutoTradesForUser,
  type AutoTradeSettingsRecord,
  type AutoTradeRecord,
  type AllowedTradingAsset,
  type TradingPersonality,
  type UserTradingSettingsRecord,
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
  strategy?: string;
  session?: string;
  scanResultId?: string;
}

export type RejectionReason =
  | 'auto_mode_off'
  | 'not_active'
  | 'no_ctrader_connection'
  | 'gold_only_filter'
  | 'chop_market'
  | 'low_confidence'
  | 'confidence_locked'
  | 'max_trades_exceeded'
  | 'daily_loss_exceeded'
  | 'session_not_allowed'
  | 'asset_not_allowed'
  | 'strategy_mismatch'
  | 'duplicate_symbol'
  | 'sl_too_small'
  | 'no_bos'
  | 'kill_switch'
  | 'gold_scalper_session_limit'
  | 'strategy_cooldown'
  | 'personality_session_limit'
  | 'auto_paused';

// ── Safety checks ──

const MIN_SL_DISTANCE: Record<string, number> = {
  XAUUSD: 1.0,
  DEFAULT: 0.0005,
};
const GOLD_SCALPER_MAX_TRADES_PER_SESSION = 2;
const GOLD_SCALPER_COOLDOWN_MS = 60 * 60_000;

const CONFIDENCE_SCORE: Record<string, number> = {
  'A+': 10,
  A: 8,
  B: 6,
  avoid: 1,
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

const getNormalizedSignalSession = (signal: ScannerSignal): string => {
  const rawSession = signal.session?.toLowerCase() ?? '';
  if (rawSession.includes('london')) return 'london';
  if (rawSession.includes('newyork') || rawSession.includes('new_york')) return 'newyork';
  return getCurrentSession();
};

const getConfidenceScore = (confidence: string): number => CONFIDENCE_SCORE[confidence] ?? 0;

const getAssetClassForSymbol = (symbol: string): AllowedTradingAsset => {
  if (symbol === 'XAUUSD') {
    return 'gold';
  }

  if (/^(US30|NAS100|SPX500|GER40|UK100|USTEC|US500)/i.test(symbol)) {
    return 'indices';
  }

  return 'forex';
};

const getPersonalityMinConfidence = (personality: TradingPersonality): number => {
  if (personality === 'conservative') return 7;
  if (personality === 'aggressive') return 5;
  return 0;
};

const getPersonalitySessionTradeLimit = (personality: TradingPersonality): number | null => {
  if (personality === 'conservative') return 2;
  if (personality === 'aggressive') return 5;
  return null;
};

const countConsecutiveLosses = (trades: AutoTradeRecord[]): number => {
  let losses = 0;

  for (const trade of trades) {
    if (trade.result !== 'loss') {
      break;
    }
    losses += 1;
  }

  return losses;
};

// ── Core execution logic ──

export const processSignal = async (signal: ScannerSignal): Promise<{
  action: 'executed' | 'pending_confirmation' | 'rejected';
  reason?: string;
  tradeId?: string;
}> => {
  const settings = await getAutoTradeSettings(signal.userId);
  const smartSettings = await ensureUserTradingSettings(signal.userId);
  if (!settings) {
    return { action: 'rejected', reason: 'auto_mode_off' };
  }

  // ── Pre-flight checks ──
  const rejection = await validateSignal(signal, settings, smartSettings);
  if (rejection) {
    await createAutoTradeLog({
      userId: signal.userId,
      tradeId: null,
      action: 'rejected',
      reason: rejection,
      metadata: {
        symbol: signal.symbol,
        direction: signal.direction,
        strategy: signal.strategy ?? 'standard',
        session: signal.session ?? null,
        smartSettings,
      },
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
      strategy: signal.strategy ?? 'standard',
      session: signal.session ?? null,
      smartSettings,
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
        metadata: {
          confidence: signal.confidence,
          strategy: signal.strategy ?? 'standard',
          session: signal.session ?? null,
          smartSettings,
        },
      });
      return { action: 'rejected', reason: 'low_confidence' };
    }
  }

  if (signal.strategy === 'gold_scalper' && signal.confidence !== 'A+') {
    await createAutoTradeLog({
      userId: signal.userId,
      tradeId: null,
      action: 'rejected',
      reason: 'Gold scalper requires A+ confidence',
      metadata: {
        confidence: signal.confidence,
        strategy: signal.strategy,
        session: signal.session ?? null,
        smartSettings,
      },
    });
    return { action: 'rejected', reason: 'low_confidence' };
  }

  // Full mode or semi with high confidence → execute
  return executeTrade(signal, settings, smartSettings);
};

export const executeTrade = async (
  signal: ScannerSignal,
  settings: AutoTradeSettingsRecord,
  smartSettings: UserTradingSettingsRecord,
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
      metadata: {
        orderId,
        lotSize,
        balance: accountInfo.balance,
        strategy: signal.strategy ?? 'standard',
        session: signal.session ?? null,
        smartSettings,
      },
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
      metadata: {
        strategy: signal.strategy ?? 'standard',
        session: signal.session ?? null,
        smartSettings,
      },
    });

    return { action: 'rejected', reason: 'execution_error' };
  }
};

// ── Validation ──

const validateSignal = async (
  signal: ScannerSignal,
  settings: AutoTradeSettingsRecord,
  smartSettings: UserTradingSettingsRecord,
): Promise<RejectionReason | null> => {
  if (settings.autoMode === 'off') return 'auto_mode_off';
  if (!settings.isActive) return 'not_active';
  if (!settings.apiTokenEncrypted || !settings.ctraderAccountId) return 'no_ctrader_connection';

  const recentClosedTrades = await listAutoTradesForUser(signal.userId, 'closed', 20);
  const consecutiveLosses = countConsecutiveLosses(recentClosedTrades);
  if (smartSettings.auto_pause_enabled && consecutiveLosses >= smartSettings.max_losses_in_row) {
    await createAutoTradeLog({
      userId: signal.userId,
      tradeId: null,
      action: 'rejected',
      reason: 'Auto pause triggered after consecutive losses',
      metadata: {
        consecutiveLosses,
        maxLossesInRow: smartSettings.max_losses_in_row,
        smartSettings,
      },
    });
    await disableTradingAfterAutoPause(signal.userId);
    return 'auto_paused';
  }

  // Gold-only filter
  if (settings.goldOnly && signal.symbol !== 'XAUUSD') return 'gold_only_filter';

  // Market state check
  if (signal.marketState === 'choppy') return 'chop_market';

  const normalizedStrategy = (signal.strategy ?? 'standard') as string;
  if (normalizedStrategy !== smartSettings.strategy_mode && !(smartSettings.strategy_mode === 'standard' && normalizedStrategy === 'standard')) {
    return 'strategy_mismatch';
  }

  const signalConfidence = getConfidenceScore(signal.confidence);
  if (signalConfidence <= 1) return 'low_confidence';

  const requiredConfidence = Math.max(smartSettings.min_confidence, getPersonalityMinConfidence(smartSettings.personality));
  if (signalConfidence < requiredConfidence) return 'confidence_locked';

  const assetClass = getAssetClassForSymbol(signal.symbol);
  if (!smartSettings.allowed_assets.includes(assetClass)) return 'asset_not_allowed';

  // SL distance check
  const slDistance = Math.abs(signal.entryPrice - signal.sl);
  const minSl = MIN_SL_DISTANCE[signal.symbol] ?? MIN_SL_DISTANCE.DEFAULT;
  if (slDistance < minSl) return 'sl_too_small';

  // Session check
  const currentSession = getNormalizedSignalSession(signal);
  if (!smartSettings.allowed_sessions.includes(currentSession as 'london' | 'newyork')) return 'session_not_allowed';

  const recentLogs = await listAutoTradeLogsForUser(signal.userId, 100);
  const sessionTradeLimit = getPersonalitySessionTradeLimit(smartSettings.personality);
  if (sessionTradeLimit !== null) {
    const sessionExecutions = recentLogs.filter((log) => {
      const metadata = log.metadata as Record<string, unknown> | null;
      return log.action === 'executed' && metadata?.session === currentSession;
    });
    if (sessionExecutions.length >= sessionTradeLimit) {
      return 'personality_session_limit';
    }
  }

  if (signal.strategy === 'gold_scalper') {
    const goldScalperExecutions = recentLogs.filter((log) => {
      const metadata = log.metadata as Record<string, unknown> | null;
      return log.action === 'executed' && metadata?.strategy === 'gold_scalper';
    });

    const sessionExecutions = goldScalperExecutions.filter((log) => {
      const metadata = log.metadata as Record<string, unknown> | null;
      return metadata?.session === currentSession;
    });

    if (sessionExecutions.length >= GOLD_SCALPER_MAX_TRADES_PER_SESSION) {
      return 'gold_scalper_session_limit';
    }

    const latestExecution = goldScalperExecutions[0];
    if (latestExecution && Date.now() - new Date(latestExecution.createdAt).getTime() < GOLD_SCALPER_COOLDOWN_MS) {
      return 'strategy_cooldown';
    }
  }

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

const disableTradingAfterAutoPause = async (userId: string) => {
  const settings = await getAutoTradeSettings(userId);
  if (!settings) {
    return;
  }

  await createAutoTradeLog({
    userId,
    tradeId: null,
    action: 'emergency_stop',
    reason: 'Auto trader paused after hitting the consecutive-loss limit.',
    metadata: { source: 'auto_pause' },
  });

  await upsertAutoTradeSettings(userId, { isActive: false, autoMode: 'off' });
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
