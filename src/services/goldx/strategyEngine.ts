// ============================================================
// GoldX — Burst Scalping Engine
// ============================================================

import { supabase } from '../../lib/supabase';
import type {
  GoldxAccountState,
  GoldxMode,
  GoldxModeConfig,
  GoldxRuntimeTradeState,
  GoldxScalpEntry,
  GoldxSessionMode,
  GoldxSessionStatus,
  GoldxSignal,
  GoldxSignalAction,
} from './types';
import { getModeConfig, insertAuditLog, markOnboardingStateByLicenseId } from './licenseService';

type BrokerSession = 'night' | 'day' | 'off';
type TradeDirection = 'buy' | 'sell';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface EngineStrategyConfig {
  symbol: string;
  timeframe: string;
  brokerOffset: number;
  debugLogging: boolean;
  dayMaxSpreadPoints: number;
  nightMaxSpreadPoints: number;
  stableAtrMultiplier: number;
  momentumBodyAtrMultiplier: number;
  microTpAtrMultiplier: number;
  burstSlAtrMultiplier: number;
}

interface EngineTradeControlConfig {
  dailyProfitStopPercent: number;
  dailyDrawdownStopPercent: number;
  fastReentryCooldownSeconds: number;
  hybridReentryCooldownSeconds: number;
  propReentryCooldownSeconds: number;
  maxTradesPerMinute: number;
  maxLossPerBatchPercent: number;
  maxBurstsPerHour: number;
  burstLossStreakLimit: number;
  burstDelayMsMin: number;
  burstDelayMsMax: number;
}

interface MarketSnapshot {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  atr: number;
  ema20: number;
  ema50: number;
  averageRange: number;
  candles: Candle[];
  current: Candle;
  previous: Candle | null;
}

const DEFAULT_STRATEGY_CONFIG: EngineStrategyConfig = {
  symbol: 'XAUUSD',
  timeframe: 'M5',
  brokerOffset: 2,
  debugLogging: true,
  dayMaxSpreadPoints: 24,
  nightMaxSpreadPoints: 20,
  stableAtrMultiplier: 1.35,
  momentumBodyAtrMultiplier: 0.25,
  microTpAtrMultiplier: 0.2,
  burstSlAtrMultiplier: 0.6,
};

const DEFAULT_TRADE_CONTROL: EngineTradeControlConfig = {
  dailyProfitStopPercent: 3.0,
  dailyDrawdownStopPercent: 2.0,
  fastReentryCooldownSeconds: 120,
  hybridReentryCooldownSeconds: 180,
  propReentryCooldownSeconds: 300,
  maxTradesPerMinute: 10,
  maxLossPerBatchPercent: 1.5,
  maxBurstsPerHour: 3,
  burstLossStreakLimit: 3,
  burstDelayMsMin: 300,
  burstDelayMsMax: 800,
};

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
    brokerOffset: asNumber(value.brokerOffset, DEFAULT_STRATEGY_CONFIG.brokerOffset),
    debugLogging: typeof value.debugLogging === 'boolean' ? value.debugLogging : DEFAULT_STRATEGY_CONFIG.debugLogging,
    dayMaxSpreadPoints: asNumber(value.dayMaxSpreadPoints, DEFAULT_STRATEGY_CONFIG.dayMaxSpreadPoints),
    nightMaxSpreadPoints: asNumber(value.nightMaxSpreadPoints, DEFAULT_STRATEGY_CONFIG.nightMaxSpreadPoints),
    stableAtrMultiplier: asNumber(value.stableAtrMultiplier, DEFAULT_STRATEGY_CONFIG.stableAtrMultiplier),
    momentumBodyAtrMultiplier: asNumber(value.momentumBodyAtrMultiplier, DEFAULT_STRATEGY_CONFIG.momentumBodyAtrMultiplier),
    microTpAtrMultiplier: asNumber(value.microTpAtrMultiplier, DEFAULT_STRATEGY_CONFIG.microTpAtrMultiplier),
    burstSlAtrMultiplier: asNumber(value.burstSlAtrMultiplier, DEFAULT_STRATEGY_CONFIG.burstSlAtrMultiplier),
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
    fastReentryCooldownSeconds: asNumber(value.fastReentryCooldownSeconds, DEFAULT_TRADE_CONTROL.fastReentryCooldownSeconds),
    hybridReentryCooldownSeconds: asNumber(value.hybridReentryCooldownSeconds, DEFAULT_TRADE_CONTROL.hybridReentryCooldownSeconds),
    propReentryCooldownSeconds: asNumber(value.propReentryCooldownSeconds, DEFAULT_TRADE_CONTROL.propReentryCooldownSeconds),
    maxTradesPerMinute: asNumber(value.maxTradesPerMinute, DEFAULT_TRADE_CONTROL.maxTradesPerMinute),
    maxLossPerBatchPercent: asNumber(value.maxLossPerBatchPercent, DEFAULT_TRADE_CONTROL.maxLossPerBatchPercent),
    maxBurstsPerHour: asNumber(value.maxBurstsPerHour, DEFAULT_TRADE_CONTROL.maxBurstsPerHour),
    burstLossStreakLimit: asNumber(value.burstLossStreakLimit, DEFAULT_TRADE_CONTROL.burstLossStreakLimit),
    burstDelayMsMin: asNumber(value.burstDelayMsMin, DEFAULT_TRADE_CONTROL.burstDelayMsMin),
    burstDelayMsMax: asNumber(value.burstDelayMsMax, DEFAULT_TRADE_CONTROL.burstDelayMsMax),
  };
}

