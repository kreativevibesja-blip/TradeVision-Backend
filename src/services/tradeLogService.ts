import { supabase } from '../lib/supabase';
import type { ScanCloseReason, ScanResult, ScanResultStatus, SessionType } from './scannerService';

const TRADE_TABLE = 'trades';
const TRADE_ACTION_TABLE = 'user_trade_actions';
const SCAN_RESULT_TABLE = 'ScanResult';

export type TradeDecisionAction = 'taken' | 'skipped';
export type TradeLogStatus = 'pending' | 'win' | 'loss';

interface TradeRow {
  id: string;
  user_id: string;
  scan_result_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  sl: number;
  tp: number;
  status: TradeLogStatus;
  strategy: string | null;
  session_type: SessionType | null;
  timeframe: string | null;
  created_at: string;
  closed_at: string | null;
}

interface TradeActionRow {
  id: string;
  user_id: string;
  trade_id: string;
  action: TradeDecisionAction;
  skip_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface ScanResultStatusRow {
  id: string;
  status: ScanResultStatus;
}

export interface TradeDecisionCardData {
  tradeId: string;
  scanResultId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  strategy: string | null;
  sessionType: SessionType | null;
  timeframe: string | null;
  tradeStatus: TradeLogStatus;
  scanResultStatus: ScanResultStatus;
  action: TradeDecisionAction | null;
  skipReason: string | null;
  createdAt: string;
}

export interface TradeJournalStats {
  totalSignals: number;
  totalTaken: number;
  totalSkipped: number;
  unansweredSignals: number;
  resolvedTaken: number;
  takenWins: number;
  takenLosses: number;
  winRate: number;
  missedWins: number;
  missedLosses: number;
  allSignalsR: number;
  followedSignalsR: number;
}

export interface UserTradeJournalOverview {
  activeTrades: TradeDecisionCardData[];
  stats: TradeJournalStats;
  insights: string[];
  generatedAt: string;
}

export interface AdminTradeLogOverview {
  summary: {
    totalTradesGenerated: number;
    pendingTrades: number;
    resolvedTrades: number;
    takenCount: number;
    skippedCount: number;
    takenRate: number;
    skippedRate: number;
  };
  skipReasons: Array<{ reason: string; count: number }>;
  bestSignals: Array<{
    symbol: string;
    direction: 'buy' | 'sell';
    strategy: string | null;
    total: number;
    wins: number;
    losses: number;
    winRate: number;
    netR: number;
  }>;
  generatedAt: string;
}

const getTradeTakeProfit = (result: ScanResult) => {
  if (result.takeProfit2 != null && Number.isFinite(result.takeProfit2)) {
    return result.takeProfit2;
  }

  return result.takeProfit;
};

const getTradeRMultiple = (trade: TradeRow) => {
  const risk = Math.abs(Number(trade.entry) - Number(trade.sl));
  if (!Number.isFinite(risk) || risk <= 0) {
    return 0;
  }

  const reward = Math.abs(Number(trade.tp) - Number(trade.entry));
  if (!Number.isFinite(reward)) {
    return 0;
  }

  return reward / risk;
};

const getTradeOutcomeR = (trade: TradeRow) => {
  if (trade.status === 'win') {
    return getTradeRMultiple(trade);
  }

  if (trade.status === 'loss') {
    return -1;
  }

  return 0;
};

const roundToTwo = (value: number) => Math.round(value * 100) / 100;

const formatRValue = (value: number) => `${value >= 0 ? '+' : ''}${roundToTwo(value).toFixed(2)}R`;

export async function createTradeLogFromScanResult(result: ScanResult): Promise<void> {
  const payload = {
    user_id: result.userId,
    scan_result_id: result.id,
    symbol: result.symbol,
    direction: result.direction,
    entry: result.entry,
    sl: result.stopLoss,
    tp: getTradeTakeProfit(result),
    status: 'pending' as const,
    strategy: result.strategy,
    session_type: result.sessionType,
    timeframe: result.timeframe,
  };

  const { error } = await supabase
    .from(TRADE_TABLE)
    .upsert(payload, { onConflict: 'scan_result_id' });

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncTradeLogFromScanResult(
  scanResultId: string,
  status: ScanResultStatus,
  closeReason: ScanCloseReason,
  closedAt: string | null,
): Promise<void> {
  if (status !== 'closed' || !closeReason) {
    return;
  }

  const nextStatus: TradeLogStatus = closeReason === 'tp' ? 'win' : 'loss';
  const { error } = await supabase
    .from(TRADE_TABLE)
    .update({
      status: nextStatus,
      closed_at: closedAt ?? new Date().toISOString(),
    })
    .eq('scan_result_id', scanResultId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function recordTradeDecision(
  userId: string,
  tradeId: string,
  action: TradeDecisionAction,
  skipReason?: string | null,
): Promise<TradeDecisionCardData> {
  const normalizedReason = typeof skipReason === 'string' && skipReason.trim().length > 0
    ? skipReason.trim()
    : null;

  const { data: trade, error: tradeError } = await supabase
    .from(TRADE_TABLE)
    .select('*')
    .eq('id', tradeId)
    .eq('user_id', userId)
    .single();

  if (tradeError || !trade) {
    throw new Error(tradeError?.message || 'Trade not found');
  }

  const tradeRow = trade as TradeRow;
  if (tradeRow.status !== 'pending') {
    throw new Error('Trade can no longer be updated');
  }

  if (action === 'skipped' && !normalizedReason) {
    throw new Error('Skip reason is required when skipping a trade');
  }

  const { error: actionError } = await supabase
    .from(TRADE_ACTION_TABLE)
    .upsert({
      user_id: userId,
      trade_id: tradeId,
      action,
      skip_reason: action === 'skipped' ? normalizedReason : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,trade_id' });

  if (actionError) {
    throw new Error(actionError.message);
  }

  const { data: scanResult, error: scanError } = await supabase
    .from(SCAN_RESULT_TABLE)
    .select('id, status')
    .eq('id', tradeRow.scan_result_id)
    .single();

  if (scanError || !scanResult) {
    throw new Error(scanError?.message || 'Linked scan result not found');
  }

  return {
    tradeId: tradeRow.id,
    scanResultId: tradeRow.scan_result_id,
    symbol: tradeRow.symbol,
    direction: tradeRow.direction,
    entry: Number(tradeRow.entry),
    stopLoss: Number(tradeRow.sl),
    takeProfit: Number(tradeRow.tp),
    strategy: tradeRow.strategy,
    sessionType: tradeRow.session_type,
    timeframe: tradeRow.timeframe,
    tradeStatus: tradeRow.status,
    scanResultStatus: (scanResult as ScanResultStatusRow).status,
    action,
    skipReason: action === 'skipped' ? normalizedReason : null,
    createdAt: tradeRow.created_at,
  };
}

export async function getUserTradeJournal(userId: string): Promise<UserTradeJournalOverview> {
  const { data: tradeData, error: tradeError } = await supabase
    .from(TRADE_TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (tradeError) {
    throw new Error(tradeError.message);
  }

  const trades = (tradeData ?? []) as TradeRow[];
  if (trades.length === 0) {
    return {
      activeTrades: [],
      stats: {
        totalSignals: 0,
        totalTaken: 0,
        totalSkipped: 0,
        unansweredSignals: 0,
        resolvedTaken: 0,
        takenWins: 0,
        takenLosses: 0,
        winRate: 0,
        missedWins: 0,
        missedLosses: 0,
        allSignalsR: 0,
        followedSignalsR: 0,
      },
      insights: [
        'No trade signals have been logged yet.',
        'Your followed-trade expectancy will appear here once outcomes resolve.',
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  const tradeIds = trades.map((trade) => trade.id);
  const scanResultIds = trades.map((trade) => trade.scan_result_id);

  const [{ data: actionData, error: actionError }, { data: scanResultData, error: scanError }] = await Promise.all([
    supabase
      .from(TRADE_ACTION_TABLE)
      .select('*')
      .eq('user_id', userId)
      .in('trade_id', tradeIds),
    supabase
      .from(SCAN_RESULT_TABLE)
      .select('id, status')
      .in('id', scanResultIds),
  ]);

  if (actionError) {
    throw new Error(actionError.message);
  }

  if (scanError) {
    throw new Error(scanError.message);
  }

  const actions = (actionData ?? []) as TradeActionRow[];
  const scanResults = (scanResultData ?? []) as ScanResultStatusRow[];
  const actionByTradeId = new Map(actions.map((row) => [row.trade_id, row]));
  const scanStatusById = new Map(scanResults.map((row) => [row.id, row.status]));

  const activeTrades: TradeDecisionCardData[] = [];
  for (const trade of trades) {
    const scanResultStatus = scanStatusById.get(trade.scan_result_id);
    if (scanResultStatus !== 'active') {
      continue;
    }

    const action = actionByTradeId.get(trade.id);
    activeTrades.push({
      tradeId: trade.id,
      scanResultId: trade.scan_result_id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry: Number(trade.entry),
      stopLoss: Number(trade.sl),
      takeProfit: Number(trade.tp),
      strategy: trade.strategy,
      sessionType: trade.session_type,
      timeframe: trade.timeframe,
      tradeStatus: trade.status,
      scanResultStatus,
      action: action?.action ?? null,
      skipReason: action?.skip_reason ?? null,
      createdAt: trade.created_at,
    });
  }

  activeTrades.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const totalSignals = trades.length;
  const totalTaken = actions.filter((action) => action.action === 'taken').length;
  const totalSkipped = actions.filter((action) => action.action === 'skipped').length;
  const unansweredSignals = Math.max(0, totalSignals - totalTaken - totalSkipped);
  const resolvedTrades = trades.filter((trade) => trade.status !== 'pending');
  const resolvedTakenTrades = resolvedTrades.filter((trade) => actionByTradeId.get(trade.id)?.action === 'taken');
  const resolvedSkippedTrades = resolvedTrades.filter((trade) => actionByTradeId.get(trade.id)?.action === 'skipped');
  const takenWins = resolvedTakenTrades.filter((trade) => trade.status === 'win').length;
  const takenLosses = resolvedTakenTrades.filter((trade) => trade.status === 'loss').length;
  const missedWins = resolvedSkippedTrades.filter((trade) => trade.status === 'win').length;
  const missedLosses = resolvedSkippedTrades.filter((trade) => trade.status === 'loss').length;
  const resolvedTaken = resolvedTakenTrades.length;
  const winRate = resolvedTaken > 0 ? roundToTwo((takenWins / resolvedTaken) * 100) : 0;
  const allSignalsR = roundToTwo(resolvedTrades.reduce((sum, trade) => sum + getTradeOutcomeR(trade), 0));
  const followedSignalsR = roundToTwo(resolvedTakenTrades.reduce((sum, trade) => sum + getTradeOutcomeR(trade), 0));

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weeklySkippedWins = resolvedSkippedTrades.filter((trade) => {
    const referenceTime = trade.closed_at ?? trade.created_at;
    return new Date(referenceTime).getTime() >= weekStart.getTime() && trade.status === 'win';
  }).length;

  const skipReasonCounts = actions
    .filter((action) => action.action === 'skipped' && action.skip_reason)
    .reduce<Map<string, number>>((counts, action) => {
      const key = action.skip_reason ?? 'Other';
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map());

  const mostCommonSkipReason = Array.from(skipReasonCounts.entries())
    .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  const insights = [
    weeklySkippedWins > 0
      ? `You skipped ${weeklySkippedWins} winning ${weeklySkippedWins === 1 ? 'trade' : 'trades'} this week.`
      : 'You have not skipped any winning trades this week.',
    `If you took every resolved signal: ${formatRValue(allSignalsR)}.`,
    `If you followed your logged trades: ${formatRValue(followedSignalsR)}.`,
  ];

  if (mostCommonSkipReason) {
    insights.push(`Most common skip reason: ${mostCommonSkipReason}.`);
  }

  return {
    activeTrades,
    stats: {
      totalSignals,
      totalTaken,
      totalSkipped,
      unansweredSignals,
      resolvedTaken,
      takenWins,
      takenLosses,
      winRate,
      missedWins,
      missedLosses,
      allSignalsR,
      followedSignalsR,
    },
    insights,
    generatedAt: new Date().toISOString(),
  };
}

export async function getAdminTradeLogOverview(): Promise<AdminTradeLogOverview> {
  const [{ data: tradeData, error: tradeError }, { data: actionData, error: actionError }] = await Promise.all([
    supabase
      .from(TRADE_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from(TRADE_ACTION_TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5000),
  ]);

  if (tradeError) {
    throw new Error(tradeError.message);
  }

  if (actionError) {
    throw new Error(actionError.message);
  }

  const trades = (tradeData ?? []) as TradeRow[];
  const actions = (actionData ?? []) as TradeActionRow[];
  const totalTradesGenerated = trades.length;
  const pendingTrades = trades.filter((trade) => trade.status === 'pending').length;
  const resolvedTrades = trades.filter((trade) => trade.status !== 'pending');
  const takenCount = actions.filter((action) => action.action === 'taken').length;
  const skippedCount = actions.filter((action) => action.action === 'skipped').length;
  const denominator = totalTradesGenerated || 1;

  const skipReasons = Array.from(
    actions
      .filter((action) => action.action === 'skipped' && action.skip_reason)
      .reduce<Map<string, number>>((counts, action) => {
        const reason = action.skip_reason ?? 'Other';
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
        return counts;
      }, new Map())
      .entries(),
  )
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);

  const groupedSignals = new Map<string, {
    symbol: string;
    direction: 'buy' | 'sell';
    strategy: string | null;
    total: number;
    wins: number;
    losses: number;
    netR: number;
  }>();

  for (const trade of resolvedTrades) {
    const key = [trade.symbol, trade.direction, trade.strategy ?? 'Unknown'].join('::');
    const existing = groupedSignals.get(key) ?? {
      symbol: trade.symbol,
      direction: trade.direction,
      strategy: trade.strategy,
      total: 0,
      wins: 0,
      losses: 0,
      netR: 0,
    };

    existing.total += 1;
    if (trade.status === 'win') {
      existing.wins += 1;
    }
    if (trade.status === 'loss') {
      existing.losses += 1;
    }
    existing.netR += getTradeOutcomeR(trade);
    groupedSignals.set(key, existing);
  }

  const bestSignals = Array.from(groupedSignals.values())
    .map((group) => ({
      ...group,
      winRate: group.total > 0 ? roundToTwo((group.wins / group.total) * 100) : 0,
      netR: roundToTwo(group.netR),
    }))
    .sort((left, right) => {
      if (right.netR !== left.netR) {
        return right.netR - left.netR;
      }

      if (right.winRate !== left.winRate) {
        return right.winRate - left.winRate;
      }

      return right.total - left.total;
    })
    .slice(0, 8);

  return {
    summary: {
      totalTradesGenerated,
      pendingTrades,
      resolvedTrades: resolvedTrades.length,
      takenCount,
      skippedCount,
      takenRate: roundToTwo((takenCount / denominator) * 100),
      skippedRate: roundToTwo((skippedCount / denominator) * 100),
    },
    skipReasons,
    bestSignals,
    generatedAt: new Date().toISOString(),
  };
}