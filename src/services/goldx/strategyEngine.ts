// ============================================================
// GoldX — XAUUSD Night Scalping Strategy Engine
// ============================================================

import { supabase } from '../../lib/supabase';
import type {
  GoldxSignal,
  GoldxMode,
  GoldxModeConfig,
  GoldxStrategyConfig,
  GoldxTradeControlConfig,
  GoldxAccountState,
} from './types';
import { getModeConfig } from './licenseService';

// ── Market Data Types ───────────────────────────────────────

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketSnapshot {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  candles: Candle[];
  atr: number;
  ema20: number;
  vwap: number;
}

interface RangeZone {
  high: number;
  low: number;
  size: number;
}

// ── Config Loader ───────────────────────────────────────────

async function getStrategyConfig(): Promise<GoldxStrategyConfig> {
  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', 'strategy')
    .single();

  return (data?.value as GoldxStrategyConfig) ?? {
    symbol: 'XAUUSD',
    timeframe: 'M5',
    sessionStart: '00:00',
    sessionEnd: '06:00',
    lastEntryTime: '05:30',
    rangeLookbackMinutes: [60, 120],
    atrMaxMultiplier: 1.5,
    maxSpreadPoints: 30,
    cooldownMinutes: 15,
  };
}

async function getTradeControlConfig(): Promise<GoldxTradeControlConfig> {
  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', 'tradeControl')
    .single();

  return (data?.value as GoldxTradeControlConfig) ?? {
    cooldownMinutes: 15,
    dailyProfitStopPercent: 3.0,
    dailyDrawdownStopPercent: 2.0,
  };
}

// ── Indicator Helpers ───────────────────────────────────────

function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close),
    );
    trs.push(tr);
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

function calculateEMA(candles: Candle[], period = 20): number {
  if (candles.length === 0) return 0;
  const multiplier = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }
  return ema;
}

function calculateVWAP(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    const vol = c.volume || 1;
    cumulativeTPV += typicalPrice * vol;
    cumulativeVolume += vol;
  }
  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : 0;
}

// ── Time Filter ─────────────────────────────────────────────

function parseTimeString(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number);
  return { hours: h, minutes: m };
}

function isWithinTradingSession(config: GoldxStrategyConfig): boolean {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentMinutes = utcHours * 60 + utcMinutes;

  const start = parseTimeString(config.sessionStart);
  const end = parseTimeString(config.sessionEnd);
  const startMinutes = start.hours * 60 + start.minutes;
  const endMinutes = end.hours * 60 + end.minutes;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

function isPastLastEntry(config: GoldxStrategyConfig): boolean {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentMinutes = utcHours * 60 + utcMinutes;

  const last = parseTimeString(config.lastEntryTime);
  const lastMinutes = last.hours * 60 + last.minutes;

  return currentMinutes > lastMinutes;
}

// ── Range Detection ─────────────────────────────────────────

function detectRange(candles: Candle[], lookbackMinutes: [number, number]): RangeZone | null {
  const [minLookback, maxLookback] = lookbackMinutes;
  // Assuming M5 candles: minLookback/5 to maxLookback/5 candles
  const minCandles = Math.floor(minLookback / 5);
  const maxCandles = Math.floor(maxLookback / 5);

  if (candles.length < minCandles) return null;

  const lookbackCount = Math.min(maxCandles, candles.length);
  const rangeCandles = candles.slice(-lookbackCount);

  let high = -Infinity;
  let low = Infinity;
  for (const c of rangeCandles) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }

  const size = high - low;
  if (size <= 0) return null;

  return { high, low, size };
}

// ── Sweep Detection ─────────────────────────────────────────

interface SweepResult {
  direction: 'buy' | 'sell';
  sweepLevel: number;
  confirmationClose: number;
}

function detectSweep(
  candles: Candle[],
  range: RangeZone,
): SweepResult | null {
  if (candles.length < 3) return null;

  const recent = candles.slice(-3);
  const current = recent[recent.length - 1];
  const prev = recent[recent.length - 2];

  // BUY: sweep below range low, close back inside
  if (prev.low < range.low && current.close > range.low) {
    // Bullish confirmation: current close > current open
    if (current.close > current.open) {
      return {
        direction: 'buy',
        sweepLevel: prev.low,
        confirmationClose: current.close,
      };
    }
  }

  // SELL: sweep above range high, close back inside
  if (prev.high > range.high && current.close < range.high) {
    // Bearish confirmation: current close < current open
    if (current.close < current.open) {
      return {
        direction: 'sell',
        sweepLevel: prev.high,
        confirmationClose: current.close,
      };
    }
  }

  return null;
}

