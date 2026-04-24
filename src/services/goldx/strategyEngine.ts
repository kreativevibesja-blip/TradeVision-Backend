import { supabase } from '../../lib/supabase';
import { generateDaySignal } from './dayStrategy';
import { generateHybridSignal, generateUnifiedSignal } from './hybridStrategy';
import { analyzeMarketRegime, buildSnapshot, clamp, floorLot, roundLot, type Candle } from './indicators';
import { getModeConfig, insertAuditLog, markOnboardingStateByLicenseId } from './licenseService';
import { generateNightSignal } from './nightStrategy';
import { getSessionType, normalizeSessionMode, resolveAllowedSession, toSessionStatus, type BrokerSession } from './session';
import type { EngineStrategyConfig, EngineTradeControlConfig, StrategyCandidate, StrategyContext, StrategyEvaluation } from './strategyModels';
import type {
  GoldxAccountState,
  GoldxMode,
  GoldxModeConfig,
  GoldxRuntimeTradeState,
  GoldxScalpEntry,
  GoldxSessionMode,
  GoldxSessionStatus,
  GoldxSignal,
} from './types';

type TradeDirection = 'buy' | 'sell';

const DEFAULT_STRATEGY_CONFIG: EngineStrategyConfig = {
  symbol: 'XAUUSD',
  timeframe: 'M5',
  debugLogging: true,
  dayMaxSpreadPoints: 24,
  nightMaxSpreadPoints: 18,
  stableAtrMultiplier: 1.25,
  momentumBodyAtrMultiplier: 0.2,
  microTpAtrMultiplier: 0.35,
  burstSlAtrMultiplier: 0.8,
  dayPullbackMinPct: 0.3,
  dayPullbackMaxPct: 0.5,
  nightSweepAtrBuffer: 0.22,
  confidenceThreshold: 65,
  dayTpMin: 2.0,
  dayTpMax: 5.0,
  daySlMin: 5.0,
  daySlMax: 10.0,
  nightTpMin: 1.5,
  nightTpMax: 4.0,
  nightSlMin: 3.0,
  nightSlMax: 6.0,
  softCooldownFastSeconds: 10,
  softCooldownHybridSeconds: 18,
  softCooldownPropSeconds: 30,
  softOpenTradeLimit: 6,
  defaultBurstEntries: 3,
  maxBurstEntries: 10,
};

const DEFAULT_TRADE_CONTROL: EngineTradeControlConfig = {
  dailyProfitStopPercent: 3.0,
  dailyDrawdownStopPercent: 2.0,
  maxTradesPerMinute: 10,
  maxLossPerBatchPercent: 1.5,
  maxBurstsPerHour: 6,
  burstLossStreakLimit: 3,
  burstDelayMsMin: 300,
  burstDelayMsMax: 800,
};

