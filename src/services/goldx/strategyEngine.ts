// ============================================================
// GoldX — Dual-Session Production Trading Engine
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
} from './types';
import { getModeConfig, insertAuditLog, markOnboardingStateByLicenseId } from './licenseService';

type BrokerSession = 'night' | 'day' | 'off';

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RangeZone {
  high: number;
  low: number;
  size: number;
  midpoint: number;
}

interface EngineStrategyConfig {
  symbol: string;
  timeframe: string;
  brokerOffset: number;
  debugLogging: boolean;
  nightRangeLookbackMinutes: [number, number];
  nightEdgeThresholdPct: number;
  nightMaxSpreadPoints: number;
  nightAtrCapMultiplier: number;
  nightSlBufferAtr: number;
  dayBreakoutLookbackCandles: number;
  dayMaxSpreadPoints: number;
  dayAtrCapMultiplier: number;
  dayBreakoutBodyAtr: number;
  daySlBufferAtr: number;
  dayRiskRewardMin: number;
  dayRiskRewardMax: number;
  fallbackConfidenceRange: [number, number];
}

interface EngineTradeControlConfig {
  cooldownMinutes: number;
  dailyProfitStopPercent: number;
  dailyDrawdownStopPercent: number;
  dayCooldownMinutes: number;
  nightCooldownMinutes: number;
  dayMaxTradesPerDay: number;
  nightMaxTradesPerDay: number;
  fastReentryCooldownSeconds: number;
  hybridReentryCooldownSeconds: number;
  propReentryCooldownSeconds: number;
  maxTradesPerMinute: number;
  maxLossPerBatchPercent: number;
  losingBatchPauseMinutes: number;
}

interface MarketSnapshot {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  atr: number;
  ema20: number;
  ema50: number;
  range: RangeZone | null;
  candles: Candle[];
  current: Candle;
  previous: Candle | null;
}

const DEFAULT_STRATEGY_CONFIG: EngineStrategyConfig = {
  symbol: 'XAUUSD',
  timeframe: 'M5',
  brokerOffset: 2,
  debugLogging: true,
  nightRangeLookbackMinutes: [60, 120],
  nightEdgeThresholdPct: 0.2,
  nightMaxSpreadPoints: 28,
  nightAtrCapMultiplier: 1.8,
  nightSlBufferAtr: 0.2,
  dayBreakoutLookbackCandles: 12,
  dayMaxSpreadPoints: 26,
  dayAtrCapMultiplier: 2.4,
  dayBreakoutBodyAtr: 0.15,
  daySlBufferAtr: 0.25,
  dayRiskRewardMin: 1.5,
  dayRiskRewardMax: 2.0,
  fallbackConfidenceRange: [40, 55],
};

const DEFAULT_TRADE_CONTROL: EngineTradeControlConfig = {
  cooldownMinutes: 15,
  dailyProfitStopPercent: 3.0,
  dailyDrawdownStopPercent: 2.0,
  dayCooldownMinutes: 45,
  nightCooldownMinutes: 20,
  dayMaxTradesPerDay: 3,
  nightMaxTradesPerDay: 6,
  fastReentryCooldownSeconds: 30,
  hybridReentryCooldownSeconds: 45,
  propReentryCooldownSeconds: 60,
  maxTradesPerMinute: 3,
  maxLossPerBatchPercent: 1,
  losingBatchPauseMinutes: 60,
};