function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    );
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

function calculateEMA(candles: Candle[], period: number): number {
  if (candles.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = candles[0].close;
  for (let index = 1; index < candles.length; index += 1) {
    ema = (candles[index].close - ema) * multiplier + ema;
  }
  return ema;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundLot(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
}

function floorLot(value: number): number {
  return Math.floor(value * 100) / 100;
}

function getBrokerMinutes(config: EngineStrategyConfig): number {
  const now = new Date();
  const offsetHours = ((now.getUTCHours() + config.brokerOffset) % 24 + 24) % 24;
  return offsetHours * 60 + now.getUTCMinutes();
}

function getSessionType(config: EngineStrategyConfig): BrokerSession {
  const minutes = getBrokerMinutes(config);
  if (minutes >= 0 && minutes <= 6 * 60) return 'night';
  if (minutes >= 8 * 60 && minutes <= 17 * 60) return 'day';
  return 'off';
}

function resolveAllowedSession(sessionMode: GoldxSessionMode, brokerSession: BrokerSession): BrokerSession {
  if (sessionMode === 'night') return brokerSession === 'night' ? 'night' : 'off';
  if (sessionMode === 'day') return brokerSession === 'day' ? 'day' : 'off';
  if (sessionMode === 'hybrid' || sessionMode === 'all') return brokerSession;
  return 'off';
}

export async function isWithinTradingSession(sessionMode: GoldxSessionMode): Promise<boolean> {
  const config = await getStrategyConfig();
  return resolveAllowedSession(sessionMode, getSessionType(config)) !== 'off';
}

export async function getCurrentSessionStatus(sessionMode: GoldxSessionMode): Promise<GoldxSessionStatus> {
  const config = await getStrategyConfig();
  const session = resolveAllowedSession(sessionMode, getSessionType(config));
  if (session === 'day') return 'day';
  if (session === 'night') return 'night';
  return 'closed';
}

function getRecentAverageRange(candles: Candle[], count = 20): number {
  const window = candles.slice(-count);
  if (!window.length) return 0;
  return window.reduce((sum, candle) => sum + (candle.high - candle.low), 0) / window.length;
}

function buildSnapshot(candles: Candle[], bid: number, ask: number): MarketSnapshot {
  const current = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : null;
  return {
    bid,
    ask,
    mid: (bid + ask) / 2,
    spread: (ask - bid) * 10,
    atr: calculateATR(candles),
    ema20: calculateEMA(candles, 20),
    ema50: calculateEMA(candles, 50),
    averageRange: getRecentAverageRange(candles, 20),
    candles,
    current,
    previous,
  };
}

function getModeBurstCap(mode: GoldxMode, accountState: GoldxAccountState): number {
  const accountCap = clamp(accountState.maxBurstTrades || 10, 3, 10);
  if (mode === 'fast') return Math.min(accountCap, 10);
  if (mode === 'prop') return Math.min(accountCap, 4);
  return Math.min(accountCap, 6);
}

function getModeReentryCooldownSeconds(mode: GoldxMode, tradeControl: EngineTradeControlConfig): number {
  if (mode === 'fast') return tradeControl.fastReentryCooldownSeconds;
  if (mode === 'prop') return tradeControl.propReentryCooldownSeconds;
  return tradeControl.hybridReentryCooldownSeconds;
}

function canReenter(
  mode: GoldxMode,
  tradeControl: EngineTradeControlConfig,
  runtimeState: Required<GoldxRuntimeTradeState>,
): boolean {
  if (!runtimeState.lastBatchClosedAt) return true;
  const elapsedMs = Date.now() - new Date(runtimeState.lastBatchClosedAt).getTime();
  return elapsedMs >= getModeReentryCooldownSeconds(mode, tradeControl) * 1000;
}

function normalizeRuntimeState(
  accountState: GoldxAccountState,
  runtimeState?: GoldxRuntimeTradeState,
): Required<GoldxRuntimeTradeState> {
  const fallbackOpenTrades = typeof runtimeState?.currentOpenTrades === 'number'
    ? runtimeState.currentOpenTrades
    : 0;

  return {
    currentOpenTrades: fallbackOpenTrades,
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
    maxBurstTrades: 10,
    maxTrades: 10,
    confidence: 0,
    reason,
    mode,
    timestamp: now,
    session,
    sessionType: session === 'off' ? 'closed' : session,
    ...extras,
  };
}

function isMomentumCandle(candle: Candle, atr: number, direction: TradeDirection, bodyAtrMultiplier: number): boolean {
  const candleRange = Math.max(candle.high - candle.low, 0);
  const body = Math.abs(candle.close - candle.open);
  if (atr <= 0) return false;

  const requiredBody = Math.max(atr * bodyAtrMultiplier, candleRange * 0.22);
  const wickAllowance = Math.max(atr * 0.22, candleRange * 0.3);
  if (body < requiredBody) return false;

  if (direction === 'buy') {
    return candle.close > candle.open && candle.close >= candle.high - wickAllowance;
  }
  return candle.close < candle.open && candle.close <= candle.low + wickAllowance;
}

function isTrendAligned(snapshot: MarketSnapshot, direction: TradeDirection): boolean {
  if (direction === 'buy') {
    return snapshot.ema20 >= snapshot.ema50;
  }
  return snapshot.ema20 <= snapshot.ema50;
}

function getBurstTriggerDiagnostics(snapshot: MarketSnapshot, config: EngineStrategyConfig) {
  const triggerMultiplier = Math.max(0.12, config.momentumBodyAtrMultiplier * 0.72);
  const buyCurrent = snapshot.current.close > snapshot.ema20
    && isTrendAligned(snapshot, 'buy')
    && isMomentumCandle(snapshot.current, snapshot.atr, 'buy', triggerMultiplier);
  const buyPrevious = Boolean(snapshot.previous)
    && (snapshot.previous as Candle).close > snapshot.ema20
    && isTrendAligned(snapshot, 'buy')
    && isMomentumCandle(snapshot.previous as Candle, snapshot.atr, 'buy', triggerMultiplier);
  const sellCurrent = snapshot.current.close < snapshot.ema20
    && isTrendAligned(snapshot, 'sell')
    && isMomentumCandle(snapshot.current, snapshot.atr, 'sell', triggerMultiplier);
  const sellPrevious = Boolean(snapshot.previous)
    && (snapshot.previous as Candle).close < snapshot.ema20
    && isTrendAligned(snapshot, 'sell')
    && isMomentumCandle(snapshot.previous as Candle, snapshot.atr, 'sell', triggerMultiplier);

  return {
    triggerMultiplier,
    buyCurrent,
    buyPrevious,
    sellCurrent,
    sellPrevious,
  };
}

function resolveBurstDirection(snapshot: MarketSnapshot, config: EngineStrategyConfig): TradeDirection | null {
  const diagnostics = getBurstTriggerDiagnostics(snapshot, config);
  const { buyCurrent, buyPrevious, sellCurrent, sellPrevious } = diagnostics;
  if (buyCurrent || buyPrevious) {
    return 'buy';
  }

  if (sellCurrent || sellPrevious) {
    return 'sell';
  }

  return null;
}

function toBurstAction(direction: TradeDirection): GoldxSignalAction {
  return direction === 'buy' ? 'burst_buy' : 'burst_sell';
}

function toTradeDirection(action: string): TradeDirection | null {
  if (action === 'burst_buy' || action === 'buy') return 'buy';
  if (action === 'burst_sell' || action === 'sell') return 'sell';
  return null;
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
    maxBurstTrades = 10,
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
  const pipDistance = Math.abs(entry - stopLoss);
  if (pipDistance <= 0) return 0.01;
  return Math.max(0.01, Math.round((riskAmount / (pipDistance * 100)) * 100) / 100);
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

function buildBurstEntries(
  direction: TradeDirection,
  baseLot: number,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  burstTrades: number,
): GoldxScalpEntry[] {
  const selectedWeights = BURST_ENTRY_SPLITS.slice(0, burstTrades);
  const totalWeight = selectedWeights.reduce((sum, value) => sum + value, 0);
  return selectedWeights.map((weight, index) => ({
    lot: roundLot(baseLot * (weight / totalWeight)),
    entry: roundPrice(entry + (direction === 'buy' ? index * 0.01 : index * -0.01)),
    tp: roundPrice(takeProfit),
    sl: roundPrice(stopLoss),
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
  console.log('Trade limit check bypassed for debugging');

  if (runtimeState.currentOpenTrades >= 10) {
    return { pass: false, reason: 'Max open trades reached (10)' };
  }
  if (runtimeState.burstActive) {
    return { pass: false, reason: 'Burst already active' };
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
  if (runtimeState.profitToday >= Math.min(accountState.dailyTargetPercent || 3, 3)) {
    return { pass: false, reason: `Daily target reached (${runtimeState.profitToday.toFixed(2)}%)` };
  }
  if (accountState.drawdownToday >= tradeControl.dailyDrawdownStopPercent) {
    return { pass: false, reason: `Daily drawdown limit reached (${accountState.drawdownToday.toFixed(2)}%)` };
  }
  if (accountState.pausedUntil && new Date(accountState.pausedUntil).getTime() > Date.now()) {
    return { pass: false, reason: `Loss pause active until ${accountState.pausedUntil}` };
  }
  return { pass: true, reason: 'Burst trade control passed' };
}

function logDebug(config: EngineStrategyConfig, snapshot: MarketSnapshot, action: string, reason: string): void {
  if (!config.debugLogging) return;
  console.log('GoldX Debug', {
    spread: snapshot.spread,
    atr: snapshot.atr,
    ema20: snapshot.ema20,
    ema50: snapshot.ema50,
    action,
    reason,
  });
}

function buildBurstSignal(
  now: string,
  mode: GoldxMode,
  modeConfig: GoldxModeConfig,
  accountBalance: number,
  session: BrokerSession,
  snapshot: MarketSnapshot,
  strategyConfig: EngineStrategyConfig,
  tradeControl: EngineTradeControlConfig,
  accountState: GoldxAccountState,
  runtimeState: Required<GoldxRuntimeTradeState>,
): GoldxSignal {
  const direction = resolveBurstDirection(snapshot, strategyConfig);
  if (!direction) {
    const diagnostics = getBurstTriggerDiagnostics(snapshot, strategyConfig);
    return buildNoSignal(now, mode, session, 'Burst trigger not confirmed', {
      strategyName: 'burst-momentum',
      reason: `Burst trigger not confirmed | buyCurrent=${diagnostics.buyCurrent} buyPrevious=${diagnostics.buyPrevious} sellCurrent=${diagnostics.sellCurrent} sellPrevious=${diagnostics.sellPrevious} ema20=${snapshot.ema20.toFixed(2)} ema50=${snapshot.ema50.toFixed(2)} currentClose=${snapshot.current.close.toFixed(2)} previousClose=${snapshot.previous?.close?.toFixed(2) ?? 'null'} atr=${snapshot.atr.toFixed(2)} triggerMultiplier=${diagnostics.triggerMultiplier.toFixed(2)}`,
      reentryAllowed: canReenter(mode, tradeControl, runtimeState),
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: 10,
      debug: {
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
        ema20: snapshot.ema20,
        ema50: snapshot.ema50,
        atr: snapshot.atr,
        currentClose: snapshot.current.close,
        previousClose: snapshot.previous?.close ?? null,
        currentBody: Math.abs(snapshot.current.close - snapshot.current.open),
        previousBody: snapshot.previous ? Math.abs(snapshot.previous.close - snapshot.previous.open) : null,
        buyCurrent: diagnostics.buyCurrent,
        buyPrevious: diagnostics.buyPrevious,
        sellCurrent: diagnostics.sellCurrent,
        sellPrevious: diagnostics.sellPrevious,
        triggerMultiplier: diagnostics.triggerMultiplier,
      },
    });
  }

  const spreadThreshold = (session === 'day' ? strategyConfig.dayMaxSpreadPoints : strategyConfig.nightMaxSpreadPoints) * 0.55;
  const lowSpread = snapshot.spread <= spreadThreshold;
  const stableVolatility = snapshot.averageRange > 0 && snapshot.atr <= snapshot.averageRange * strategyConfig.stableAtrMultiplier;
  if (!lowSpread || !stableVolatility) {
    return buildNoSignal(now, mode, session, !lowSpread ? 'Spread too high for burst mode' : 'Volatility unstable for burst mode', {
      strategyName: 'burst-momentum',
      reentryAllowed: canReenter(mode, tradeControl, runtimeState),
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: 10,
    });
  }

  const entry = direction === 'buy' ? snapshot.ask : snapshot.bid;
  const tpDistance = clamp(snapshot.atr * strategyConfig.microTpAtrMultiplier, 2, 5);
  const slDistance = Math.max(snapshot.atr * strategyConfig.burstSlAtrMultiplier, tpDistance * 2);
  const stopLoss = direction === 'buy' ? entry - slDistance : entry + slDistance;
  const takeProfit = direction === 'buy' ? entry + tpDistance : entry - tpDistance;
  const lotConfig = resolveExecutionLot(mode, modeConfig.riskPercent, accountState, accountBalance, entry, stopLoss);
  const baseLot = lotConfig.lotSize;
  if (baseLot < 0.01) {
    return buildNoSignal(now, mode, session, 'Account balance too low for the minimum safe lot size', {
      strategyName: 'burst-risk-cap',
      lotMode: lotConfig.lotMode,
      userLot: lotConfig.userLot,
      lotSizeUsed: null,
      reentryAllowed: canReenter(mode, tradeControl, runtimeState),
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: 10,
    });
  }
  const trendAligned = direction === 'buy'
    ? snapshot.current.close > snapshot.ema20 && snapshot.ema20 >= snapshot.ema50
    : snapshot.current.close < snapshot.ema20 && snapshot.ema20 <= snapshot.ema50;
  const confidence = clamp(
    68
      + (trendAligned ? 10 : 0)
      + (lowSpread ? 8 : 0)
      + (stableVolatility ? 8 : 0)
      + (isMomentumCandle(snapshot.current, snapshot.atr, direction, strategyConfig.momentumBodyAtrMultiplier) ? 10 : 0),
    72,
    96,
  );

  const availableSlots = Math.max(0, 10 - runtimeState.currentOpenTrades);
  let burstTrades = Math.min(
    getModeBurstCap(mode, accountState),
    Math.max(3, Math.round((confidence - 60) / 5)),
    availableSlots,
  );

  if (burstTrades < 3) {
    return buildNoSignal(now, mode, session, 'Not enough free slots for a valid burst', {
      strategyName: 'burst-momentum',
      reentryAllowed: canReenter(mode, tradeControl, runtimeState),
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: 10,
    });
  }

  let entries = buildBurstEntries(direction, baseLot, entry, stopLoss, takeProfit, burstTrades);
  while (entries.length >= 3 && calculateProjectedLossPercent(entries, accountBalance) > tradeControl.maxLossPerBatchPercent) {
    burstTrades -= 1;
    entries = buildBurstEntries(direction, baseLot, entry, stopLoss, takeProfit, burstTrades);
  }

  if (entries.length < 3) {
    return buildNoSignal(now, mode, session, 'Burst risk exceeds max loss per burst', {
      strategyName: 'burst-momentum',
      reentryAllowed: canReenter(mode, tradeControl, runtimeState),
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: 10,
    });
  }

  const batchId = buildBatchId(accountState.licenseId);
  return {
    action: toBurstAction(direction),
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    lotSize: entries[0]?.lot ?? null,
    lotSizeUsed: baseLot,
    lotMode: lotConfig.lotMode,
    userLot: lotConfig.userLot,
    entries,
    batchId,
    reentryAllowed: true,
    burstActive: true,
    burstTradesOpened: entries.length,
    maxBurstTrades: 10,
    maxTrades: entries.length,
    burstDelayMsMin: tradeControl.burstDelayMsMin,
    burstDelayMsMax: tradeControl.burstDelayMsMax,
    closeOnMomentumLoss: true,
    maxSimultaneousTrades: 10,
    currentOpenTrades: runtimeState.currentOpenTrades,
    confidence,
    reason: direction === 'buy'
      ? 'Burst buy: price above EMA20 with strong bullish momentum, low spread, stable volatility'
      : 'Burst sell: price below EMA20 with strong bearish momentum, low spread, stable volatility',
    mode,
    timestamp: now,
    session,
    sessionType: session === 'off' ? 'closed' : session,
    strategyName: 'burst-momentum',
    trendAligned,
    bosConfirmed: true,
    sweepDetected: false,
  };
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
  const sessionMode = accountState.sessionMode ?? 'hybrid';

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
    console.warn('maxTrades invalid — forcing default = 10');
    modeConfig.maxTrades = 10;
  }

  const session = resolveAllowedSession(sessionMode, getSessionType(strategyConfig));
  const runtimeState = normalizeRuntimeState(accountState, runtimeTradeState);

  console.log('=== DEBUG START ===');
  console.log('Mode:', mode);
  console.log('Account State:', accountState);
  console.log('Mode Config RAW:', modeConfig);
  console.log('Trades Today:', accountState.tradesToday);
  console.log('Max Trades:', modeConfig.maxTrades);
  console.log('=== DEBUG END ===');

  if (session === 'off') {
    return buildNoSignal(now, mode, session, 'Outside configured trading session', {
      strategyName: 'burst-router',
      maxTrades: modeConfig.maxTrades,
      debug: {
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  const gate = passesTradeControl(accountState, tradeControl, runtimeState);
  if (!gate.pass) {
    return buildNoSignal(now, mode, session, gate.reason, {
      strategyName: 'burst-guard',
      maxTrades: modeConfig.maxTrades,
      currentOpenTrades: runtimeState.currentOpenTrades,
      debug: {
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  if (!canReenter(mode, tradeControl, runtimeState)) {
    return buildNoSignal(now, mode, session, 'Burst cooldown active', {
      strategyName: 'burst-cooldown',
      reentryAllowed: false,
      maxTrades: modeConfig.maxTrades,
      currentOpenTrades: runtimeState.currentOpenTrades,
      maxSimultaneousTrades: 10,
      debug: {
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  if (!candles.length) {
    return buildNoSignal(now, mode, session, 'No market candles supplied', {
      strategyName: 'burst-snapshot',
      maxTrades: modeConfig.maxTrades,
      debug: {
        tradesToday: accountState.tradesToday,
        maxTrades: modeConfig.maxTrades,
        currentOpenTrades: runtimeState.currentOpenTrades,
      },
    });
  }

  const snapshot = buildSnapshot(candles, currentBid, currentAsk);
  const signal = buildBurstSignal(
    now,
    mode,
    modeConfig,
    accountBalance,
    session,
    snapshot,
    strategyConfig,
    tradeControl,
    accountState,
    runtimeState,
  );

  logDebug(strategyConfig, snapshot, signal.action, signal.reason);
  signal.debug = {
    tradesToday: accountState.tradesToday,
    maxTrades: modeConfig.maxTrades,
    currentOpenTrades: runtimeState.currentOpenTrades,
  };
  console.log('BURST MODE', {
    tradesOpened: signal.maxTrades ?? 0,
    profit: runtimeState.profitToday,
    losses: runtimeState.burstLossesInRow,
    active: signal.burstActive ?? false,
  });
  return signal;
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
    maxBurstTrades: signal.maxBurstTrades ?? 10,
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
    maxBurstTrades: execution.maxBurstTrades ?? 10,
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