const HARD_OPEN_TRADE_LIMIT = 10;
const BURST_ENTRY_SPLITS = [0.18, 0.16, 0.14, 0.12, 0.1, 0.09, 0.08, 0.06, 0.04, 0.03];
const MAX_LOT_BY_MODE: Record<GoldxMode, number> = {
  fast: 1.0,
  hybrid: 0.75,
  prop: 0.5,
};

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function getStrategyConfig(): Promise<EngineStrategyConfig> {
  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', 'strategy')
    .maybeSingle();

  const value = (data?.value ?? {}) as Record<string, unknown>;
  return {
    symbol: typeof value.symbol === 'string' ? value.symbol : DEFAULT_STRATEGY_CONFIG.symbol,
    timeframe: typeof value.timeframe === 'string' ? value.timeframe : DEFAULT_STRATEGY_CONFIG.timeframe,
    debugLogging: typeof value.debugLogging === 'boolean' ? value.debugLogging : DEFAULT_STRATEGY_CONFIG.debugLogging,
    dayMaxSpreadPoints: asNumber(value.dayMaxSpreadPoints, DEFAULT_STRATEGY_CONFIG.dayMaxSpreadPoints),
    nightMaxSpreadPoints: asNumber(value.nightMaxSpreadPoints, DEFAULT_STRATEGY_CONFIG.nightMaxSpreadPoints),
    stableAtrMultiplier: asNumber(value.stableAtrMultiplier, DEFAULT_STRATEGY_CONFIG.stableAtrMultiplier),
    momentumBodyAtrMultiplier: asNumber(value.momentumBodyAtrMultiplier, DEFAULT_STRATEGY_CONFIG.momentumBodyAtrMultiplier),
    microTpAtrMultiplier: asNumber(value.microTpAtrMultiplier, DEFAULT_STRATEGY_CONFIG.microTpAtrMultiplier),
    burstSlAtrMultiplier: asNumber(value.burstSlAtrMultiplier, DEFAULT_STRATEGY_CONFIG.burstSlAtrMultiplier),
    dayPullbackMinPct: asNumber(value.dayPullbackMinPct, DEFAULT_STRATEGY_CONFIG.dayPullbackMinPct),
    dayPullbackMaxPct: asNumber(value.dayPullbackMaxPct, DEFAULT_STRATEGY_CONFIG.dayPullbackMaxPct),
    nightSweepAtrBuffer: asNumber(value.nightSweepAtrBuffer, DEFAULT_STRATEGY_CONFIG.nightSweepAtrBuffer),
    confidenceThreshold: asNumber(value.confidenceThreshold, DEFAULT_STRATEGY_CONFIG.confidenceThreshold),
    dayTpMin: asNumber(value.dayTpMin, DEFAULT_STRATEGY_CONFIG.dayTpMin),
    dayTpMax: asNumber(value.dayTpMax, DEFAULT_STRATEGY_CONFIG.dayTpMax),
    daySlMin: asNumber(value.daySlMin, DEFAULT_STRATEGY_CONFIG.daySlMin),
    daySlMax: asNumber(value.daySlMax, DEFAULT_STRATEGY_CONFIG.daySlMax),
    nightTpMin: asNumber(value.nightTpMin, DEFAULT_STRATEGY_CONFIG.nightTpMin),
    nightTpMax: asNumber(value.nightTpMax, DEFAULT_STRATEGY_CONFIG.nightTpMax),
    nightSlMin: asNumber(value.nightSlMin, DEFAULT_STRATEGY_CONFIG.nightSlMin),
    nightSlMax: asNumber(value.nightSlMax, DEFAULT_STRATEGY_CONFIG.nightSlMax),
    softCooldownFastSeconds: asNumber(value.softCooldownFastSeconds, DEFAULT_STRATEGY_CONFIG.softCooldownFastSeconds),
    softCooldownHybridSeconds: asNumber(value.softCooldownHybridSeconds, DEFAULT_STRATEGY_CONFIG.softCooldownHybridSeconds),
    softCooldownPropSeconds: asNumber(value.softCooldownPropSeconds, DEFAULT_STRATEGY_CONFIG.softCooldownPropSeconds),
    softOpenTradeLimit: asNumber(value.softOpenTradeLimit, DEFAULT_STRATEGY_CONFIG.softOpenTradeLimit),
    defaultBurstEntries: asNumber(value.defaultBurstEntries, DEFAULT_STRATEGY_CONFIG.defaultBurstEntries),
    maxBurstEntries: asNumber(value.maxBurstEntries, DEFAULT_STRATEGY_CONFIG.maxBurstEntries),
  };
}

async function getTradeControlConfig(): Promise<EngineTradeControlConfig> {
  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', 'tradeControl')
    .maybeSingle();

  const value = (data?.value ?? {}) as Record<string, unknown>;
  return {
    dailyProfitStopPercent: asNumber(value.dailyProfitStopPercent, DEFAULT_TRADE_CONTROL.dailyProfitStopPercent),
    dailyDrawdownStopPercent: asNumber(value.dailyDrawdownStopPercent, DEFAULT_TRADE_CONTROL.dailyDrawdownStopPercent),
    maxTradesPerMinute: asNumber(value.maxTradesPerMinute, DEFAULT_TRADE_CONTROL.maxTradesPerMinute),
    maxLossPerBatchPercent: asNumber(value.maxLossPerBatchPercent, DEFAULT_TRADE_CONTROL.maxLossPerBatchPercent),
    maxBurstsPerHour: asNumber(value.maxBurstsPerHour, DEFAULT_TRADE_CONTROL.maxBurstsPerHour),
    burstLossStreakLimit: asNumber(value.burstLossStreakLimit, DEFAULT_TRADE_CONTROL.burstLossStreakLimit),
    burstDelayMsMin: asNumber(value.burstDelayMsMin, DEFAULT_TRADE_CONTROL.burstDelayMsMin),
    burstDelayMsMax: asNumber(value.burstDelayMsMax, DEFAULT_TRADE_CONTROL.burstDelayMsMax),
  };
}