const ENTRY_SPLITS = [0.3, 0.25, 0.2, 0.15, 0.1];

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asTuple(value: unknown, fallback: [number, number]): [number, number] {
  if (
    Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
  ) {
    return [value[0], value[1]];
  }
  return fallback;
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
    nightRangeLookbackMinutes: asTuple(value.nightRangeLookbackMinutes, DEFAULT_STRATEGY_CONFIG.nightRangeLookbackMinutes),
    nightEdgeThresholdPct: asNumber(value.nightEdgeThresholdPct, DEFAULT_STRATEGY_CONFIG.nightEdgeThresholdPct),
    nightMaxSpreadPoints: asNumber(value.nightMaxSpreadPoints, DEFAULT_STRATEGY_CONFIG.nightMaxSpreadPoints),
    nightAtrCapMultiplier: asNumber(value.nightAtrCapMultiplier, DEFAULT_STRATEGY_CONFIG.nightAtrCapMultiplier),
    nightSlBufferAtr: asNumber(value.nightSlBufferAtr, DEFAULT_STRATEGY_CONFIG.nightSlBufferAtr),
    dayBreakoutLookbackCandles: asNumber(value.dayBreakoutLookbackCandles, DEFAULT_STRATEGY_CONFIG.dayBreakoutLookbackCandles),
    dayMaxSpreadPoints: asNumber(value.dayMaxSpreadPoints, DEFAULT_STRATEGY_CONFIG.dayMaxSpreadPoints),
    dayAtrCapMultiplier: asNumber(value.dayAtrCapMultiplier, DEFAULT_STRATEGY_CONFIG.dayAtrCapMultiplier),
    dayBreakoutBodyAtr: asNumber(value.dayBreakoutBodyAtr, DEFAULT_STRATEGY_CONFIG.dayBreakoutBodyAtr),
    daySlBufferAtr: asNumber(value.daySlBufferAtr, DEFAULT_STRATEGY_CONFIG.daySlBufferAtr),
    dayRiskRewardMin: asNumber(value.dayRiskRewardMin, DEFAULT_STRATEGY_CONFIG.dayRiskRewardMin),
    dayRiskRewardMax: asNumber(value.dayRiskRewardMax, DEFAULT_STRATEGY_CONFIG.dayRiskRewardMax),
    fallbackConfidenceRange: asTuple(value.fallbackConfidenceRange, DEFAULT_STRATEGY_CONFIG.fallbackConfidenceRange),
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
    cooldownMinutes: asNumber(value.cooldownMinutes, DEFAULT_TRADE_CONTROL.cooldownMinutes),
    dailyProfitStopPercent: asNumber(value.dailyProfitStopPercent, DEFAULT_TRADE_CONTROL.dailyProfitStopPercent),
    dailyDrawdownStopPercent: asNumber(value.dailyDrawdownStopPercent, DEFAULT_TRADE_CONTROL.dailyDrawdownStopPercent),
    dayCooldownMinutes: asNumber(value.dayCooldownMinutes, DEFAULT_TRADE_CONTROL.dayCooldownMinutes),
    nightCooldownMinutes: asNumber(value.nightCooldownMinutes, DEFAULT_TRADE_CONTROL.nightCooldownMinutes),
    dayMaxTradesPerDay: asNumber(value.dayMaxTradesPerDay, DEFAULT_TRADE_CONTROL.dayMaxTradesPerDay),
    nightMaxTradesPerDay: asNumber(value.nightMaxTradesPerDay, DEFAULT_TRADE_CONTROL.nightMaxTradesPerDay),
    fastReentryCooldownSeconds: asNumber(value.fastReentryCooldownSeconds, DEFAULT_TRADE_CONTROL.fastReentryCooldownSeconds),
    hybridReentryCooldownSeconds: asNumber(value.hybridReentryCooldownSeconds, DEFAULT_TRADE_CONTROL.hybridReentryCooldownSeconds),
    propReentryCooldownSeconds: asNumber(value.propReentryCooldownSeconds, DEFAULT_TRADE_CONTROL.propReentryCooldownSeconds),
    maxTradesPerMinute: asNumber(value.maxTradesPerMinute, DEFAULT_TRADE_CONTROL.maxTradesPerMinute),
    maxLossPerBatchPercent: asNumber(value.maxLossPerBatchPercent, DEFAULT_TRADE_CONTROL.maxLossPerBatchPercent),
    losingBatchPauseMinutes: asNumber(value.losingBatchPauseMinutes, DEFAULT_TRADE_CONTROL.losingBatchPauseMinutes),
  };
}