// ── Filters ─────────────────────────────────────────────────

function passesFilters(
  snapshot: MarketSnapshot,
  range: RangeZone,
  config: GoldxStrategyConfig,
  modeConfig: GoldxModeConfig,
): { pass: boolean; reason: string } {
  // ATR filter
  const atrThreshold = range.size * config.atrMaxMultiplier;
  if (snapshot.atr > atrThreshold) {
    return { pass: false, reason: `ATR ${snapshot.atr.toFixed(2)} exceeds range threshold ${atrThreshold.toFixed(2)}` };
  }

  // Spread filter
  if (snapshot.spread > config.maxSpreadPoints) {
    return { pass: false, reason: `Spread ${snapshot.spread.toFixed(1)} exceeds max ${config.maxSpreadPoints}` };
  }

  // Strict mode: tighter filters
  if (modeConfig.filterStrictness === 'strict') {
    if (snapshot.atr > range.size * (config.atrMaxMultiplier * 0.7)) {
      return { pass: false, reason: 'Strict mode: ATR too high relative to range' };
    }
    if (snapshot.spread > config.maxSpreadPoints * 0.6) {
      return { pass: false, reason: 'Strict mode: spread too wide' };
    }
  }

  return { pass: true, reason: 'All filters passed' };
}

// ── Trade Control ───────────────────────────────────────────

function passesTradeControl(
  accountState: GoldxAccountState,
  modeConfig: GoldxModeConfig,
  tradeControl: GoldxTradeControlConfig,
): { pass: boolean; reason: string } {
  // Max trades per day
  if (accountState.tradesToday >= modeConfig.maxTrades) {
    return { pass: false, reason: `Max trades reached (${modeConfig.maxTrades}/day)` };
  }

  // Cooldown
  if (accountState.lastTradeAt) {
    const elapsed = Date.now() - new Date(accountState.lastTradeAt).getTime();
    const cooldownMs = tradeControl.cooldownMinutes * 60 * 1000;
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
      return { pass: false, reason: `Cooldown: ${remaining}min remaining` };
    }
  }

  // Daily profit stop
  if (tradeControl.dailyProfitStopPercent > 0 && accountState.profitToday >= tradeControl.dailyProfitStopPercent) {
    return { pass: false, reason: `Daily profit target reached (${accountState.profitToday.toFixed(2)}%)` };
  }

  // Drawdown stop
  if (tradeControl.dailyDrawdownStopPercent > 0 && accountState.drawdownToday >= tradeControl.dailyDrawdownStopPercent) {
    return { pass: false, reason: `Daily drawdown limit reached (${accountState.drawdownToday.toFixed(2)}%)` };
  }

  return { pass: true, reason: 'Trade control passed' };
}

// ── TP/SL Calculation ───────────────────────────────────────

function calculateTargets(
  direction: 'buy' | 'sell',
  entry: number,
  sweepLevel: number,
  snapshot: MarketSnapshot,
): { stopLoss: number; takeProfit: number } {
  const buffer = snapshot.atr * 0.3;

  if (direction === 'buy') {
    const stopLoss = sweepLevel - buffer;
    // TP = VWAP or EMA20, whichever is further from entry
    const tpVwap = snapshot.vwap > entry ? snapshot.vwap : entry + (entry - stopLoss) * 2;
    const tpEma = snapshot.ema20 > entry ? snapshot.ema20 : entry + (entry - stopLoss) * 2;
    const takeProfit = Math.max(tpVwap, tpEma);
    return { stopLoss, takeProfit };
  } else {
    const stopLoss = sweepLevel + buffer;
    const tpVwap = snapshot.vwap < entry ? snapshot.vwap : entry - (stopLoss - entry) * 2;
    const tpEma = snapshot.ema20 < entry ? snapshot.ema20 : entry - (stopLoss - entry) * 2;
    const takeProfit = Math.min(tpVwap, tpEma);
    return { stopLoss, takeProfit };
  }
}

// ── Lot Size Calculation ────────────────────────────────────