function getSoftCooldownSeconds(mode: GoldxMode, strategyConfig: EngineStrategyConfig): number {
  if (mode === 'fast') return strategyConfig.softCooldownFastSeconds;
  if (mode === 'prop') return strategyConfig.softCooldownPropSeconds;
  return strategyConfig.softCooldownHybridSeconds;
}

function canReenter(
  mode: GoldxMode,
  strategyConfig: EngineStrategyConfig,
  runtimeState: Required<GoldxRuntimeTradeState>,
): boolean {
  if (!runtimeState.lastBatchClosedAt) return true;
  const elapsedMs = Date.now() - new Date(runtimeState.lastBatchClosedAt).getTime();
  return elapsedMs >= getSoftCooldownSeconds(mode, strategyConfig) * 1000;
}

function normalizeRuntimeState(
  accountState: GoldxAccountState,
  runtimeState?: GoldxRuntimeTradeState,
): Required<GoldxRuntimeTradeState> {
  return {
    currentOpenTrades: typeof runtimeState?.currentOpenTrades === 'number' ? runtimeState.currentOpenTrades : 0,
    tradesOpenedLastMinute: runtimeState?.tradesOpenedLastMinute ?? 0,
    profitToday: runtimeState?.profitToday ?? accountState.profitToday,
    lastBatchClosedAt: runtimeState?.lastBatchClosedAt ?? accountState.lastBatchClosedAt ?? null,
    losingBatchesInRow: runtimeState?.losingBatchesInRow ?? accountState.consecutiveLosingBatches ?? 0,
    burstActive: runtimeState?.burstActive ?? accountState.burstActive ?? false,
    burstTradesOpened: runtimeState?.burstTradesOpened ?? accountState.burstTradesOpened ?? 0,
    burstsLastHour: runtimeState?.burstsLastHour ?? 0,
    burstLossesInRow: runtimeState?.burstLossesInRow ?? 0,
  };
}

function signalSession(session: BrokerSession): 'day' | 'night' | 'off' {
  return session === 'inactive' ? 'off' : session;
}

function buildNoSignal(
  now: string,
  mode: GoldxMode,
  session: BrokerSession,
  reason: string,
  extras: Partial<GoldxSignal> = {},
): GoldxSignal {
  return {
    action: 'none',
    entry: null,
    stopLoss: null,
    takeProfit: null,
    lotSize: null,
    entries: [],
    batchId: null,
    reentryAllowed: false,
    burstActive: false,
    burstTradesOpened: 0,
    maxBurstTrades: HARD_OPEN_TRADE_LIMIT,
    maxTrades: 0,
    confidence: 0,
    reason,
    mode,
    timestamp: now,
    session: signalSession(session),
    sessionType: toSessionStatus(session),
    ...extras,
  };
}

function toTradeDirection(action: string): TradeDirection | null {
  if (action === 'buy' || action === 'burst_buy') return 'buy';
  if (action === 'sell' || action === 'burst_sell') return 'sell';
  return null;
}

function clampRiskPercent(mode: GoldxMode, configuredRisk: number): number {
  if (mode === 'fast') return clamp(configuredRisk, 0.8, 1.2);
  if (mode === 'prop') return clamp(configuredRisk, 0.3, 0.6);
  return clamp(configuredRisk, 0.5, 0.9);
}