function roundPrice(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundLot(value: number): number {
  return Math.max(0.01, Math.round(value * 100) / 100);
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

function getBrokerMinutes(config: EngineStrategyConfig): number {
  const now = new Date();
  const offsetHours = ((now.getUTCHours() + config.brokerOffset) % 24 + 24) % 24;
  return offsetHours * 60 + now.getUTCMinutes();
}

function getSessionType(config: EngineStrategyConfig): BrokerSession {
  const minutes = getBrokerMinutes(config);

  const nightStart = 0;
  const nightEnd = 6 * 60;
  const dayStart = 8 * 60;
  const dayEnd = 17 * 60;

  if (minutes >= nightStart && minutes <= nightEnd) return 'night';
  if (minutes >= dayStart && minutes <= dayEnd) return 'day';
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

function detectRange(candles: Candle[], lookbackMinutes: [number, number]): RangeZone | null {
  const [minLookback, maxLookback] = lookbackMinutes;
  const minCandles = Math.max(1, Math.floor(minLookback / 5));
  const maxCandles = Math.max(minCandles, Math.floor(maxLookback / 5));
  if (candles.length < minCandles) return null;

  const windowCandles = candles.slice(-Math.min(candles.length, maxCandles));
  const high = Math.max(...windowCandles.map((candle) => candle.high));
  const low = Math.min(...windowCandles.map((candle) => candle.low));
  const size = high - low;
  if (size <= 0) return null;

  return {
    high,
    low,
    size,
    midpoint: low + size / 2,
  };
}

function buildSnapshot(
  candles: Candle[],
  bid: number,
  ask: number,
  config: EngineStrategyConfig,
): MarketSnapshot {
  const range = detectRange(candles, config.nightRangeLookbackMinutes);
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
    range,
    candles,
    current,
    previous,
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
    confidence: 0,
    reason,
    mode,
    session,
    sessionType: session === 'off' ? 'closed' : session,
    timestamp: now,
    ...extras,
  };
}

function clampRiskPercent(mode: GoldxMode, configuredRisk: number): number {
  if (mode === 'fast') return clamp(configuredRisk, 0.8, 1);
  if (mode === 'prop') return clamp(configuredRisk, 0.3, 0.7);
  return clamp(configuredRisk, 0.6, 1);
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

  const pipValue = 1;
  const lotSize = riskAmount / (pipDistance * 100 * pipValue);
  return Math.max(0.01, Math.round(lotSize * 100) / 100);
}

function getModeEntryCap(mode: GoldxMode): number {
  if (mode === 'fast') return 5;
  if (mode === 'prop') return 3;
  return 4;
}

function getModeReentryCooldownSeconds(mode: GoldxMode, tradeControl: EngineTradeControlConfig): number {
  if (mode === 'fast') return tradeControl.fastReentryCooldownSeconds;
  if (mode === 'prop') return tradeControl.propReentryCooldownSeconds;
  return tradeControl.hybridReentryCooldownSeconds;
}

function normalizeRuntimeState(
  accountState: GoldxAccountState,
  runtimeState?: GoldxRuntimeTradeState,
): Required<GoldxRuntimeTradeState> {
  return {
    currentOpenTrades: runtimeState?.currentOpenTrades ?? accountState.currentOpenTrades ?? 0,
    tradesOpenedLastMinute: runtimeState?.tradesOpenedLastMinute ?? 0,
    profitToday: runtimeState?.profitToday ?? accountState.profitToday,
    lastBatchClosedAt: runtimeState?.lastBatchClosedAt ?? accountState.lastBatchClosedAt ?? null,
    losingBatchesInRow: runtimeState?.losingBatchesInRow ?? accountState.consecutiveLosingBatches ?? 0,
  };
}

function buildBatchId(licenseId: string): string {
  return `batch_${licenseId.slice(0, 8)}_${Date.now().toString(36)}`;
}

function buildScalpEntries(
  action: 'buy' | 'sell',
  baseLot: number,
  entry: number,
  stopLoss: number,
  takeProfit: number,
  maxEntries: number,
): GoldxScalpEntry[] {
  const selectedWeights = ENTRY_SPLITS.slice(0, maxEntries);
  const totalWeight = selectedWeights.reduce((sum, value) => sum + value, 0);
  return selectedWeights.map((weight, index) => {
    const normalizedWeight = weight / totalWeight;
    const drift = action === 'buy' ? index * 0.02 : index * -0.02;
    return {
      lot: roundLot(baseLot * normalizedWeight),
      entry: roundPrice(entry + drift),
      tp: roundPrice(takeProfit),
      sl: roundPrice(stopLoss),
    };
  });
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

function computeConfidence(
  values: {
    trendAlignment?: boolean;
    lowSpread?: boolean;
    strongBreakout?: boolean;
    cleanRange?: boolean;
    fallback?: boolean;
  },
): number {
  let score = values.fallback ? 45 : 40;
  if (values.trendAlignment) score += 20;
  if (values.lowSpread) score += 15;
  if (values.strongBreakout) score += 20;
  if (values.cleanRange) score += 15;
  return clamp(score, 40, 95);
}

function logDebug(
  config: EngineStrategyConfig,
  snapshot: MarketSnapshot,
  session: BrokerSession,
  decision: string,
): void {
  if (!config.debugLogging) return;
  console.log('GoldX Debug', {
    session,
    spread: snapshot.spread,
    atr: snapshot.atr,
    ema20: snapshot.ema20,
    ema50: snapshot.ema50,
    range: snapshot.range,
    decision,
  });
}

async function passesTradeControl(
  accountState: GoldxAccountState,
  tradeControl: EngineTradeControlConfig,
  session: BrokerSession,
  runtimeState: Required<GoldxRuntimeTradeState>,
): Promise<{ pass: boolean; reason: string }> {
  const maxTrades = session === 'day'
    ? tradeControl.dayMaxTradesPerDay
    : tradeControl.nightMaxTradesPerDay;

  if (accountState.tradesToday >= maxTrades) {
    return { pass: false, reason: `Max trades reached (${maxTrades}/day)` };
  }

  if (runtimeState.currentOpenTrades >= (accountState.maxSimultaneousTrades || 5)) {
    return { pass: false, reason: `Open trade cap reached (${runtimeState.currentOpenTrades}/${accountState.maxSimultaneousTrades || 5})` };
  }

  if (runtimeState.tradesOpenedLastMinute >= tradeControl.maxTradesPerMinute) {
    return { pass: false, reason: `Per-minute trade cap reached (${tradeControl.maxTradesPerMinute})` };
  }

  if (runtimeState.profitToday >= (accountState.dailyTargetPercent || tradeControl.dailyProfitStopPercent)) {
    return { pass: false, reason: `Daily target reached (${runtimeState.profitToday.toFixed(2)}%)` };
  }

  if (accountState.pausedUntil && new Date(accountState.pausedUntil).getTime() > Date.now()) {
    return { pass: false, reason: `Loss pause active until ${accountState.pausedUntil}` };
  }

  if (runtimeState.losingBatchesInRow >= 2 && runtimeState.lastBatchClosedAt) {
    const elapsedMs = Date.now() - new Date(runtimeState.lastBatchClosedAt).getTime();
    if (elapsedMs < tradeControl.losingBatchPauseMinutes * 60 * 1000) {
      return { pass: false, reason: 'Paused after 2 losing batches in a row' };
    }
  }

  const cooldownMinutes = session === 'day'
    ? tradeControl.dayCooldownMinutes
    : tradeControl.nightCooldownMinutes;

  if (accountState.lastTradeAt) {
    const elapsedMs = Date.now() - new Date(accountState.lastTradeAt).getTime();
    const cooldownMs = cooldownMinutes * 60 * 1000;
    if (elapsedMs < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsedMs) / 60000);
      return { pass: false, reason: `Cooldown: ${remaining}min remaining` };
    }
  }

  if (
    tradeControl.dailyProfitStopPercent > 0
    && accountState.profitToday >= tradeControl.dailyProfitStopPercent
  ) {
    return { pass: false, reason: `Daily profit target reached (${accountState.profitToday.toFixed(2)}%)` };
  }

  if (
    tradeControl.dailyDrawdownStopPercent > 0
    && accountState.drawdownToday >= tradeControl.dailyDrawdownStopPercent
  ) {
    return { pass: false, reason: `Daily drawdown limit reached (${accountState.drawdownToday.toFixed(2)}%)` };
  }

  return { pass: true, reason: 'Trade control passed' };
}

function buildFallbackSignal(
  now: string,
  mode: GoldxMode,
  modeConfig: GoldxModeConfig,
  accountBalance: number,
  session: BrokerSession,
  snapshot: MarketSnapshot,
  config: EngineStrategyConfig,
  accountState: GoldxAccountState,
  tradeControl: EngineTradeControlConfig,
  runtimeState: Required<GoldxRuntimeTradeState>,
): GoldxSignal {
  const [minConfidence, maxConfidence] = config.fallbackConfidenceRange;
  const bullishTrend = snapshot.ema20 >= snapshot.ema50;
  const action = session === 'day'
    ? (bullishTrend ? 'buy' : 'sell')
    : (snapshot.range && snapshot.mid <= snapshot.range.midpoint ? 'buy' : 'sell');

  const entry = action === 'buy' ? snapshot.ask : snapshot.bid;
  const tpDistance = clamp(snapshot.atr * (mode === 'fast' ? 0.25 : mode === 'prop' ? 0.35 : 0.3), 2, 5);
  const fallbackRisk = Math.max(snapshot.atr * 0.8, tpDistance * 1.5);
  const stopLoss = action === 'buy' ? entry - fallbackRisk : entry + fallbackRisk;
  const takeProfit = action === 'buy'
    ? entry + tpDistance
    : entry - tpDistance;
  const confidence = clamp(
    computeConfidence({
      trendAlignment: bullishTrend === (action === 'buy'),
      lowSpread: snapshot.spread <= (session === 'day' ? config.dayMaxSpreadPoints : config.nightMaxSpreadPoints),
      cleanRange: Boolean(snapshot.range),
      fallback: true,
    }),
    minConfidence,
    maxConfidence,
  );
  const availableSlots = Math.max(0, Math.min(
    getModeEntryCap(mode),
    (accountState.maxSimultaneousTrades || 5) - runtimeState.currentOpenTrades,
  ));
  const entries = availableSlots > 0
    ? buildScalpEntries(
        action,
        calculateLotSize(mode, modeConfig.riskPercent, accountBalance, entry, stopLoss),
        entry,
        stopLoss,
        takeProfit,
        availableSlots,
      )
    : [];
  const batchId = entries.length > 0 ? buildBatchId(accountState.licenseId) : null;

  return {
    action,
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    lotSize: entries[0]?.lot ?? calculateLotSize(mode, modeConfig.riskPercent, accountBalance, entry, stopLoss),
    entries,
    batchId,
    reentryAllowed: canReenter(mode, tradeControl, runtimeState),
    maxSimultaneousTrades: accountState.maxSimultaneousTrades || 5,
    currentOpenTrades: runtimeState.currentOpenTrades,
    confidence,
    reason: session === 'day'
      ? 'Fallback momentum trade in clean market'
      : 'Fallback mean reversion trade in clean market',
    mode,
    sessionType: session === 'off' ? 'closed' : session,
    session,
    timestamp: now,
    strategyName: session === 'day' ? 'day-fallback' : 'night-fallback',
    sweepDetected: false,
    bosConfirmed: false,
    trendAligned: bullishTrend === (action === 'buy'),
  };
}

function runNightStrategy(
  now: string,
  mode: GoldxMode,
  modeConfig: GoldxModeConfig,
  accountBalance: number,
  snapshot: MarketSnapshot,
  config: EngineStrategyConfig,
  accountState: GoldxAccountState,
  tradeControl: EngineTradeControlConfig,
  runtimeState: Required<GoldxRuntimeTradeState>,
): GoldxSignal {
  if (!snapshot.range) {
    return buildNoSignal(now, mode, 'night', 'Night range unavailable', { strategyName: 'night-mean-reversion' });
  }

  const range = snapshot.range;
  const price = snapshot.mid;
  const edgeThreshold = range.size * config.nightEdgeThresholdPct;
  const nearHigh = range.high - price <= edgeThreshold;
  const nearLow = price - range.low <= edgeThreshold;
  const atrOkay = snapshot.atr <= range.size * config.nightAtrCapMultiplier;
  const spreadOkay = snapshot.spread <= config.nightMaxSpreadPoints;

  if (!spreadOkay || !atrOkay) {
    if (spreadOkay || atrOkay) {
      return buildFallbackSignal(now, mode, modeConfig, accountBalance, 'night', snapshot, config, accountState, tradeControl, runtimeState);
    }
    return buildNoSignal(now, mode, 'night', spreadOkay ? 'ATR too high for night range' : 'Spread too high for night range', {
      strategyName: 'night-mean-reversion',
    });
  }

  if (!nearHigh && !nearLow) {
    return buildFallbackSignal(now, mode, modeConfig, accountBalance, 'night', snapshot, config, accountState, tradeControl, runtimeState);
  }

  const action = nearLow ? 'buy' : 'sell';
  const entry = action === 'buy' ? snapshot.ask : snapshot.bid;
  const tpDistance = clamp(snapshot.atr * 0.3, 2, 5);
  const slDistance = Math.max(snapshot.atr * 0.8, tpDistance * 1.5);
  const stopLoss = action === 'buy' ? entry - slDistance : entry + slDistance;
  const takeProfit = action === 'buy' ? entry + tpDistance : entry - tpDistance;
  const confidence = computeConfidence({
    lowSpread: snapshot.spread <= config.nightMaxSpreadPoints * 0.7,
    cleanRange: true,
  });
  const availableSlots = Math.max(0, Math.min(
    getModeEntryCap(mode),
    (accountState.maxSimultaneousTrades || 5) - runtimeState.currentOpenTrades,
  ));
  const baseLot = calculateLotSize(mode, modeConfig.riskPercent, accountBalance, entry, stopLoss);
  const entries = availableSlots > 0
    ? buildScalpEntries(action, baseLot, entry, stopLoss, takeProfit, availableSlots)
    : [];
  const batchId = entries.length > 0 ? buildBatchId(accountState.licenseId) : null;

  return {
    action,
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    lotSize: entries[0]?.lot ?? baseLot,
    entries,
    batchId,
    reentryAllowed: canReenter(mode, tradeControl, runtimeState),
    maxSimultaneousTrades: accountState.maxSimultaneousTrades || 5,
    currentOpenTrades: runtimeState.currentOpenTrades,
    confidence,
    reason: action === 'buy'
      ? 'Night mean reversion buy near range low'
      : 'Night mean reversion sell near range high',
    mode,
    session: 'night',
    sessionType: 'night',
    timestamp: now,
    strategyName: 'night-mean-reversion',
    sweepDetected: false,
    bosConfirmed: false,
    trendAligned: false,
  };
}

function runDayStrategy(
  now: string,
  mode: GoldxMode,
  modeConfig: GoldxModeConfig,
  accountBalance: number,
  snapshot: MarketSnapshot,
  config: EngineStrategyConfig,
  accountState: GoldxAccountState,
  tradeControl: EngineTradeControlConfig,
  runtimeState: Required<GoldxRuntimeTradeState>,
): GoldxSignal {
  const lookback = Math.max(5, config.dayBreakoutLookbackCandles);
  const structureCandles = snapshot.candles.slice(-(lookback + 1), -1);
  if (structureCandles.length < lookback || !snapshot.previous) {
    return buildNoSignal(now, mode, 'day', 'Not enough candles for day breakout', { strategyName: 'day-breakout-momentum' });
  }

  const recentHigh = Math.max(...structureCandles.map((candle) => candle.high));
  const recentLow = Math.min(...structureCandles.map((candle) => candle.low));
  const bullishTrend = snapshot.ema20 > snapshot.ema50;
  const bearishTrend = snapshot.ema20 < snapshot.ema50;
  const lowSpread = snapshot.spread <= config.dayMaxSpreadPoints;
  const atrSane = snapshot.atr <= Math.max((recentHigh - recentLow) * config.dayAtrCapMultiplier, snapshot.atr * 2.5);
  const breakoutBody = Math.abs(snapshot.current.close - snapshot.current.open);
  const breakoutStrength = breakoutBody >= snapshot.atr * config.dayBreakoutBodyAtr;

  let action: 'buy' | 'sell' | null = null;
  if (bullishTrend && snapshot.current.close > recentHigh && snapshot.current.close > snapshot.ema20) {
    action = 'buy';
  }
  if (bearishTrend && snapshot.current.close < recentLow && snapshot.current.close < snapshot.ema20) {
    action = 'sell';
  }

  if (!lowSpread || !atrSane) {
    if (lowSpread || atrSane) {
      return buildFallbackSignal(now, mode, modeConfig, accountBalance, 'day', snapshot, config, accountState, tradeControl, runtimeState);
    }
    return buildNoSignal(now, mode, 'day', lowSpread ? 'ATR sanity check failed' : 'Spread too high for day breakout', {
      strategyName: 'day-breakout-momentum',
      trendAligned: bullishTrend || bearishTrend,
    });
  }

  if (!action || !breakoutStrength) {
    return buildFallbackSignal(now, mode, modeConfig, accountBalance, 'day', snapshot, config, accountState, tradeControl, runtimeState);
  }

  const entry = action === 'buy' ? snapshot.ask : snapshot.bid;
  const stopAnchor = action === 'buy'
    ? Math.min(snapshot.current.low, recentHigh)
    : Math.max(snapshot.current.high, recentLow);
  const stopLoss = action === 'buy'
    ? stopAnchor - snapshot.atr * config.daySlBufferAtr
    : stopAnchor + snapshot.atr * config.daySlBufferAtr;
  const risk = Math.abs(entry - stopLoss);

  if (risk <= 0) {
    return buildNoSignal(now, mode, 'day', 'Invalid breakout risk distance', {
      strategyName: 'day-breakout-momentum',
      trendAligned: true,
    });
  }

  const tpDistance = clamp(snapshot.atr * (mode === 'fast' ? 0.25 : mode === 'prop' ? 0.35 : 0.3), 2, 5);
  const takeProfit = action === 'buy' ? entry + tpDistance : entry - tpDistance;
  const confidence = computeConfidence({
    trendAlignment: true,
    lowSpread: snapshot.spread <= config.dayMaxSpreadPoints * 0.75,
    strongBreakout: breakoutStrength,
  });
  const availableSlots = Math.max(0, Math.min(
    getModeEntryCap(mode),
    (accountState.maxSimultaneousTrades || 5) - runtimeState.currentOpenTrades,
  ));
  const baseLot = calculateLotSize(mode, modeConfig.riskPercent, accountBalance, entry, stopLoss);
  const entries = availableSlots > 0
    ? buildScalpEntries(action, baseLot, entry, stopLoss, takeProfit, availableSlots)
    : [];
  const batchId = entries.length > 0 ? buildBatchId(accountState.licenseId) : null;

  return {
    action,
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    takeProfit: roundPrice(takeProfit),
    lotSize: entries[0]?.lot ?? baseLot,
    entries,
    batchId,
    reentryAllowed: canReenter(mode, tradeControl, runtimeState),
    maxSimultaneousTrades: accountState.maxSimultaneousTrades || 5,
    currentOpenTrades: runtimeState.currentOpenTrades,
    confidence,
    reason: action === 'buy'
      ? 'Day momentum breakout buy above recent high'
      : 'Day momentum breakout sell below recent low',
    mode,
    session: 'day',
    sessionType: 'day',
    timestamp: now,
    strategyName: 'day-breakout-momentum',
    sweepDetected: false,
    bosConfirmed: breakoutStrength,
    trendAligned: true,
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

  const [strategyConfig, tradeControl, baseModeConfig] = await Promise.all([
    getStrategyConfig(),
    getTradeControlConfig(),
    getModeConfig(mode),
  ]);

  const brokerSession = getSessionType(strategyConfig);
  const session = resolveAllowedSession(sessionMode, brokerSession);
  const normalizedRuntimeState = normalizeRuntimeState(accountState, runtimeTradeState);
  const noSignal = (reason: string, extras: Partial<GoldxSignal> = {}): GoldxSignal =>
    buildNoSignal(now, mode, session, reason, extras);

  if (session === 'off') {
    return noSignal('Outside configured trading session', { strategyName: 'session-router' });
  }

  const tradeControlCheck = await passesTradeControl(accountState, tradeControl, session, normalizedRuntimeState);
  if (!tradeControlCheck.pass) {
    return noSignal(tradeControlCheck.reason, { strategyName: 'trade-control' });
  }

  if (!canReenter(mode, tradeControl, normalizedRuntimeState)) {
    return noSignal('Re-entry cooldown active', {
      strategyName: 'reentry-guard',
      reentryAllowed: false,
      currentOpenTrades: normalizedRuntimeState.currentOpenTrades,
      maxSimultaneousTrades: accountState.maxSimultaneousTrades || 5,
    });
  }

  if (!candles.length) {
    return noSignal('No market candles supplied', { strategyName: 'snapshot-builder' });
  }

  const snapshot = buildSnapshot(candles, currentBid, currentAsk, strategyConfig);
  const decision = session === 'night'
    ? runNightStrategy(now, mode, baseModeConfig, accountBalance, snapshot, strategyConfig, accountState, tradeControl, normalizedRuntimeState)
    : runDayStrategy(now, mode, baseModeConfig, accountBalance, snapshot, strategyConfig, accountState, tradeControl, normalizedRuntimeState);

  logDebug(strategyConfig, snapshot, session, `${decision.action}:${decision.reason}`);
  console.log('SCALP ENGINE', {
    batchId: decision.batchId ?? null,
    openTrades: normalizedRuntimeState.currentOpenTrades,
    profitToday: normalizedRuntimeState.profitToday,
    reentryAllowed: decision.reentryAllowed ?? false,
  });
  return decision;
}

export async function recordTrade(
  licenseId: string,
  mt5Account: string,
  signal: GoldxSignal,
): Promise<void> {
  if (signal.action === 'none') return;

  const entries = signal.entries?.length
    ? signal.entries
    : (signal.entry != null && signal.stopLoss != null && signal.takeProfit != null && signal.lotSize != null)
      ? [{ lot: signal.lotSize, entry: signal.entry, tp: signal.takeProfit, sl: signal.stopLoss }]
      : [];

  if (!entries.length) return;

  await supabase.from('goldx_trade_history').insert(
    entries.map((entry, index) => ({
      license_id: licenseId,
      mt5_account: mt5Account,
      symbol: 'XAUUSD',
      direction: signal.action,
      entry_price: entry.entry,
      sl_price: entry.sl,
      tp_price: entry.tp,
      lot_size: entry.lot,
      mode: signal.mode,
      batch_id: signal.batchId ?? null,
      batch_index: index + 1,
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
        trades_today: (Number(state.trades_today ?? 0) + entries.length),
        current_open_trades: Number(state.current_open_trades ?? 0) + entries.length,
        last_trade_at: new Date().toISOString(),
        last_batch_id: signal.batchId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', state.id);
  }

  await markOnboardingStateByLicenseId(licenseId, { setupCompleted: true });

  await insertAuditLog('goldx_signal_trade_recorded', {
    licenseId,
    meta: {
      session: signal.session ?? null,
      sessionType: signal.sessionType ?? null,
      strategyName: signal.strategyName ?? null,
      batchId: signal.batchId ?? null,
      entryCount: entries.length,
      sweepDetected: signal.sweepDetected ?? false,
      bosConfirmed: signal.bosConfirmed ?? false,
      confidenceScore: signal.confidence,
    },
  });
}