function calculateLotSize(
  riskPercent: number,
  accountBalance: number,
  entry: number,
  stopLoss: number,
): number {
  const riskAmount = accountBalance * (riskPercent / 100);
  const pipDistance = Math.abs(entry - stopLoss);
  if (pipDistance <= 0) return 0.01;

  // For XAUUSD: 1 lot = 100 oz, 1 pip = $0.01/oz → $1/lot
  const pipValue = 1; // $1 per pip per lot for XAUUSD
  const lotSize = riskAmount / (pipDistance * 100 * pipValue);

  return Math.max(0.01, Math.round(lotSize * 100) / 100);
}

// ── Main Signal Generator ───────────────────────────────────

export async function generateSignal(
  accountState: GoldxAccountState,
  candles: Candle[],
  currentBid: number,
  currentAsk: number,
  accountBalance: number = 10000,
): Promise<GoldxSignal> {
  const now = new Date().toISOString();
  const mode = accountState.mode;

  const strategyConfig = await getStrategyConfig();
  const modeConfig = await getModeConfig(mode);
  const tradeControl = await getTradeControlConfig();

  const noSignal = (reason: string): GoldxSignal => ({
    action: 'none',
    entry: null,
    stopLoss: null,
    takeProfit: null,
    lotSize: null,
    confidence: 0,
    reason,
    mode,
    timestamp: now,
  });

  // Time filter
  if (!isWithinTradingSession(strategyConfig)) {
    return noSignal('Outside trading session');
  }
  if (isPastLastEntry(strategyConfig)) {
    return noSignal('Past last entry time');
  }

  // Trade control
  const tcResult = passesTradeControl(accountState, modeConfig, tradeControl);
  if (!tcResult.pass) {
    return noSignal(tcResult.reason);
  }

  // Build market snapshot
  const spread = currentAsk - currentBid;
  const atr = calculateATR(candles);
  const ema20 = calculateEMA(candles, 20);
  const vwap = calculateVWAP(candles);

  const snapshot: MarketSnapshot = {
    symbol: strategyConfig.symbol,
    bid: currentBid,
    ask: currentAsk,
    spread: spread * 10, // convert to points
    candles,
    atr,
    ema20,
    vwap,
  };

  // Detect range
  const range = detectRange(candles, strategyConfig.rangeLookbackMinutes);
  if (!range) {
    return noSignal('No valid range detected');
  }

  // Filters
  const filterResult = passesFilters(snapshot, range, strategyConfig, modeConfig);
  if (!filterResult.pass) {
    return noSignal(filterResult.reason);
  }

  // Detect sweep
  const sweep = detectSweep(candles, range);
  if (!sweep) {
    return noSignal('No sweep detected');
  }

  // Calculate targets
  const entry = sweep.direction === 'buy' ? currentAsk : currentBid;
  const { stopLoss, takeProfit } = calculateTargets(sweep.direction, entry, sweep.sweepLevel, snapshot);

  // Lot size
  const lotSize = calculateLotSize(modeConfig.riskPercent, accountBalance, entry, stopLoss);

  // Confidence scoring
  let confidence = 70;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);
  if (risk > 0 && reward / risk >= 2) confidence += 15;
  if (snapshot.spread < strategyConfig.maxSpreadPoints * 0.5) confidence += 10;
  if (atr < range.size * 0.8) confidence += 5;
  confidence = Math.min(100, confidence);

  return {
    action: sweep.direction,
    entry: Math.round(entry * 100) / 100,
    stopLoss: Math.round(stopLoss * 100) / 100,
    takeProfit: Math.round(takeProfit * 100) / 100,
    lotSize,
    confidence,
    reason: `${sweep.direction.toUpperCase()} — Liquidity sweep at ${sweep.sweepLevel.toFixed(2)}, confirmation close at ${sweep.confirmationClose.toFixed(2)}`,
    mode,
    timestamp: now,
  };
}

// ── Record Trade ────────────────────────────────────────────

export async function recordTrade(
  licenseId: string,
  mt5Account: string,
  signal: GoldxSignal,
): Promise<void> {
  if (signal.action === 'none') return;

  await supabase.from('goldx_trade_history').insert({
    license_id: licenseId,
    mt5_account: mt5Account,
    symbol: 'XAUUSD',
    direction: signal.action,
    entry_price: signal.entry,
    sl_price: signal.stopLoss,
    tp_price: signal.takeProfit,
    lot_size: signal.lotSize,
    mode: signal.mode,
  });
}