function calculateLotSize(
  mode: GoldxMode,
  configuredRiskPercent: number,
  accountBalance: number,
  entry: number,
  stopLoss: number,
): number {
  const riskPercent = clampRiskPercent(mode, configuredRiskPercent);
  const riskAmount = accountBalance * (riskPercent / 100);
  const distance = Math.abs(entry - stopLoss);
  if (distance <= 0) return 0.01;
  return Math.max(0.01, Math.round((riskAmount / (distance * 100)) * 100) / 100);
}

function capLotByBalance(lotSize: number, accountBalance: number): number {
  if (accountBalance <= 0) return lotSize;
  const maxAffordableLot = floorLot(accountBalance / 1000);
  return Math.min(lotSize, maxAffordableLot);
}

function resolveExecutionLot(
  mode: GoldxMode,
  configuredRiskPercent: number,
  accountState: GoldxAccountState,
  accountBalance: number,
  entry: number,
  stopLoss: number,
): { lotSize: number; lotMode: GoldxAccountState['lotMode']; userLot: number | null } {
  const userLot = typeof accountState.userLotSize === 'number' && Number.isFinite(accountState.userLotSize)
    ? clamp(accountState.userLotSize, 0.01, 5.0)
    : null;

  let lotSize = accountState.lotMode === 'manual' && userLot != null
    ? userLot
    : calculateLotSize(mode, configuredRiskPercent, accountBalance, entry, stopLoss);

  lotSize = Math.min(lotSize, MAX_LOT_BY_MODE[mode]);
  lotSize = capLotByBalance(lotSize, accountBalance);

  return {
    lotSize: lotSize > 0 ? floorLot(lotSize) : 0,
    lotMode: accountState.lotMode,
    userLot,
  };
}

function buildBatchId(licenseId: string): string {
  return `burst_${licenseId.slice(0, 8)}_${Date.now().toString(36)}`;
}

function getModeBurstCap(mode: GoldxMode, accountState: GoldxAccountState, config: EngineStrategyConfig): number {
  const configuredCap = Number(accountState.maxBurstTrades ?? 0);
  const fallback = mode === 'fast' ? 5 : mode === 'hybrid' ? 4 : 3;
  return clamp(configuredCap > 0 ? configuredCap : fallback, 1, config.maxBurstEntries);
}

function buildEntries(
  direction: TradeDirection,
  baseLot: number,
  candidate: StrategyCandidate,
  entryCount: number,
): GoldxScalpEntry[] {
  const weights = BURST_ENTRY_SPLITS.slice(0, entryCount);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || entryCount;
  const step = Math.max(0.01, Math.min(0.08, Math.abs(candidate.takeProfit - candidate.entry) * 0.08));

  return weights.map((weight, index) => ({
    lot: roundLot(baseLot * (weight / totalWeight)),
    entry: candidate.entry + (direction === 'buy' ? index * step : index * -step),
    tp: candidate.takeProfit,
    sl: candidate.stopLoss,
  }));
}

function calculateProjectedLossPercent(entries: GoldxScalpEntry[], accountBalance: number): number {
  if (!entries.length || accountBalance <= 0) return 0;
  const projectedLoss = entries.reduce((sum, entry) => sum + (entry.lot * Math.abs(entry.entry - entry.sl) * 100), 0);
  return (projectedLoss / accountBalance) * 100;
}

function passesTradeControl(
  accountState: GoldxAccountState,
  tradeControl: EngineTradeControlConfig,
  runtimeState: Required<GoldxRuntimeTradeState>,
): { pass: boolean; reason: string } {
  if (runtimeState.currentOpenTrades >= HARD_OPEN_TRADE_LIMIT) {
    return { pass: false, reason: `Hard open trade limit reached (${HARD_OPEN_TRADE_LIMIT})` };
  }
  if (runtimeState.tradesOpenedLastMinute >= tradeControl.maxTradesPerMinute) {
    return { pass: false, reason: `Per-minute trade cap reached (${tradeControl.maxTradesPerMinute})` };
  }
  if (runtimeState.burstsLastHour >= tradeControl.maxBurstsPerHour) {
    return { pass: false, reason: `Max bursts per hour reached (${tradeControl.maxBurstsPerHour})` };
  }
  if (runtimeState.burstLossesInRow >= tradeControl.burstLossStreakLimit) {
    return { pass: false, reason: `Burst paused after ${tradeControl.burstLossStreakLimit} losses in a row` };
  }
  if (runtimeState.profitToday >= Math.min(accountState.dailyTargetPercent || tradeControl.dailyProfitStopPercent, tradeControl.dailyProfitStopPercent)) {
    return { pass: false, reason: `Daily target reached (${runtimeState.profitToday.toFixed(2)}%)` };
  }
  if (accountState.drawdownToday >= tradeControl.dailyDrawdownStopPercent) {
    return { pass: false, reason: `Daily drawdown limit reached (${accountState.drawdownToday.toFixed(2)}%)` };
  }
  if (accountState.pausedUntil && new Date(accountState.pausedUntil).getTime() > Date.now()) {
    return { pass: false, reason: `Loss pause active until ${accountState.pausedUntil}` };
  }
  return { pass: true, reason: 'Trade control passed' };
}

function logDebug(config: EngineStrategyConfig, payload: Record<string, unknown>): void {
  if (!config.debugLogging) return;
  console.log('GoldX Strategy Debug', payload);
}

function dispatchStrategy(sessionMode: ReturnType<typeof normalizeSessionMode>, context: StrategyContext): StrategyEvaluation {
  if (sessionMode === 'day') return generateDaySignal(context);
  if (sessionMode === 'night') return generateNightSignal(context);
  if (sessionMode === 'all_sessions') return generateUnifiedSignal(context);
  return generateHybridSignal(context);
}

function buildSignalFromEvaluation(
  evaluation: StrategyEvaluation,
  context: StrategyContext,
  modeConfig: GoldxModeConfig,
  accountBalance: number,
): GoldxSignal {
  const { now, mode, session, accountState, runtimeState, config, tradeControl } = context;
  const debugBase = {
    mode: context.sessionMode,
    session: signalSession(session),
    trend: context.regime.trending,
    rangeDetected: context.regime.ranging,
    spread: context.snapshot.spread,
    atr: context.snapshot.atr,
    reason: evaluation.reason,
    tradesToday: accountState.tradesToday,
    maxTrades: modeConfig.maxTrades,
    currentOpenTrades: runtimeState.currentOpenTrades,
    confidence: evaluation.candidate?.confidence ?? 0,
  };

  if (!evaluation.candidate) {
    return buildNoSignal(now, mode, session, evaluation.reason, {
      strategyName: 'strategy-dispatcher',
      reentryAllowed: canReenter(mode, config, runtimeState),
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: HARD_OPEN_TRADE_LIMIT,
      maxTrades: modeConfig.maxTrades,
      debug: { ...debugBase, ...evaluation.debug },
    });
  }

  const candidate = evaluation.candidate;
  const lotConfig = resolveExecutionLot(mode, modeConfig.riskPercent, accountState, accountBalance, candidate.entry, candidate.stopLoss);
  let baseLot = lotConfig.lotSize * (candidate.lotMultiplier ?? 1);
  baseLot = Math.min(baseLot, MAX_LOT_BY_MODE[mode]);
  baseLot = capLotByBalance(baseLot, accountBalance);

  if (baseLot < 0.01) {
    return buildNoSignal(now, mode, session, 'Account balance too low for the minimum safe lot size', {
      strategyName: candidate.strategyName,
      lotMode: lotConfig.lotMode,
      userLot: lotConfig.userLot,
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: HARD_OPEN_TRADE_LIMIT,
      maxTrades: modeConfig.maxTrades,
      debug: { ...debugBase, ...evaluation.debug, ...candidate.debug },
    });
  }

  const availableSlots = Math.max(0, HARD_OPEN_TRADE_LIMIT - runtimeState.currentOpenTrades);
  if (availableSlots <= 0) {
    return buildNoSignal(now, mode, session, `Hard open trade limit reached (${HARD_OPEN_TRADE_LIMIT})`, {
      strategyName: candidate.strategyName,
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: HARD_OPEN_TRADE_LIMIT,
      maxTrades: modeConfig.maxTrades,
      debug: { ...debugBase, ...evaluation.debug, ...candidate.debug },
    });
  }

  let entryCount = Math.min(
    candidate.entriesCount,
    getModeBurstCap(mode, accountState, config),
    config.maxBurstEntries,
    availableSlots,
  );

  if (runtimeState.currentOpenTrades >= config.softOpenTradeLimit) {
    entryCount = Math.max(1, entryCount - 2);
  }

  let entries = buildEntries(candidate.action, baseLot, candidate, entryCount);
  while (entries.length > 1 && calculateProjectedLossPercent(entries, accountBalance) > tradeControl.maxLossPerBatchPercent) {
    entryCount -= 1;
    entries = buildEntries(candidate.action, baseLot, candidate, entryCount);
  }

  if (!entries.length || calculateProjectedLossPercent(entries, accountBalance) > tradeControl.maxLossPerBatchPercent) {
    return buildNoSignal(now, mode, session, 'Projected risk exceeds max loss per batch', {
      strategyName: candidate.strategyName,
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: HARD_OPEN_TRADE_LIMIT,
      maxTrades: modeConfig.maxTrades,
      debug: { ...debugBase, ...evaluation.debug, ...candidate.debug },
    });
  }

  const batchId = buildBatchId(accountState.licenseId);
  return {
    action: candidate.action,
    entry: candidate.entry,
    stopLoss: candidate.stopLoss,
    takeProfit: candidate.takeProfit,
    lotSize: entries[0]?.lot ?? null,
    lotSizeUsed: baseLot,
    lotMode: lotConfig.lotMode,
    userLot: lotConfig.userLot,
    entries,
    batchId,
    reentryAllowed: true,
    burstActive: entries.length > 1,
    burstTradesOpened: entries.length,
    maxBurstTrades: getModeBurstCap(mode, accountState, config),
    maxTrades: entries.length,
    burstDelayMsMin: tradeControl.burstDelayMsMin,
    burstDelayMsMax: tradeControl.burstDelayMsMax,
    closeOnMomentumLoss: candidate.trend,
    maxSimultaneousTrades: HARD_OPEN_TRADE_LIMIT,
    currentOpenTrades: runtimeState.currentOpenTrades,
    confidence: candidate.confidence,
    reason: candidate.reason,
    mode,
    timestamp: now,
    session: signalSession(session),
    sessionType: toSessionStatus(session),
    strategyName: candidate.strategyName,
    sweepDetected: candidate.sweepDetected,
    bosConfirmed: candidate.bosConfirmed,
    trendAligned: candidate.trendAligned,
    debug: { ...debugBase, ...evaluation.debug, ...candidate.debug },
  };
}

export async function isWithinTradingSession(sessionMode: GoldxSessionMode): Promise<boolean> {
  const brokerSession = getSessionType();
  return resolveAllowedSession(normalizeSessionMode(sessionMode), brokerSession) !== 'inactive';
}

export async function getCurrentSessionStatus(sessionMode: GoldxSessionMode): Promise<GoldxSessionStatus> {
  const brokerSession = getSessionType();
  const activeSession = resolveAllowedSession(normalizeSessionMode(sessionMode), brokerSession);
  return toSessionStatus(activeSession);
}

export async function generateSignal(
  accountState: GoldxAccountState,
  candles: Candle[],
  currentBid: number,
  currentAsk: number,
  accountBalance: number = 10000,
  runtimeTradeState?: GoldxRuntimeTradeState,
): Promise<GoldxSignal> {
  const now = new Date().toISOString();
  const mode = accountState.mode;
  const sessionMode = normalizeSessionMode(accountState.sessionMode ?? 'hybrid');

  if (!accountState.tradesToday || accountState.tradesToday < 0) {
    accountState.tradesToday = 0;
  }

  const [strategyConfig, tradeControl, resolvedModeConfig] = await Promise.all([
    getStrategyConfig(),
    getTradeControlConfig(),
    getModeConfig(mode),
  ]);

  const modeConfig = { ...resolvedModeConfig };
  modeConfig.maxTrades = Number(modeConfig.maxTrades);
  if (!modeConfig.maxTrades || modeConfig.maxTrades <= 0) {
    modeConfig.maxTrades = HARD_OPEN_TRADE_LIMIT;
  }

  const brokerSession = getSessionType();
  const activeSession = resolveAllowedSession(sessionMode, brokerSession);
  const runtimeState = normalizeRuntimeState(accountState, runtimeTradeState);

  if (activeSession === 'inactive') {
    return buildNoSignal(now, mode, activeSession, 'Outside configured trading session', {
      strategyName: 'session-router',
      maxTrades: modeConfig.maxTrades,
      currentOpenTrades: runtimeState.currentOpenTrades,
      debug: {
        mode: sessionMode,
        session: 'off',
        trend: false,
        rangeDetected: false,
        spread: 0,
        atr: 0,
        reason: 'Outside configured trading session',
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  const gate = passesTradeControl(accountState, tradeControl, runtimeState);
  if (!gate.pass) {
    return buildNoSignal(now, mode, activeSession, gate.reason, {
      strategyName: 'trade-guard',
      maxTrades: modeConfig.maxTrades,
      currentOpenTrades: runtimeState.currentOpenTrades,
      debug: {
        mode: sessionMode,
        session: signalSession(activeSession),
        trend: false,
        rangeDetected: false,
        spread: 0,
        atr: 0,
        reason: gate.reason,
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  if (!canReenter(mode, strategyConfig, runtimeState)) {
    return buildNoSignal(now, mode, activeSession, 'Soft cooldown active', {
      strategyName: 'cooldown-guard',
      reentryAllowed: false,
      maxTrades: modeConfig.maxTrades,
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: HARD_OPEN_TRADE_LIMIT,
      debug: {
        mode: sessionMode,
        session: signalSession(activeSession),
        trend: false,
        rangeDetected: false,
        spread: 0,
        atr: 0,
        reason: 'Soft cooldown active',
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  if (!candles.length) {
    return buildNoSignal(now, mode, activeSession, 'No market candles supplied', {
      strategyName: 'snapshot-builder',
      maxTrades: modeConfig.maxTrades,
      currentOpenTrades: runtimeState.currentOpenTrades,
      debug: {
        mode: sessionMode,
        session: signalSession(activeSession),
        trend: false,
        rangeDetected: false,
        spread: 0,
        atr: 0,
        reason: 'No market candles supplied',
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  const snapshot = buildSnapshot(candles, currentBid, currentAsk);
  const regime = analyzeMarketRegime(snapshot);
  const context: StrategyContext = {
    now,
    mode,
    sessionMode,
    session: activeSession,
    accountState,
    runtimeState,
    snapshot,
    regime,
    config: strategyConfig,
    tradeControl,
  };

  const evaluation = dispatchStrategy(sessionMode, context);
  const signal = buildSignalFromEvaluation(evaluation, context, modeConfig, accountBalance);

  logDebug(strategyConfig, {
    action: signal.action,
    reason: signal.reason,
    strategyName: signal.strategyName,
    sessionMode,
    session: signal.session,
    confidence: signal.confidence,
    spread: snapshot.spread,
    atr: snapshot.atr,
    openTrades: runtimeState.currentOpenTrades,
  });

  return signal;
}

async function persistTradeHistory(
  licenseId: string,
  mt5Account: string,
  options: {
    direction: TradeDirection;
    mode: GoldxMode;
    entries: Array<{ lot: number; entry: number; tp: number; sl: number }>;
    batchId?: string | null;
    batchIndexStart?: number;
    burstActive?: boolean;
    burstTradesOpened?: number;
    maxBurstTrades?: number;
    auditEvent: string;
    auditMeta: Record<string, unknown>;
  },
): Promise<void> {
  const {
    direction,
    mode,
    entries,
    batchId,
    batchIndexStart = 1,
    burstActive = false,
    burstTradesOpened = entries.length,
    maxBurstTrades = HARD_OPEN_TRADE_LIMIT,
    auditEvent,
    auditMeta,
  } = options;

  if (!entries.length) return;

  await supabase.from('goldx_trade_history').insert(
    entries.map((entry, index) => ({
      license_id: licenseId,
      mt5_account: mt5Account,
      symbol: 'XAUUSD',
      direction,
      entry_price: entry.entry,
      sl_price: entry.sl,
      tp_price: entry.tp,
      lot_size: entry.lot,
      mode,
      batch_id: batchId ?? null,
      batch_index: batchIndexStart + index,
    })),
  );

  const { data: state } = await supabase
    .from('goldx_account_state')
    .select('id, trades_today, current_open_trades')
    .eq('license_id', licenseId)
    .eq('mt5_account', mt5Account)
    .maybeSingle();

  if (state) {
    await supabase
      .from('goldx_account_state')
      .update({
        trades_today: Number(state.trades_today ?? 0) + entries.length,
        current_open_trades: Number(state.current_open_trades ?? 0) + entries.length,
        last_trade_at: new Date().toISOString(),
        last_batch_id: batchId ?? null,
        burst_active: burstActive,
        burst_trades_opened: burstTradesOpened,
        max_burst_trades: maxBurstTrades,
        updated_at: new Date().toISOString(),
      })
      .eq('id', state.id);
  }

  await markOnboardingStateByLicenseId(licenseId, { setupCompleted: true });
  await insertAuditLog(auditEvent, {
    licenseId,
    meta: auditMeta,
  });
}

export async function recordTrade(
  licenseId: string,
  mt5Account: string,
  signal: GoldxSignal,
): Promise<void> {
  if (signal.action === 'none') return;
  const tradeDirection = toTradeDirection(signal.action);
  if (!tradeDirection) return;

  const entries = signal.entries?.length
    ? signal.entries
    : (signal.entry != null && signal.stopLoss != null && signal.takeProfit != null && signal.lotSize != null)
      ? [{ lot: signal.lotSize, entry: signal.entry, tp: signal.takeProfit, sl: signal.stopLoss }]
      : [];

  if (!entries.length) return;

  await persistTradeHistory(licenseId, mt5Account, {
    direction: tradeDirection,
    mode: signal.mode,
    entries,
    batchId: signal.batchId ?? null,
    burstActive: signal.burstActive ?? false,
    burstTradesOpened: signal.burstTradesOpened ?? entries.length,
    maxBurstTrades: signal.maxBurstTrades ?? HARD_OPEN_TRADE_LIMIT,
    auditEvent: 'goldx_signal_trade_recorded',
    auditMeta: {
      action: signal.action,
      batchId: signal.batchId ?? null,
      strategyName: signal.strategyName ?? null,
      entryCount: entries.length,
      confidenceScore: signal.confidence,
      maxTrades: signal.maxTrades ?? entries.length,
    },
  });
}

export async function reportTradeExecution(
  licenseId: string,
  mt5Account: string,
  execution: {
    action: string;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    lotSize: number;
    mode: GoldxMode;
    batchId?: string | null;
    batchIndex?: number;
    burstActive?: boolean;
    burstTradesOpened?: number;
    maxBurstTrades?: number;
    reason?: string | null;
    orderTicket?: string | null;
    dealTicket?: string | null;
  },
): Promise<void> {
  const tradeDirection = toTradeDirection(execution.action);
  if (!tradeDirection) return;

  await persistTradeHistory(licenseId, mt5Account, {
    direction: tradeDirection,
    mode: execution.mode,
    entries: [{
      lot: execution.lotSize,
      entry: execution.entryPrice,
      tp: execution.takeProfit,
      sl: execution.stopLoss,
    }],
    batchId: execution.batchId ?? null,
    batchIndexStart: execution.batchIndex ?? 1,
    burstActive: execution.burstActive ?? false,
    burstTradesOpened: execution.burstTradesOpened ?? 1,
    maxBurstTrades: execution.maxBurstTrades ?? HARD_OPEN_TRADE_LIMIT,
    auditEvent: 'goldx_execution_reported',
    auditMeta: {
      action: execution.action,
      reason: execution.reason ?? null,
      orderTicket: execution.orderTicket ?? null,
      dealTicket: execution.dealTicket ?? null,
      batchId: execution.batchId ?? null,
      batchIndex: execution.batchIndex ?? 1,
    },
  });
}
