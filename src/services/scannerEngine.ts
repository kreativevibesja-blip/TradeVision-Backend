import { analyzeEmaTrend, calculateEmaSeries, isEmaDirectionAligned, type EmaTrendContext } from '../lib/indicators/ema';

// ============================================================
// Smart Session Scanner — Pure Logic Trade Detection Engine
// No AI calls. Deterministic candle-based detection only.
// ============================================================

// ── Data type ──

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time: number;
}

// ── Result types ──

export type TrendDirection = 'bullish' | 'bearish' | 'ranging';

export interface LiquiditySweep {
  type: 'sweep_high' | 'sweep_low';
}

export type EngulfingSignal = 'bullish' | 'bearish';
export type RejectionSignal = 'bullish_rejection' | 'bearish_rejection';
export type StructureBreak = 'bullish' | 'bearish';

export interface SetupConfirmations {
  sweep: LiquiditySweep | null;
  engulfing: EngulfingSignal | null;
  rejection: RejectionSignal | null;
  structure: StructureBreak | null;
}

export interface TradeConfirmations {
  liquiditySweep: boolean;
  engulfing: boolean;
  rejection: boolean;
  bos: boolean;
  poiReclaim: boolean;
  emaAligned: boolean;
  zoneReaction: boolean;
  displacement: boolean;
  momentum: boolean;
  edgeBase: boolean;
  breakerBlock: boolean;
  fvgReaction: boolean;
  equalLevelSweep: boolean;
  premiumDiscount: boolean;
  ote: boolean;
  mss: boolean;
}

export type MarketRegime = 'range' | 'trend' | 'reversal';

export interface TradeSetup {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  slReason?: 'Zone-based buffered SL' | 'Swing-based ATR fallback SL' | 'EMA200-anchored SL';
  takeProfit: number;
  takeProfit2: number;
  score: number;
  confidenceScore: number;
  marketRegime: MarketRegime;
  strategy: string;
  confirmations: TradeConfirmations;
  confirmationLabels: string[];
}

export interface SwingPoint {
  type: 'high' | 'low';
  price: number;
  index: number;
}

export interface PriceZone {
  type: 'supply' | 'demand';
  top: number;
  bottom: number;
  distanceToPrice: number;
  originIndex?: number;
  touches?: number;
}

export interface FairValueGap {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  distanceToPrice: number;
  originIndex?: number;
}

interface PriceArea {
  top: number;
  bottom: number;
}

export interface PotentialTradeSetup {
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice: number;
  entry: number;
  stopLoss: number;
  slReason?: 'Zone-based buffered SL' | 'Swing-based ATR fallback SL' | 'EMA200-anchored SL';
  takeProfit: number;
  takeProfit2: number;
  activationProbability: number;
  confidenceScore: number;
  marketRegime: MarketRegime;
  confirmations: TradeConfirmations;
  strategy: string;
  narrative: string;
  fulfilledConditions: string[];
  requiredTriggers: string[];
  contextLabels: string[];
}

type PotentialSetupMode = 'trend' | 'counter';

const MIN_SCANNER_ANALYSIS_CANDLES = 200;
const DOUBLE_REVERSAL_PATTERN_LOOKBACK = 100;
const HEAD_SHOULDERS_PATTERN_LOOKBACK = 120;
const SUPPORT_RESISTANCE_RANGE_LOOKBACK = 120;

// ── 1. Trend Detection ──
// Counts higher-highs/higher-lows vs lower-highs/lower-lows
// over the last 20 candles to classify the trend.

function detectTrendFromLookback(candles: Candle[], lookback: number, minimumMoves: number): TrendDirection {
  if (candles.length < lookback + 1) return 'ranging';

  const recent = candles.slice(-lookback);

  let higherHighs = 0;
  let higherLows = 0;
  let lowerHighs = 0;
  let lowerLows = 0;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > recent[i - 1].high) higherHighs++;
    if (recent[i].low > recent[i - 1].low) higherLows++;
    if (recent[i].high < recent[i - 1].high) lowerHighs++;
    if (recent[i].low < recent[i - 1].low) lowerLows++;
  }

  if (higherHighs > minimumMoves && higherLows > minimumMoves) return 'bullish';
  if (lowerHighs > minimumMoves && lowerLows > minimumMoves) return 'bearish';

  return 'ranging';
}

export function detectTrend(candles: Candle[]): TrendDirection {
  return detectTrendFromLookback(candles, 20, 10);
}

function detectContextTrend(candles: Candle[]): TrendDirection {
  return detectTrendFromLookback(candles, 48, 24);
}

// ── 1b. Macro Trend Detection (EMA 200 Filter) ──
// The EMA 200 is the primary macro directional filter.
// Price above EMA 200 → bullish (buy setups only).
// Price below EMA 200 → bearish (sell setups only).
// Price hugging EMA 200 (within a small buffer) → ranging.

function detectMacroTrend(candles: Candle[], emaTrend: EmaTrendContext): TrendDirection {
  if (candles.length < 200 || emaTrend.ema200 == null || emaTrend.ema50 == null) return 'ranging';

  const currentPrice = candles[candles.length - 1].close;
  const ema200 = emaTrend.ema200;
  const ema50 = emaTrend.ema50;

  if (currentPrice > ema200 && ema50 > ema200) return 'bullish';
  if (currentPrice < ema200 && ema50 < ema200) return 'bearish';
  return 'ranging';
}

type TrendFilterLogReason = 'trend-aligned' | 'counter-trend-approved' | 'counter-trend-rejected';

function logTrendFilter(symbol: string, direction: 'buy' | 'sell', reason: TrendFilterLogReason, detail?: string) {
  console.log(`[Scanner][filter] ${symbol} ${direction.toUpperCase()} ${reason}${detail ? ` (${detail})` : ''}`);
}

function evaluateTrendPriorityFilter(input: {
  symbol: string;
  direction: 'buy' | 'sell';
  macroTrend: TrendDirection;
  confidenceScore: number;
  hasBos: boolean;
  hasDisplacement: boolean;
  hasLiquiditySweep: boolean;
  hasStrongZone: boolean;
  hasRejection: boolean;
}): { allowed: boolean; reason: TrendFilterLogReason } {
  const isTrendAligned = input.macroTrend !== 'ranging'
    && ((input.direction === 'buy' && input.macroTrend === 'bullish') || (input.direction === 'sell' && input.macroTrend === 'bearish'));

  if (input.macroTrend === 'ranging') {
    const allowed = input.hasStrongZone && input.hasRejection;
    const reason: TrendFilterLogReason = allowed ? 'trend-aligned' : 'counter-trend-rejected';
    logTrendFilter(input.symbol, input.direction, reason, allowed ? 'range strong zone + rejection confirmed' : 'range lacks strong zone or rejection');
    return { allowed, reason };
  }

  if (isTrendAligned) {
    logTrendFilter(input.symbol, input.direction, 'trend-aligned');
    return { allowed: true, reason: 'trend-aligned' };
  }

  if (input.confidenceScore >= 8 && input.hasBos && input.hasDisplacement && input.hasLiquiditySweep) {
    logTrendFilter(input.symbol, input.direction, 'counter-trend-approved');
    return { allowed: true, reason: 'counter-trend-approved' };
  }

  logTrendFilter(input.symbol, input.direction, 'counter-trend-rejected');
  return { allowed: false, reason: 'counter-trend-rejected' };
}

// ── 1c. EMA 50 Execution Helpers ──
// The EMA 50 acts as the execution layer: dynamic support/resistance,
// pullback detection, and confluence with structural zones.

interface Ema50ExecutionContext {
  /** Price is within striking distance of EMA 50 (pullback into trend) */
  nearEma50: boolean;
  /** A structural zone (supply/demand) overlaps with the EMA 50 region */
  ema50ZoneConfluence: boolean;
  /** EMA 50 sits above EMA 200 (bullish stack) or below (bearish stack) */
  ema50Above200: boolean;
  /** Previous candle closed on the other side of EMA 50 and current candle crossed through it.
   *  'bearish' = prev close > ema50, current close < ema50 (sell trigger).
   *  'bullish' = prev close < ema50, current close > ema50 (buy trigger). */
  ema50Cross: 'bullish' | 'bearish' | null;
}

function analyzeEma50Execution(
  candles: Candle[],
  emaTrend: EmaTrendContext,
  directionalZone: PriceZone | null,
  directionalFvg: FairValueGap | null,
): Ema50ExecutionContext {
  const ema50 = emaTrend.ema50;
  const ema200 = emaTrend.ema200;

  if (ema50 == null || ema200 == null || candles.length < 2) {
    return { nearEma50: false, ema50ZoneConfluence: false, ema50Above200: false, ema50Cross: null };
  }

  const currentPrice = candles[candles.length - 1].close;
  const avgRange = averageRange(candles, 12);
  const ema50Proximity = Math.max(avgRange * 2, ema50 * 0.002);

  const nearEma50 = Math.abs(currentPrice - ema50) <= ema50Proximity;

  // Check if EMA 50 sits inside or very near a structural zone/FVG
  let ema50ZoneConfluence = false;
  if (directionalZone) {
    const zoneBuffer = Math.max(avgRange * 0.5, (directionalZone.top - directionalZone.bottom) * 0.3);
    ema50ZoneConfluence = ema50 >= directionalZone.bottom - zoneBuffer && ema50 <= directionalZone.top + zoneBuffer;
  }
  if (!ema50ZoneConfluence && directionalFvg) {
    const fvgBuffer = Math.max(avgRange * 0.5, (directionalFvg.top - directionalFvg.bottom) * 0.3);
    ema50ZoneConfluence = ema50 >= directionalFvg.bottom - fvgBuffer && ema50 <= directionalFvg.top + fvgBuffer;
  }

  const ema50Above200 = ema50 > ema200;

  // Detect EMA 50 cross: previous candle closed on one side, current candle closed on the other
  let ema50Cross: 'bullish' | 'bearish' | null = null;
  const ema50Series = calculateEmaSeries(candles, 50);
  if (ema50Series.length >= 2) {
    const prevEma50 = ema50Series[ema50Series.length - 2].value;
    const prevClose = candles[candles.length - 2].close;
    if (prevClose > prevEma50 && currentPrice < ema50) {
      ema50Cross = 'bearish';
    } else if (prevClose < prevEma50 && currentPrice > ema50) {
      ema50Cross = 'bullish';
    }
  }

  return { nearEma50, ema50ZoneConfluence, ema50Above200, ema50Cross };
}

// ── 2. Liquidity Sweep Detection ──
// Checks if the latest candle wicked beyond a recent
// high/low but closed back inside — classic stop hunt.

export function detectLiquiditySweep(candles: Candle[]): LiquiditySweep | null {
  if (candles.length < 11) return null;

  const last = candles[candles.length - 1];
  const lookback = candles.slice(-11, -1);

  const prevHigh = Math.max(...lookback.map((c) => c.high));
  const prevLow = Math.min(...lookback.map((c) => c.low));

  // Swept highs but closed below → bearish sweep
  if (last.high > prevHigh && last.close < prevHigh) {
    return { type: 'sweep_high' };
  }

  // Swept lows but closed above → bullish sweep
  if (last.low < prevLow && last.close > prevLow) {
    return { type: 'sweep_low' };
  }

  return null;
}

// ── 3. Engulfing Candle Detection ──
// Classic engulfing pattern: current body fully wraps previous body
// with opposing direction.

export function detectEngulfing(prev: Candle, current: Candle): EngulfingSignal | null {
  const prevBody = Math.abs(prev.close - prev.open);
  const currentBody = Math.abs(current.close - current.open);

  // Bullish engulfing
  if (
    current.close > current.open &&
    prev.close < prev.open &&
    currentBody > prevBody &&
    current.close > prev.open &&
    current.open < prev.close
  ) {
    return 'bullish';
  }

  // Bearish engulfing
  if (
    current.close < current.open &&
    prev.close > prev.open &&
    currentBody > prevBody &&
    current.open > prev.close &&
    current.close < prev.open
  ) {
    return 'bearish';
  }

  return null;
}

// ── 4. Rejection Wick Detection ──
// A wick that is at least 2x the body signals strong rejection.

export function detectRejection(candle: Candle): RejectionSignal | null {
  const body = Math.abs(candle.close - candle.open);
  if (body === 0) return null; // doji — skip; no clear rejection signal

  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;

  if (upperWick > body * 2) return 'bearish_rejection';
  if (lowerWick > body * 2) return 'bullish_rejection';

  return null;
}

// ── 5. Pullback Detection ──
// In a bullish trend the price should have pulled back near the
// recent swing low. In bearish, near the recent swing high.

export function detectPullback(trend: TrendDirection, candles: Candle[]): boolean {
  if (candles.length < 11 || trend === 'ranging') return false;

  const recent = candles.slice(-10);
  const highs = recent.map((c) => c.high);
  const lows = recent.map((c) => c.low);

  const highest = Math.max(...highs);
  const lowest = Math.min(...lows);

  const last = candles[candles.length - 1];

  // Bearish: price pulled back UP near the recent high (within 0.5%)
  if (trend === 'bearish' && last.high >= highest * 0.995) {
    return true;
  }

  // Bullish: price pulled back DOWN near the recent low (within 0.5%)
  if (trend === 'bullish' && last.low <= lowest * 1.005) {
    return true;
  }

  return false;
}

// ── 6. Structure Break (Micro BOS) ──
// If the latest candle closes beyond the previous candle's range,
// that's a micro break of structure.

export function detectStructureBreak(candles: Candle[]): StructureBreak | null {
  if (candles.length < 2) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  if (last.close > prev.high) return 'bullish';
  if (last.close < prev.low) return 'bearish';

  return null;
}

// ── 7. Scoring Engine ──
// Maximum possible score: 9
// Minimum to qualify: 5

interface ScoreInput {
  trend: TrendDirection;
  pullback: boolean;
  sweep: LiquiditySweep | null;
  engulfing: EngulfingSignal | null;
  rejection: RejectionSignal | null;
  structure: StructureBreak | null;
}

export function scoreSetup(input: ScoreInput): number {
  let score = 0;

  if (input.trend !== 'ranging') score += 2;              // +2 trend alignment
  if (input.pullback) score += 2;                          // +2 pullback zone
  if (input.sweep) score += 2;                             // +2 liquidity sweep
  if (input.engulfing || input.rejection) score += 2;      // +2 confirmation candle
  if (input.structure) score += 1;                         // +1 structure break

  return score;
}

// ── Confidence mapping ──
// Maps a 0–9 score into a 0–100 confidence percentage.

function scoreToConfidence(score: number): number {
  if (score >= 9) return 95;
  if (score >= 7) return 85;
  if (score >= 6) return 75;
  if (score >= 5) return 65;
  return 40;
}

// ── Strategy label ──

function deriveStrategy(direction: 'buy' | 'sell', sweep: LiquiditySweep | null): string {
  if (sweep) {
    return direction === 'buy'
      ? 'Bullish Liquidity Sweep Reversal'
      : 'Bearish Liquidity Sweep Reversal';
  }
  return direction === 'buy'
    ? 'Bullish Pullback Continuation'
    : 'Bearish Pullback Continuation';
}

// ── Confirmation labels ──

function buildConfirmationLabels(confirmations: SetupConfirmations): string[] {
  const labels: string[] = [];

  if (confirmations.sweep) {
    labels.push(confirmations.sweep.type === 'sweep_high' ? 'Liquidity sweep (highs)' : 'Liquidity sweep (lows)');
  }
  if (confirmations.engulfing) {
    labels.push(confirmations.engulfing === 'bullish' ? 'Bullish engulfing' : 'Bearish engulfing');
  }
  if (confirmations.rejection) {
    labels.push(confirmations.rejection === 'bullish_rejection' ? 'Bullish rejection wick' : 'Bearish rejection wick');
  }
  if (confirmations.structure) {
    labels.push(confirmations.structure === 'bullish' ? 'Micro BOS (bullish)' : 'Micro BOS (bearish)');
  }

  return labels;
}

export function countTradeConfirmations(confirmations: TradeConfirmations): number {
  return Object.values(confirmations).filter(Boolean).length;
}

function buildTradeConfirmations(input: {
  alignedSweep: boolean;
  alignedEngulfing: boolean;
  alignedRejection: boolean;
  alignedStructure: boolean;
  poiReclaim: boolean;
  emaAligned: boolean;
  zoneReaction: boolean;
  freshDisplacement: boolean;
  alignedMomentum: boolean;
  edgeBase?: boolean;
  breakerBlock?: boolean;
  fvgReaction?: boolean;
  equalLevelSweep?: boolean;
  premiumDiscount?: boolean;
  ote?: boolean;
  mss?: boolean;
}): TradeConfirmations {
  return {
    liquiditySweep: input.alignedSweep,
    engulfing: input.alignedEngulfing,
    rejection: input.alignedRejection,
    bos: input.alignedStructure,
    poiReclaim: input.poiReclaim,
    emaAligned: input.emaAligned,
    zoneReaction: input.zoneReaction,
    displacement: input.freshDisplacement,
    momentum: input.alignedMomentum,
    edgeBase: input.edgeBase ?? false,
    breakerBlock: input.breakerBlock ?? false,
    fvgReaction: input.fvgReaction ?? false,
    equalLevelSweep: input.equalLevelSweep ?? false,
    premiumDiscount: input.premiumDiscount ?? false,
    ote: input.ote ?? false,
    mss: input.mss ?? false,
  };
}

// ── SL/TP calculation helpers ──

interface SymbolRiskProfile {
  structureLookback: number;
  atrPeriod: number;
  minStopAtrMultiplier: number;
  minStopRangeMultiplier: number;
  minStopPriceRatio: number;
  bufferAtrMultiplier: number;
  bufferRangeMultiplier: number;
  bufferPriceRatio: number;
  minStructuralOriginAge: number;
  minZoneHeightAtrMultiplier: number;
  minZoneHeightRangeMultiplier: number;
  minZoneHeightPriceRatio: number;
  minTargetOriginAge: number;
  minTargetRiskMultiple: number;
}

function isVolatilitySymbol(symbol: string): boolean {
  return /^R_\d+$/.test(symbol) || /^1HZ\d+V$/i.test(symbol);
}

function isForexSymbol(symbol: string): boolean {
  return /^[A-Z]{6}$/.test(symbol) && !['XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'LTCUSD', 'NAS100', 'SPX500'].includes(symbol);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageBody(candles: Candle[], lookback = 8): number {
  const recent = candles.slice(-lookback);
  return average(recent.map((candle) => Math.abs(candle.close - candle.open)));
}

function averageRange(candles: Candle[], lookback = 12): number {
  const recent = candles.slice(-lookback);
  return average(recent.map((candle) => candle.high - candle.low));
}

function toPriceArea(area: PriceZone | FairValueGap | null): PriceArea | null {
  if (!area) {
    return null;
  }

  return {
    top: Math.max(area.top, area.bottom),
    bottom: Math.min(area.top, area.bottom),
  };
}

function candleTouchesArea(candle: Candle, area: PriceArea): boolean {
  return candle.low <= area.top && candle.high >= area.bottom;
}

function isDirectionalReactionFromArea(
  direction: 'buy' | 'sell',
  area: PriceArea | null,
  candles: Candle[],
): boolean {
  if (!area || candles.length < 4) {
    return false;
  }

  const recent = candles.slice(-4);
  const latest = recent[recent.length - 1];
  const baselineRange = Math.max(averageRange(candles, 10), 0.0001);
  const hadTouch = recent.slice(0, -1).some((candle) => candleTouchesArea(candle, area));

  if (!hadTouch) {
    return false;
  }

  if (direction === 'buy') {
    return latest.close > area.top && latest.close - area.top >= baselineRange * 0.35;
  }

  return latest.close < area.bottom && area.bottom - latest.close >= baselineRange * 0.35;
}

function hasPoiReclaim(
  direction: 'buy' | 'sell',
  area: PriceArea | null,
  candles: Candle[],
): boolean {
  if (!area || candles.length < 4) {
    return false;
  }

  const recent = candles.slice(-4);
  const latest = recent[recent.length - 1];
  const previous = recent[recent.length - 2];
  const baselineRange = Math.max(averageRange(candles, 10), 0.0001);
  const areaMidpoint = (area.top + area.bottom) / 2;
  const hadTouch = recent.slice(0, -1).some((candle) => candleTouchesArea(candle, area));

  if (!hadTouch) {
    return false;
  }

  if (direction === 'buy') {
    const reclaimedMidpoint = latest.close >= areaMidpoint;
    const bullishClose = latest.close > latest.open && latest.close > previous.close;
    const respectedArea = latest.low <= area.top + baselineRange * 0.2;
    return reclaimedMidpoint && bullishClose && respectedArea;
  }

  const reclaimedMidpoint = latest.close <= areaMidpoint;
  const bearishClose = latest.close < latest.open && latest.close < previous.close;
  const respectedArea = latest.high >= area.bottom - baselineRange * 0.2;
  return reclaimedMidpoint && bearishClose && respectedArea;
}

function hasFreshDisplacement(direction: 'buy' | 'sell', candles: Candle[]): boolean {
  if (candles.length < 4) {
    return false;
  }

  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const body = Math.abs(latest.close - latest.open);
  const range = Math.max(latest.high - latest.low, 0.0001);
  const baselineBody = Math.max(averageBody(candles, 10), 0.0001);

  if (body < baselineBody * 1.15) {
    return false;
  }

  if (direction === 'buy') {
    return latest.close > latest.open
      && latest.close >= latest.low + range * 0.7
      && latest.close > previous.high;
  }

  return latest.close < latest.open
    && latest.close <= latest.high - range * 0.7
    && latest.close < previous.low;
}

function isExtendedFromArea(
  direction: 'buy' | 'sell',
  currentPrice: number,
  area: PriceArea | null,
  candles: Candle[],
): boolean {
  if (!area) {
    return false;
  }

  const baselineRange = Math.max(averageRange(candles, 12), currentPrice * 0.0007);
  const distance = direction === 'buy'
    ? Math.max(0, currentPrice - area.top)
    : Math.max(0, area.bottom - currentPrice);

  return distance > baselineRange * 1.8;
}

function computeAtr(candles: Candle[], period: number): number {
  if (candles.length < 2) {
    return 0;
  }

  const startIndex = Math.max(1, candles.length - period);
  const trueRanges: number[] = [];

  for (let index = startIndex; index < candles.length; index++) {
    const current = candles[index];
    const previous = candles[index - 1];
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      ),
    );
  }

  return average(trueRanges);
}

function getSymbolRiskProfile(symbol: string): SymbolRiskProfile {
  if (isVolatilitySymbol(symbol)) {
    return {
      structureLookback: 24,
      atrPeriod: 21,
      minStopAtrMultiplier: 2.1,
      minStopRangeMultiplier: 3,
      minStopPriceRatio: 0.006,
      bufferAtrMultiplier: 0.7,
      bufferRangeMultiplier: 1.1,
      bufferPriceRatio: 0.0015,
      minStructuralOriginAge: 8,
      minZoneHeightAtrMultiplier: 0.6,
      minZoneHeightRangeMultiplier: 1.2,
      minZoneHeightPriceRatio: 0.0018,
      minTargetOriginAge: 10,
      minTargetRiskMultiple: 1.8,
    };
  }

  if (isForexSymbol(symbol)) {
    return {
      structureLookback: 12,
      atrPeriod: 14,
      minStopAtrMultiplier: 0.9,
      minStopRangeMultiplier: 1.25,
      minStopPriceRatio: 0.0007,
      bufferAtrMultiplier: 0.25,
      bufferRangeMultiplier: 0.35,
      bufferPriceRatio: 0.0002,
      minStructuralOriginAge: 4,
      minZoneHeightAtrMultiplier: 0.22,
      minZoneHeightRangeMultiplier: 0.45,
      minZoneHeightPriceRatio: 0.0002,
      minTargetOriginAge: 4,
      minTargetRiskMultiple: 1.35,
    };
  }

  return {
    structureLookback: 16,
    atrPeriod: 14,
    minStopAtrMultiplier: 1.2,
    minStopRangeMultiplier: 1.7,
    minStopPriceRatio: 0.0015,
    bufferAtrMultiplier: 0.35,
    bufferRangeMultiplier: 0.5,
    bufferPriceRatio: 0.0004,
    minStructuralOriginAge: 5,
    minZoneHeightAtrMultiplier: 0.3,
    minZoneHeightRangeMultiplier: 0.65,
    minZoneHeightPriceRatio: 0.00045,
    minTargetOriginAge: 5,
    minTargetRiskMultiple: 1.5,
  };
}

function getOriginAge(totalCandles: number, originIndex?: number): number {
  if (originIndex == null || originIndex < 0) {
    return 0;
  }

  return Math.max(0, totalCandles - 1 - originIndex);
}

function isMeaningfulZone(symbol: string, zone: PriceZone, candles: Candle[], currentPrice: number): boolean {
  const profile = getSymbolRiskProfile(symbol);
  const atr = computeAtr(candles, profile.atrPeriod);
  const baselineRange = Math.max(averageRange(candles, 14), currentPrice * profile.minZoneHeightPriceRatio);
  const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
  const originAge = getOriginAge(candles.length, zone.originIndex);
  const minZoneHeight = Math.max(
    atr * profile.minZoneHeightAtrMultiplier,
    baselineRange * profile.minZoneHeightRangeMultiplier,
    currentPrice * profile.minZoneHeightPriceRatio,
  );

  return originAge >= profile.minStructuralOriginAge && zoneHeight >= minZoneHeight;
}

function isMeaningfulGap(symbol: string, gap: FairValueGap, candles: Candle[], currentPrice: number): boolean {
  const profile = getSymbolRiskProfile(symbol);
  const atr = computeAtr(candles, profile.atrPeriod);
  const baselineRange = Math.max(averageRange(candles, 14), currentPrice * profile.minZoneHeightPriceRatio);
  const gapHeight = Math.max(Math.abs(gap.top - gap.bottom), 0.0001);
  const originAge = getOriginAge(candles.length, gap.originIndex);
  const minGapHeight = Math.max(
    atr * profile.minZoneHeightAtrMultiplier * 0.55,
    baselineRange * profile.minZoneHeightRangeMultiplier * 0.6,
    currentPrice * profile.minZoneHeightPriceRatio * 0.65,
  );

  return originAge >= Math.max(2, profile.minStructuralOriginAge - 2) && gapHeight >= minGapHeight;
}

function computeStopLoss(symbol: string, direction: 'buy' | 'sell', candles: Candle[]): {
  stopLoss: number;
  slReason: 'Zone-based buffered SL' | 'Swing-based ATR fallback SL';
} {
  const profile = getSymbolRiskProfile(symbol);
  const recent = candles.slice(-profile.structureLookback);
  const last = candles[candles.length - 1];
  const atr = computeAtr(candles, profile.atrPeriod);
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, last.close);
  const gaps = buildFairValueGaps(lookLeftCandles, last.close);
  const directionalZone = findDirectionalZone(direction, zones, last.close, lookLeftCandles, symbol);
  const directionalFvg = findDirectionalFvg(direction, gaps, lookLeftCandles, symbol);
  const isValidZone = (zone: PriceZone) => {
    const zoneHeight = Math.abs(zone.top - zone.bottom);
    const age = getOriginAge(lookLeftCandles.length, zone.originIndex);
    return zoneHeight > atr * 0.5 && age > 3 && (zone.touches ?? 0) >= 2;
  };

  const zoneBuffer = (areaTop: number, areaBottom: number) => {
    const areaHeight = Math.max(Math.abs(areaTop - areaBottom), 0.0001);
    return Math.max(atr * 0.2, areaHeight * 0.15);
  };

  if (directionalZone && isValidZone(directionalZone)) {
    const buffer = zoneBuffer(directionalZone.top, directionalZone.bottom);
    return {
      stopLoss: direction === 'buy'
        ? directionalZone.bottom - buffer
        : directionalZone.top + buffer,
      slReason: 'Zone-based buffered SL',
    };
  }

  if (directionalFvg) {
    const buffer = zoneBuffer(directionalFvg.top, directionalFvg.bottom);
    return {
      stopLoss: direction === 'buy'
        ? Math.min(directionalFvg.bottom, directionalFvg.top) - buffer
        : Math.max(directionalFvg.top, directionalFvg.bottom) + buffer,
      slReason: 'Zone-based buffered SL',
    };
  }

  if (direction === 'buy') {
    const swingLow = Math.min(...recent.map((c) => c.low));
    return {
      stopLoss: swingLow - atr * 0.2,
      slReason: 'Swing-based ATR fallback SL',
    };
  }

  const swingHigh = Math.max(...recent.map((c) => c.high));
  return {
    stopLoss: swingHigh + atr * 0.2,
    slReason: 'Swing-based ATR fallback SL',
  };
}

/** When the trade is triggered by an EMA 50 cross, anchor the SL above/below the EMA 200
 *  (the macro filter level) instead of using the default structural SL. */
function computeEma200AnchoredStopLoss(
  symbol: string,
  direction: 'buy' | 'sell',
  candles: Candle[],
  ema200: number,
): number {
  const profile = getSymbolRiskProfile(symbol);
  const atr = computeAtr(candles, profile.atrPeriod);
  const avgRange = averageRange(candles, 12);
  const buffer = Math.max(atr * profile.bufferAtrMultiplier, avgRange * profile.bufferRangeMultiplier, ema200 * profile.bufferPriceRatio);

  if (direction === 'sell') {
    // SL above EMA 200 + buffer
    return ema200 + buffer;
  }
  // SL below EMA 200 - buffer
  return ema200 - buffer;
}

function computeTakeProfit(direction: 'buy' | 'sell', entry: number, stopLoss: number): number {
  const risk = Math.abs(entry - stopLoss);
  // 2:1 risk-reward ratio
  return direction === 'buy' ? entry + risk * 2 : entry - risk * 2;
}

function computeSecondaryTakeProfit(direction: 'buy' | 'sell', entry: number, stopLoss: number): number {
  const risk = Math.abs(entry - stopLoss);
  // 3:1 risk-reward ratio
  return direction === 'buy' ? entry + risk * 3 : entry - risk * 3;
}

function isSweepAligned(direction: 'buy' | 'sell', sweep: LiquiditySweep | null): boolean {
  if (!sweep) {
    return false;
  }

  return (direction === 'buy' && sweep.type === 'sweep_low') || (direction === 'sell' && sweep.type === 'sweep_high');
}

function isEngulfingAligned(direction: 'buy' | 'sell', engulfing: EngulfingSignal | null): boolean {
  if (!engulfing) {
    return false;
  }

  return (direction === 'buy' && engulfing === 'bullish') || (direction === 'sell' && engulfing === 'bearish');
}

function isRejectionAligned(direction: 'buy' | 'sell', rejection: RejectionSignal | null): boolean {
  if (!rejection) {
    return false;
  }

  return (direction === 'buy' && rejection === 'bullish_rejection') || (direction === 'sell' && rejection === 'bearish_rejection');
}

function isStructureAligned(direction: 'buy' | 'sell', structure: StructureBreak | null): boolean {
  if (!structure) {
    return false;
  }

  return (direction === 'buy' && structure === 'bullish') || (direction === 'sell' && structure === 'bearish');
}

function detectRecentMomentum(candles: Candle[]): TrendDirection {
  if (candles.length < 5) {
    return 'ranging';
  }

  const recent = candles.slice(-4);
  let upCloses = 0;
  let downCloses = 0;
  let higherLows = 0;
  let lowerHighs = 0;

  for (let index = 1; index < recent.length; index++) {
    if (recent[index].close > recent[index - 1].close) upCloses++;
    if (recent[index].close < recent[index - 1].close) downCloses++;
    if (recent[index].low > recent[index - 1].low) higherLows++;
    if (recent[index].high < recent[index - 1].high) lowerHighs++;
  }

  if (upCloses >= 2 && higherLows >= 2) return 'bullish';
  if (downCloses >= 2 && lowerHighs >= 2) return 'bearish';
  return 'ranging';
}

interface SupportResistanceRange {
  support: number;
  resistance: number;
  supportExtreme: number;
  resistanceExtreme: number;
  supportTouches: number;
  resistanceTouches: number;
  rangeHeight: number;
  baselineRange: number;
}

function detectSupportResistanceRange(candles: Candle[]): SupportResistanceRange | null {
  if (candles.length < SUPPORT_RESISTANCE_RANGE_LOOKBACK) {
    return null;
  }

  const recent = candles.slice(-SUPPORT_RESISTANCE_RANGE_LOOKBACK);
  const baselineRange = Math.max(averageRange(recent, 14), 0.0001);
  const swings = findSwingHighsLows(recent);
  const highs = swings.filter((swing) => swing.type === 'high');
  const lows = swings.filter((swing) => swing.type === 'low');

  if (highs.length < 2 || lows.length < 2) {
    return null;
  }

  const recentHigh = Math.max(...highs.map((point) => point.price));
  const recentLow = Math.min(...lows.map((point) => point.price));
  const rangeHeight = recentHigh - recentLow;

  if (!Number.isFinite(rangeHeight) || rangeHeight < baselineRange * 8) {
    return null;
  }

  const touchTolerance = Math.max(rangeHeight * 0.16, baselineRange * 1.2);
  const upperTouches = highs.filter((point) => point.price >= recentHigh - touchTolerance);
  const lowerTouches = lows.filter((point) => point.price <= recentLow + touchTolerance);

  if (upperTouches.length < 2 || lowerTouches.length < 2) {
    return null;
  }

  const upperSpan = Math.max(...upperTouches.map((point) => point.index)) - Math.min(...upperTouches.map((point) => point.index));
  const lowerSpan = Math.max(...lowerTouches.map((point) => point.index)) - Math.min(...lowerTouches.map((point) => point.index));
  if (upperSpan < 6 || lowerSpan < 6) {
    return null;
  }

  const resistance = average(upperTouches.map((point) => point.price));
  const support = average(lowerTouches.map((point) => point.price));

  if (!Number.isFinite(resistance) || !Number.isFinite(support) || resistance <= support) {
    return null;
  }

  return {
    support,
    resistance,
    supportExtreme: Math.min(...lowerTouches.map((point) => point.price)),
    resistanceExtreme: Math.max(...upperTouches.map((point) => point.price)),
    supportTouches: lowerTouches.length,
    resistanceTouches: upperTouches.length,
    rangeHeight,
    baselineRange,
  };
}

/**
 * Detects a tight consolidation base (accumulation/distribution) at a range edge.
 * Returns true when several recent candles form a narrow cluster near support or
 * resistance and the latest candle breaks out of that cluster with displacement.
 */
function detectEdgeConsolidationBase(
  candles: Candle[],
  direction: 'buy' | 'sell',
  edgePrice: number,
  baselineRange: number,
): boolean {
  if (candles.length < 6) {
    return false;
  }

  // Look for a cluster in the last 3–12 candles (excluding the latest breakout candle)
  const latest = candles[candles.length - 1];
  const candidateWindow = candles.slice(-13, -1); // up to 12 candles before the latest
  if (candidateWindow.length < 3) {
    return false;
  }

  const avgBody = averageBody(candles, 20);
  const edgeTolerance = Math.max(baselineRange * 2.5, edgePrice * 0.004);

  // Try different base lengths (3–10 candles), pick the tightest cluster near the edge
  let bestBaseDetected = false;

  for (let baseLen = 3; baseLen <= Math.min(10, candidateWindow.length); baseLen++) {
    const baseCandles = candidateWindow.slice(-baseLen);
    const baseHigh = Math.max(...baseCandles.map((c) => c.high));
    const baseLow = Math.min(...baseCandles.map((c) => c.low));
    const baseHeight = baseHigh - baseLow;

    // The cluster must be tight relative to the average candle range
    if (baseHeight > baselineRange * 4) {
      continue;
    }

    // Bodies inside the cluster should be small (accumulation / indecision)
    const clusterAvgBody = average(baseCandles.map((c) => Math.abs(c.close - c.open)));
    if (clusterAvgBody > avgBody * 1.3) {
      continue;
    }

    // Cluster must be located near the edge
    const clusterMid = (baseHigh + baseLow) / 2;
    const distanceToEdge = Math.abs(clusterMid - edgePrice);
    if (distanceToEdge > edgeTolerance) {
      continue;
    }

    // Latest candle must break out of the cluster with displacement
    const latestBody = Math.abs(latest.close - latest.open);
    if (latestBody < avgBody * 0.8) {
      continue; // no real displacement
    }

    if (direction === 'buy') {
      // Breakout above the cluster top, close strong
      if (latest.close > baseHigh && latest.close > latest.open) {
        bestBaseDetected = true;
        break;
      }
    } else {
      // Breakout below the cluster bottom, close strong
      if (latest.close < baseLow && latest.close < latest.open) {
        bestBaseDetected = true;
        break;
      }
    }
  }

  return bestBaseDetected;
}

function isPriceNearRangeEdge(currentPrice: number, range: SupportResistanceRange | null): boolean {
  if (!range) {
    return false;
  }

  const edgeBuffer = Math.max(range.rangeHeight * 0.2, range.baselineRange * 1.35);
  return currentPrice >= range.resistance - edgeBuffer || currentPrice <= range.support + edgeBuffer;
}

function resolveMarketRegime(input: {
  trend: TrendDirection;
  broaderTrend: TrendDirection;
  currentPrice: number;
  range: SupportResistanceRange | null;
  bullishReversal: boolean;
  bearishReversal: boolean;
}): MarketRegime {
  if (input.bullishReversal || input.bearishReversal) {
    return 'reversal';
  }

  if (input.range && (input.trend === 'ranging' || input.broaderTrend === 'ranging' || isPriceNearRangeEdge(input.currentPrice, input.range))) {
    return 'range';
  }

  if (input.trend === 'bullish' || input.trend === 'bearish') {
    return 'trend';
  }

  return input.range ? 'range' : 'reversal';
}

function candidateMatchesRegime(candidate: PotentialTradeSetup, regime: MarketRegime): boolean {
  const strategy = candidate.strategy.toLowerCase();

  if (regime === 'range') {
    return strategy.includes('range');
  }

  if (regime === 'trend') {
    return !strategy.includes('range') && !strategy.includes('reversal') && !strategy.includes('countertrend');
  }

  return strategy.includes('reversal') || strategy.includes('countertrend');
}

function buildSupportResistanceTradeSetup(
  symbol: string,
  candles: Candle[],
  broaderTrend: TrendDirection,
  emaTrend: EmaTrendContext,
): TradeSetup | null {
  const range = detectSupportResistanceRange(candles);
  if (!range) {
    return null;
  }

  const currentPrice = candles[candles.length - 1].close;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const edgeBuffer = Math.max(range.rangeHeight * 0.18, range.baselineRange * 1.2);
  const bearishAtResistance = last.high >= range.resistance - edgeBuffer && currentPrice >= range.resistance - edgeBuffer;
  const bullishAtSupport = last.low <= range.support + edgeBuffer && currentPrice <= range.support + edgeBuffer;

  const sweep = detectLiquiditySweep(candles);
  const rejection = detectRejection(last);
  const engulfing = detectEngulfing(prev, last);
  const structure = detectStructureBreak(candles);
  const momentum = detectRecentMomentum(candles);

  if (!bearishAtResistance && !bullishAtSupport) {
    return null;
  }

  const direction: 'buy' | 'sell' = bearishAtResistance ? 'sell' : 'buy';
  const alignedSweep = isSweepAligned(direction, sweep);
  const alignedRejection = isRejectionAligned(direction, rejection);
  const alignedEngulfing = isEngulfingAligned(direction, engulfing);
  const alignedStructure = isStructureAligned(direction, structure);
  const alignedMomentum = (direction === 'buy' && momentum === 'bullish') || (direction === 'sell' && momentum === 'bearish');
  const zoneReaction = direction === 'sell'
    ? last.high >= range.resistance - edgeBuffer && last.close < range.resistance
    : last.low <= range.support + edgeBuffer && last.close > range.support;
  const freshDisplacement = hasFreshDisplacement(direction, candles);
  const emaAligned = isEmaDirectionAligned(direction, emaTrend);
  const edgePrice = direction === 'sell' ? range.resistance : range.support;
  const hasEdgeBase = detectEdgeConsolidationBase(candles, direction, edgePrice, range.baselineRange);

  const confirmationCount = [
    zoneReaction,
    alignedSweep,
    alignedRejection,
    alignedEngulfing,
    alignedStructure,
    alignedMomentum,
    freshDisplacement,
    hasEdgeBase,
  ].filter(Boolean).length;

  if (!zoneReaction) {
    return null;
  }

  // Classic entry: need rejection/engulfing/structure. Base-at-edge + displacement is an alternative.
  if (!alignedRejection && !alignedEngulfing && !alignedStructure && !(hasEdgeBase && freshDisplacement)) {
    return null;
  }

  if (confirmationCount < 3) {
    return null;
  }

  const buffer = Math.max(range.baselineRange * 0.65, range.rangeHeight * 0.08, currentPrice * 0.0006);
  const entry = currentPrice;
  const stopLoss = direction === 'sell'
    ? range.resistanceExtreme + buffer
    : range.supportExtreme - buffer;
  const takeProfit = direction === 'sell' ? range.support : range.resistance;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  if (!Number.isFinite(risk) || risk <= 0 || !Number.isFinite(reward) || reward < risk * 1.1) {
    return null;
  }

  const takeProfit2 = direction === 'sell'
    ? Math.min(takeProfit - risk, entry - risk * 3)
    : Math.max(takeProfit + risk, entry + risk * 3);

  const tradeConfirmations = buildTradeConfirmations({
    alignedSweep,
    alignedEngulfing,
    alignedRejection,
    alignedStructure,
    poiReclaim: false,
    emaAligned,
    zoneReaction,
    freshDisplacement,
    alignedMomentum,
    edgeBase: hasEdgeBase,
  });
  const confidenceScore = countTradeConfirmations(tradeConfirmations);

  const confirmationLabels = [
    direction === 'sell' ? 'Range resistance rejection' : 'Range support rejection',
    direction === 'sell' ? 'Price tapped resistance band' : 'Price tapped support band',
    direction === 'sell' ? 'Target mapped to range support' : 'Target mapped to range resistance',
    ...(hasEdgeBase ? [direction === 'sell' ? 'Consolidation base formed at resistance' : 'Consolidation base formed at support'] : []),
    ...(alignedRejection ? [direction === 'sell' ? 'Bearish rejection at resistance' : 'Bullish rejection at support'] : []),
    ...(alignedEngulfing ? [direction === 'sell' ? 'Bearish engulfing from resistance' : 'Bullish engulfing from support'] : []),
    ...(alignedStructure ? [direction === 'sell' ? 'Bearish neckline / structure break' : 'Bullish neckline / structure break'] : []),
    ...(alignedSweep ? [direction === 'sell' ? 'Buy-side liquidity sweep into resistance' : 'Sell-side liquidity sweep into support'] : []),
    ...(alignedMomentum ? [direction === 'sell' ? 'Bearish rotation confirmed' : 'Bullish rotation confirmed'] : []),
  ];

  const setup: TradeSetup = {
    symbol,
    direction,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    score: Math.min(9, 4 + confirmationCount),
    confidenceScore,
    marketRegime: 'range',
    strategy: direction === 'sell' ? 'Resistance Rejection Range Short' : 'Support Rejection Range Long',
    confirmations: tradeConfirmations,
    confirmationLabels,
  };

  const zoneCheck = zoneFilter(setup, candles);
  if (!zoneCheck.valid) {
    return null;
  }

  if (isVolatilitySymbol(symbol) && broaderTrend !== 'ranging' && !emaAligned && confidenceScore < 5) {
    return null;
  }

  return setup;
}

function buildSupportResistanceRangePotential(
  symbol: string,
  candles: Candle[],
  broaderTrend: TrendDirection,
  emaTrend: EmaTrendContext,
): PotentialTradeSetup | null {
  const range = detectSupportResistanceRange(candles);
  if (!range) {
    return null;
  }

  const currentPrice = candles[candles.length - 1].close;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const edgeBuffer = Math.max(range.rangeHeight * 0.24, range.baselineRange * 1.5);
  const distanceToResistance = Math.max(0, range.resistance - currentPrice);
  const distanceToSupport = Math.max(0, currentPrice - range.support);
  const nearResistance = currentPrice >= range.resistance - edgeBuffer || last.high >= range.resistance - edgeBuffer;
  const nearSupport = currentPrice <= range.support + edgeBuffer || last.low <= range.support + edgeBuffer;

  if (!nearResistance && !nearSupport) {
    return null;
  }

  const direction: 'buy' | 'sell' = nearResistance && !nearSupport
    ? 'sell'
    : nearSupport && !nearResistance
      ? 'buy'
      : distanceToResistance <= distanceToSupport
        ? 'sell'
        : 'buy';

  const sweep = detectLiquiditySweep(candles);
  const rejection = detectRejection(last);
  const engulfing = detectEngulfing(prev, last);
  const structure = detectStructureBreak(candles);
  const momentum = detectRecentMomentum(candles);
  const alignedSweep = isSweepAligned(direction, sweep);
  const alignedRejection = isRejectionAligned(direction, rejection);
  const alignedEngulfing = isEngulfingAligned(direction, engulfing);
  const alignedStructure = isStructureAligned(direction, structure);
  const alignedMomentum = (direction === 'buy' && momentum === 'bullish') || (direction === 'sell' && momentum === 'bearish');
  const zoneReaction = direction === 'sell'
    ? last.high >= range.resistance - edgeBuffer && last.close < range.resistance
    : last.low <= range.support + edgeBuffer && last.close > range.support;
  const freshDisplacement = hasFreshDisplacement(direction, candles);
  const emaAligned = isEmaDirectionAligned(direction, emaTrend);
  const edgePrice = direction === 'sell' ? range.resistance : range.support;
  const hasEdgeBase = detectEdgeConsolidationBase(candles, direction, edgePrice, range.baselineRange);
  const tradeConfirmations = buildTradeConfirmations({
    alignedSweep,
    alignedEngulfing,
    alignedRejection,
    alignedStructure,
    poiReclaim: false,
    emaAligned,
    zoneReaction,
    freshDisplacement,
    alignedMomentum,
    edgeBase: hasEdgeBase,
  });
  const confidenceScore = countTradeConfirmations(tradeConfirmations);
  const boundaryTouches = direction === 'sell' ? range.resistanceTouches : range.supportTouches;
  const hasStrongBoundary = boundaryTouches >= 3;
  const hasRejectionConfirmation = zoneReaction && (alignedRejection || alignedEngulfing || alignedStructure);
  const boundaryLabel = direction === 'sell' ? 'range resistance' : 'range support';
  const oppositeBoundaryLabel = direction === 'sell' ? 'range support' : 'range resistance';
  const entry = currentPrice;
  const buffer = Math.max(range.baselineRange * 0.65, range.rangeHeight * 0.08, currentPrice * 0.0006);
  const stopLoss = direction === 'sell'
    ? range.resistanceExtreme + buffer
    : range.supportExtreme - buffer;
  const takeProfit = direction === 'sell' ? range.support : range.resistance;
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfit - entry);

  if (!Number.isFinite(risk) || risk <= 0 || !Number.isFinite(reward) || reward < risk) {
    return null;
  }

  if (!hasStrongBoundary || !hasRejectionConfirmation) {
    return null;
  }

  const takeProfit2 = direction === 'sell'
    ? Math.min(takeProfit - risk, entry - risk * 3)
    : Math.max(takeProfit + risk, entry + risk * 3);

  let activationProbability = 34;
  activationProbability += boundaryTouches >= 3 ? 14 : 8;
  activationProbability += zoneReaction ? 16 : 6;
  activationProbability += alignedRejection ? 12 : 0;
  activationProbability += alignedEngulfing ? 12 : 0;
  activationProbability += alignedStructure ? 10 : 0;
  activationProbability += alignedSweep ? 8 : 0;
  activationProbability += freshDisplacement ? 8 : 0;
  activationProbability += alignedMomentum ? 6 : 0;
  activationProbability += emaAligned ? 4 : 0;
  activationProbability += hasEdgeBase ? 14 : 0;
  activationProbability += reward >= risk * 1.5 ? 6 : 0;
  activationProbability -= broaderTrend === 'ranging' ? 0 : emaAligned ? 0 : 6;

  const fulfilledConditions: string[] = [
    direction === 'sell' ? 'Price is testing a repeated resistance boundary' : 'Price is testing a repeated support boundary',
    `Range boundaries are established with ${boundaryTouches} touches on the ${boundaryLabel}`,
    direction === 'sell' ? 'Target maps toward the opposite support boundary' : 'Target maps toward the opposite resistance boundary',
  ];
  const requiredTriggers: string[] = [];
  const contextLabels: string[] = [
    'Support/resistance range structure',
    direction === 'sell' ? 'Upper boundary rotation watch' : 'Lower boundary rotation watch',
  ];

  if (zoneReaction) {
    fulfilledConditions.push(direction === 'sell' ? 'Price is reacting away from resistance' : 'Price is reacting away from support');
  } else {
    requiredTriggers.push(direction === 'sell' ? 'Clean bearish rejection from range resistance' : 'Clean bullish rejection from range support');
  }

  if (alignedRejection) {
    fulfilledConditions.push(direction === 'sell' ? 'Bearish rejection wick printed at resistance' : 'Bullish rejection wick printed at support');
  } else {
    requiredTriggers.push(direction === 'sell' ? 'Bearish rejection wick at the upper boundary' : 'Bullish rejection wick at the lower boundary');
  }

  if (alignedEngulfing) {
    fulfilledConditions.push(direction === 'sell' ? 'Bearish engulfing confirmed at resistance' : 'Bullish engulfing confirmed at support');
  } else {
    requiredTriggers.push(direction === 'sell' ? 'Bearish engulfing candle from resistance' : 'Bullish engulfing candle from support');
  }

  if (alignedStructure) {
    fulfilledConditions.push(direction === 'sell' ? 'Bearish neckline / structure break confirmed' : 'Bullish neckline / structure break confirmed');
  } else {
    requiredTriggers.push(direction === 'sell' ? 'Bearish structure break away from resistance' : 'Bullish structure break away from support');
  }

  if (alignedSweep) {
    fulfilledConditions.push(direction === 'sell' ? 'Liquidity sweep into resistance completed' : 'Liquidity sweep into support completed');
  }

  if (hasEdgeBase) {
    fulfilledConditions.push(direction === 'sell' ? 'Consolidation base formed at resistance before breakdown' : 'Consolidation base formed at support before breakout');
    contextLabels.push('Edge base accumulation');
  } else {
    requiredTriggers.push(direction === 'sell' ? 'Tight consolidation base at resistance before breakdown' : 'Tight consolidation base at support before breakout');
  }

  if (freshDisplacement) {
    fulfilledConditions.push(direction === 'sell' ? 'Bearish displacement away from resistance is underway' : 'Bullish displacement away from support is underway');
  } else {
    requiredTriggers.push(direction === 'sell' ? 'Stronger bearish displacement away from the upper boundary' : 'Stronger bullish displacement away from the lower boundary');
  }

  if (alignedMomentum) {
    fulfilledConditions.push(direction === 'sell' ? 'Bearish rotation momentum is forming' : 'Bullish rotation momentum is forming');
  }

  if (emaTrend.trend !== 'ranging') {
    if (emaAligned) {
      fulfilledConditions.push(direction === 'sell' ? 'EMA flow supports the short rotation' : 'EMA flow supports the long rotation');
    } else {
      requiredTriggers.push(direction === 'sell' ? 'EMA flow rolls back bearish or range holds cleanly' : 'EMA flow rolls back bullish or range holds cleanly');
    }
  }

  const strategy = direction === 'sell'
    ? 'Resistance Rejection Range Short Watchlist'
    : 'Support Rejection Range Long Watchlist';
  const narrative = direction === 'sell'
    ? `Scanner is tracking a resistance-to-support range sell on ${symbol}. Price is near the upper boundary and the setup improves if bearish rejection confirms and rotates price back toward ${oppositeBoundaryLabel}.`
    : `Scanner is tracking a support-to-resistance range buy on ${symbol}. Price is near the lower boundary and the setup improves if bullish rejection confirms and rotates price back toward ${oppositeBoundaryLabel}.`;

  return {
    symbol,
    direction,
    currentPrice,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    activationProbability: Math.min(95, activationProbability),
    confidenceScore,
    marketRegime: 'range',
    confirmations: tradeConfirmations,
    strategy,
    narrative,
    fulfilledConditions,
    requiredTriggers,
    contextLabels,
  };
}

// ── Breaker Block Detection ──
// A breaker block is an order block (supply/demand zone) that was
// broken through by price, flipping its polarity. Supply becomes
// demand (bullish breaker) and demand becomes supply (bearish breaker).
// The trade is on the retest of the flipped zone from the new side.

export interface BreakerBlock {
  /** The trade direction this breaker supports */
  direction: 'buy' | 'sell';
  top: number;
  bottom: number;
  /** Index where the original zone was formed */
  originIndex: number;
  /** Index where the zone was broken through */
  breakIndex: number;
}

function detectBreakerBlocks(candles: Candle[], currentPrice: number): BreakerBlock[] {
  if (candles.length < 20) {
    return [];
  }

  const lookback = candles.slice(-Math.min(200, candles.length));
  const zones = buildZones(lookback, currentPrice);
  const breakers: BreakerBlock[] = [];
  const minAge = 5; // zone must be at least 5 candles old before it can be "broken"

  for (const zone of zones) {
    if (zone.originIndex == null || zone.originIndex < 0) {
      continue;
    }

    const originAge = lookback.length - 1 - zone.originIndex;
    if (originAge < minAge) {
      continue;
    }

    // Check if a candle after the zone's origin closed cleanly through it
    let breakIndex = -1;

    for (let i = zone.originIndex + minAge; i < lookback.length; i++) {
      const candle = lookback[i];

      if (zone.type === 'supply') {
        // Supply broken: a candle closed above the zone top
        if (candle.close > zone.top) {
          breakIndex = i;
          break;
        }
      } else {
        // Demand broken: a candle closed below the zone bottom
        if (candle.close < zone.bottom) {
          breakIndex = i;
          break;
        }
      }
    }

    if (breakIndex < 0) {
      continue; // zone was never broken
    }

    // The break must have happened before the latest candle — we need room for a retest
    if (breakIndex >= lookback.length - 1) {
      continue;
    }

    // Flip polarity: broken supply → bullish breaker, broken demand → bearish breaker
    const breakerDirection: 'buy' | 'sell' = zone.type === 'supply' ? 'buy' : 'sell';

    breakers.push({
      direction: breakerDirection,
      top: zone.top,
      bottom: zone.bottom,
      originIndex: zone.originIndex,
      breakIndex,
    });
  }

  return breakers;
}

function findActiveBreakerBlock(
  direction: 'buy' | 'sell',
  currentPrice: number,
  candles: Candle[],
): BreakerBlock | null {
  const breakers = detectBreakerBlocks(candles, currentPrice);
  const baselineRange = Math.max(averageRange(candles, 12), currentPrice * 0.0004);

  const matching = breakers
    .filter((b) => b.direction === direction)
    .filter((b) => {
      // Price must be near or inside the breaker zone (retesting it)
      const touchBuffer = Math.max(Math.abs(b.top - b.bottom) * 0.25, baselineRange * 0.5);

      if (direction === 'buy') {
        // Bullish breaker: ex-supply now demand. Price should be near/above the zone bottom
        return currentPrice >= b.bottom - touchBuffer && currentPrice <= b.top + touchBuffer;
      }

      // Bearish breaker: ex-demand now supply. Price should be near/below the zone top
      return currentPrice >= b.bottom - touchBuffer && currentPrice <= b.top + touchBuffer;
    })
    .sort((a, b) => {
      // Prefer the most recently broken zone
      return b.breakIndex - a.breakIndex;
    });

  return matching[0] ?? null;
}

// ── Equal Highs / Equal Lows Liquidity Detection ──
// Identifies 2+ swing highs or swing lows resting at the same price
// level. These are engineered liquidity pools (resting stop orders).
// A sweep through EQH/EQL followed by a reversal is a high-probability
// signal — distinctly stronger than a generic wick sweep.

interface EqualLevel {
  type: 'equal_highs' | 'equal_lows';
  price: number;
  touches: number;
  indices: number[];
}

function detectEqualLevels(candles: Candle[]): EqualLevel[] {
  if (candles.length < 30) return [];

  const lookback = candles.slice(-Math.min(200, candles.length));
  const swings = findSwingHighsLows(lookback);
  const levels: EqualLevel[] = [];

  const highs = swings.filter((s) => s.type === 'high').sort((a, b) => a.index - b.index);
  const lows = swings.filter((s) => s.type === 'low').sort((a, b) => a.index - b.index);

  // Group swing highs that rest at approximately the same price
  const tolerance = averageRange(lookback, 14) * 0.35;
  const usedHighIdx = new Set<number>();

  for (let i = 0; i < highs.length; i++) {
    if (usedHighIdx.has(i)) continue;
    const cluster: SwingPoint[] = [highs[i]];
    usedHighIdx.add(i);

    for (let j = i + 1; j < highs.length; j++) {
      if (usedHighIdx.has(j)) continue;
      if (Math.abs(highs[j].price - highs[i].price) <= tolerance) {
        cluster.push(highs[j]);
        usedHighIdx.add(j);
      }
    }

    if (cluster.length >= 2) {
      levels.push({
        type: 'equal_highs',
        price: average(cluster.map((s) => s.price)),
        touches: cluster.length,
        indices: cluster.map((s) => s.index),
      });
    }
  }

  const usedLowIdx = new Set<number>();

  for (let i = 0; i < lows.length; i++) {
    if (usedLowIdx.has(i)) continue;
    const cluster: SwingPoint[] = [lows[i]];
    usedLowIdx.add(i);

    for (let j = i + 1; j < lows.length; j++) {
      if (usedLowIdx.has(j)) continue;
      if (Math.abs(lows[j].price - lows[i].price) <= tolerance) {
        cluster.push(lows[j]);
        usedLowIdx.add(j);
      }
    }

    if (cluster.length >= 2) {
      levels.push({
        type: 'equal_lows',
        price: average(cluster.map((s) => s.price)),
        touches: cluster.length,
        indices: cluster.map((s) => s.index),
      });
    }
  }

  return levels;
}

function detectEqualLevelSweep(
  direction: 'buy' | 'sell',
  candles: Candle[],
): EqualLevel | null {
  if (candles.length < 30) return null;

  const last = candles[candles.length - 1];
  const levels = detectEqualLevels(candles);

  for (const level of levels) {
    if (direction === 'buy' && level.type === 'equal_lows') {
      // Bullish: price swept below equal lows then closed back above
      if (last.low < level.price && last.close > level.price) {
        return level;
      }
    }

    if (direction === 'sell' && level.type === 'equal_highs') {
      // Bearish: price swept above equal highs then closed back below
      if (last.high > level.price && last.close < level.price) {
        return level;
      }
    }
  }

  return null;
}

// ── Premium / Discount Zone Filter ──
// ICT premium/discount model: the current swing range is divided at 50%.
// Buys should enter in discount (below 50%), sells in premium (above 50%).
// Returns a multiplier: >0 means correct zone, <0 means wrong zone.

function getPremiumDiscountBias(
  direction: 'buy' | 'sell',
  currentPrice: number,
  candles: Candle[],
): number {
  if (candles.length < 20) return 0;

  const lookback = candles.slice(-Math.min(60, candles.length));
  const swingHigh = Math.max(...lookback.map((c) => c.high));
  const swingLow = Math.min(...lookback.map((c) => c.low));
  const swingRange = swingHigh - swingLow;

  if (swingRange <= 0) return 0;

  const midpoint = swingLow + swingRange * 0.5;

  if (direction === 'buy') {
    // Buying in discount (below mid) = good (+boost), buying in premium = bad (-penalty)
    if (currentPrice <= midpoint) return 10;
    return -8;
  }

  // Selling in premium (above mid) = good (+boost), selling in discount = bad (-penalty)
  if (currentPrice >= midpoint) return 10;
  return -8;
}

// ── Optimal Trade Entry (OTE) Detection ──
// The 62%–79% Fibonacci retracement of a recent displacement leg,
// ideally overlapping with an FVG or demand/supply zone at that level.
// OTE + FVG overlap is one of the highest-conviction ICT entries.

interface OteResult {
  inOteZone: boolean;
  hasFvgOverlap: boolean;
  hasZoneOverlap: boolean;
  oteTop: number;
  oteBottom: number;
}

function detectOptimalTradeEntry(
  direction: 'buy' | 'sell',
  currentPrice: number,
  candles: Candle[],
  gaps: FairValueGap[],
  zones: PriceZone[],
): OteResult | null {
  if (candles.length < 20) return null;

  // Find the most recent displacement leg (strong impulsive move)
  const lookback = candles.slice(-Math.min(40, candles.length));
  let legHigh = -Infinity;
  let legLow = Infinity;
  let legHighIdx = -1;
  let legLowIdx = -1;

  for (let i = 0; i < lookback.length; i++) {
    if (lookback[i].high > legHigh) { legHigh = lookback[i].high; legHighIdx = i; }
    if (lookback[i].low < legLow) { legLow = lookback[i].low; legLowIdx = i; }
  }

  const legRange = legHigh - legLow;
  if (legRange <= 0) return null;

  let oteTop: number;
  let oteBottom: number;

  if (direction === 'buy') {
    // Bullish OTE: recent impulse should be up (low before high), retracement is the pullback
    if (legLowIdx >= legHighIdx) return null; // leg must go low→high
    // 62%-79% retracement from the high (measured from top down)
    oteTop = legHigh - legRange * 0.62;
    oteBottom = legHigh - legRange * 0.79;
  } else {
    // Bearish OTE: recent impulse should be down (high before low), retracement is the rally
    if (legHighIdx >= legLowIdx) return null; // leg must go high→low
    // 62%-79% retracement from the low (measured from bottom up)
    oteBottom = legLow + legRange * 0.62;
    oteTop = legLow + legRange * 0.79;
  }

  const inOteZone = currentPrice >= oteBottom && currentPrice <= oteTop;
  if (!inOteZone) return null;

  // Check if any FVG overlaps the OTE zone
  const hasFvgOverlap = gaps.some((gap) => {
    if (direction === 'buy' && gap.type !== 'bullish') return false;
    if (direction === 'sell' && gap.type !== 'bearish') return false;
    return gap.bottom <= oteTop && gap.top >= oteBottom;
  });

  // Check if any zone overlaps the OTE zone
  const hasZoneOverlap = zones.some((zone) => {
    if (direction === 'buy' && zone.type !== 'demand') return false;
    if (direction === 'sell' && zone.type !== 'supply') return false;
    return zone.bottom <= oteTop && zone.top >= oteBottom;
  });

  return { inOteZone, hasFvgOverlap, hasZoneOverlap, oteTop, oteBottom };
}

// ── Market Structure Shift (MSS) Detection ──
// A true MSS is when a significant swing high or swing low
// (identified by findSwingHighsLows) gets broken by a candle close.
// This is structurally more significant than a micro BOS which only
// checks if the latest candle closed beyond the previous candle's range.

function detectMarketStructureShift(
  candles: Candle[],
): { direction: 'bullish' | 'bearish'; brokenSwing: SwingPoint } | null {
  if (candles.length < 20) return null;

  const lookback = candles.slice(-Math.min(60, candles.length));
  const swings = findSwingHighsLows(lookback);
  const last = lookback[lookback.length - 1];

  // Check most recent swing highs/lows (from newest to oldest) for a break
  const recentSwingHighs = swings
    .filter((s) => s.type === 'high' && s.index < lookback.length - 2)
    .sort((a, b) => b.index - a.index);

  const recentSwingLows = swings
    .filter((s) => s.type === 'low' && s.index < lookback.length - 2)
    .sort((a, b) => b.index - a.index);

  // Bullish MSS: price closes above a recent swing high
  for (const swingHigh of recentSwingHighs.slice(0, 3)) {
    if (last.close > swingHigh.price && last.open <= swingHigh.price) {
      return { direction: 'bullish', brokenSwing: swingHigh };
    }
  }

  // Bearish MSS: price closes below a recent swing low
  for (const swingLow of recentSwingLows.slice(0, 3)) {
    if (last.close < swingLow.price && last.open >= swingLow.price) {
      return { direction: 'bearish', brokenSwing: swingLow };
    }
  }

  return null;
}

function isMssAligned(direction: 'buy' | 'sell', mss: ReturnType<typeof detectMarketStructureShift>): boolean {
  if (!mss) return false;
  return (direction === 'buy' && mss.direction === 'bullish') || (direction === 'sell' && mss.direction === 'bearish');
}

// ── FVG Reaction Trade Detection ──
// Detects when price fills (retraces into) an unfilled FVG,
// shows a reaction candle inside the gap, and has displacement out.
// This is a standalone strategy family, not just a supporting area.

interface FvgReaction {
  gap: FairValueGap;
  hasReactionCandle: boolean;
  hasDisplacementOut: boolean;
}

function detectFvgReaction(
  direction: 'buy' | 'sell',
  candles: Candle[],
  gaps: FairValueGap[],
): FvgReaction | null {
  if (candles.length < 10 || gaps.length === 0) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const avgBody = average(candles.slice(-14).map((c) => Math.abs(c.close - c.open)));

  // Find an FVG that price retested (previous candle entered the gap)
  for (const gap of gaps) {
    if (direction === 'buy' && gap.type !== 'bullish') continue;
    if (direction === 'sell' && gap.type !== 'bearish') continue;

    // Previous candle must have entered the gap (retracement into FVG)
    const prevEnteredGap = direction === 'buy'
      ? prev.low <= gap.top && prev.low >= gap.bottom
      : prev.high >= gap.bottom && prev.high <= gap.top;

    if (!prevEnteredGap) continue;

    // Reaction candle: current candle shows rejection/engulfing from the gap
    const body = Math.abs(last.close - last.open);
    const range = Math.max(last.high - last.low, 0.0001);

    const hasReactionCandle = direction === 'buy'
      ? last.close > last.open && body > avgBody * 0.8 && (last.close - last.low) > range * 0.6
      : last.close < last.open && body > avgBody * 0.8 && (last.high - last.close) > range * 0.6;

    // Displacement out: current candle body extends beyond the FVG
    const hasDisplacementOut = direction === 'buy'
      ? last.close > gap.top
      : last.close < gap.bottom;

    if (hasReactionCandle) {
      return { gap, hasReactionCandle, hasDisplacementOut };
    }
  }

  return null;
}

// ── 8. Look-left supply/demand detection ──

export function findSwingHighsLows(candles: Candle[]): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let index = 2; index < candles.length - 2; index++) {
    const current = candles[index];

    if (
      current.high > candles[index - 1].high &&
      current.high > candles[index - 2].high &&
      current.high > candles[index + 1].high &&
      current.high > candles[index + 2].high
    ) {
      swings.push({ type: 'high', price: current.high, index });
    }

    if (
      current.low < candles[index - 1].low &&
      current.low < candles[index - 2].low &&
      current.low < candles[index + 1].low &&
      current.low < candles[index + 2].low
    ) {
      swings.push({ type: 'low', price: current.low, index });
    }
  }

  return swings;
}

export function buildZones(candles: Candle[], currentPrice: number): PriceZone[] {
  const swings = findSwingHighsLows(candles);
  const zones: PriceZone[] = [];
  const countZoneTouches = (top: number, bottom: number) => {
    const area = { top: Math.max(top, bottom), bottom: Math.min(top, bottom) };
    return candles.filter((candle) => candleTouchesArea(candle, area)).length;
  };

  for (const swing of swings) {
    const baseCandle = candles[swing.index];

    if (swing.type === 'high') {
      const top = Math.max(baseCandle.high, baseCandle.open, baseCandle.close);
      const bottom = Math.min(baseCandle.open, baseCandle.close);
      zones.push({
        type: 'supply',
        top,
        bottom,
        distanceToPrice: Math.min(Math.abs(currentPrice - top), Math.abs(currentPrice - bottom)),
        originIndex: swing.index,
        touches: countZoneTouches(top, bottom),
      });
    }

    if (swing.type === 'low') {
      const top = Math.max(baseCandle.open, baseCandle.close);
      const bottom = Math.min(baseCandle.low, baseCandle.open, baseCandle.close);
      zones.push({
        type: 'demand',
        top,
        bottom,
        distanceToPrice: Math.min(Math.abs(currentPrice - top), Math.abs(currentPrice - bottom)),
        originIndex: swing.index,
        touches: countZoneTouches(top, bottom),
      });
    }
  }

  return zones.sort((left, right) => left.distanceToPrice - right.distanceToPrice);
}

export function buildFairValueGaps(candles: Candle[], currentPrice: number): FairValueGap[] {
  const gaps: FairValueGap[] = [];

  for (let index = 2; index < candles.length; index++) {
    const left = candles[index - 2];
    const right = candles[index];

    if (right.low > left.high) {
      gaps.push({
        type: 'bullish',
        top: right.low,
        bottom: left.high,
        distanceToPrice: Math.min(Math.abs(currentPrice - right.low), Math.abs(currentPrice - left.high)),
        originIndex: index,
      });
    }

    if (right.high < left.low) {
      gaps.push({
        type: 'bearish',
        top: left.low,
        bottom: right.high,
        distanceToPrice: Math.min(Math.abs(currentPrice - left.low), Math.abs(currentPrice - right.high)),
        originIndex: index,
      });
    }
  }

  return gaps.sort((left, right) => left.distanceToPrice - right.distanceToPrice);
}

function findDirectionalZone(
  direction: 'buy' | 'sell',
  zones: PriceZone[],
  currentPrice: number,
  candles?: Candle[],
  symbol?: string,
): PriceZone | null {
  const matchingZones = zones.filter((zone) => {
    if (direction === 'buy') {
      return zone.type === 'demand' && zone.top <= currentPrice * 1.01;
    }

    return zone.type === 'supply' && zone.bottom >= currentPrice * 0.99;
  });

  const preferredZones = candles && symbol
    ? matchingZones.filter((zone) => isMeaningfulZone(symbol, zone, candles, currentPrice))
    : matchingZones;
  const zonePool = preferredZones.length > 0
    ? preferredZones
    : symbol && isVolatilitySymbol(symbol)
      ? []
      : matchingZones;

  return zonePool.sort((left, right) => {
    const rightAge = candles ? getOriginAge(candles.length, right.originIndex) : 0;
    const leftAge = candles ? getOriginAge(candles.length, left.originIndex) : 0;
    if (rightAge !== leftAge) {
      return rightAge - leftAge;
    }

    const rightHeight = Math.abs(right.top - right.bottom);
    const leftHeight = Math.abs(left.top - left.bottom);
    if (rightHeight !== leftHeight) {
      return rightHeight - leftHeight;
    }

    return left.distanceToPrice - right.distanceToPrice;
  })[0] ?? null;
}

function findDirectionalFvg(
  direction: 'buy' | 'sell',
  gaps: FairValueGap[],
  candles?: Candle[],
  symbol?: string,
): FairValueGap | null {
  const matchingGaps = gaps.filter((gap) => (direction === 'buy' ? gap.type === 'bullish' : gap.type === 'bearish'));
  const preferredGaps = candles && symbol
    ? matchingGaps.filter((gap) => isMeaningfulGap(symbol, gap, candles, candles[candles.length - 1]?.close ?? 0))
    : matchingGaps;
  const gapPool = preferredGaps.length > 0
    ? preferredGaps
    : symbol && isVolatilitySymbol(symbol)
      ? []
      : matchingGaps;

  return gapPool.sort((left, right) => {
    const rightAge = candles ? getOriginAge(candles.length, right.originIndex) : 0;
    const leftAge = candles ? getOriginAge(candles.length, left.originIndex) : 0;
    if (rightAge !== leftAge) {
      return rightAge - leftAge;
    }

    const rightHeight = Math.abs(right.top - right.bottom);
    const leftHeight = Math.abs(left.top - left.bottom);
    if (rightHeight !== leftHeight) {
      return rightHeight - leftHeight;
    }

    return left.distanceToPrice - right.distanceToPrice;
  })[0] ?? null;
}

function buildPotentialNarrative(direction: 'buy' | 'sell', currentPrice: number, contextLabels: string[], requiredTriggers: string[]) {
  const side = direction === 'buy' ? 'bullish' : 'bearish';
  const triggerText = requiredTriggers.length > 0 ? requiredTriggers.join(', ') : 'confirmation alignment';
  const contextText = contextLabels.length > 0 ? contextLabels.join(', ') : 'trend context';

  return `Market is showing ${side} potential around ${currentPrice.toFixed(currentPrice >= 100 ? 2 : 5)}. Current context: ${contextText}. The scanner is waiting for ${triggerText} before activating the trade.`;
}

function buildCounterTrendNarrative(
  trend: TrendDirection,
  direction: 'buy' | 'sell',
  currentPrice: number,
  contextLabels: string[],
  requiredTriggers: string[],
) {
  const side = direction === 'buy' ? 'buy' : 'sell';
  const trendText = trend === 'ranging' ? 'range' : `${trend} backdrop`;
  const triggerText = requiredTriggers.length > 0 ? requiredTriggers.join(', ') : 'a rejection and structure shift';
  const contextText = contextLabels.length > 0 ? contextLabels.join(', ') : 'opposing zone context';

  return `Scanner is tracking a one-tap style counter-trend ${side} idea around ${currentPrice.toFixed(currentPrice >= 100 ? 2 : 5)}. Context: ${contextText} against a ${trendText}. It will wait for ${triggerText} at the zone before treating the counter move as tradable.`;
}

function matchesZoneDirection(direction: 'buy' | 'sell', zone: PriceZone | null): boolean {
  if (!zone) {
    return false;
  }

  return (direction === 'buy' && zone.type === 'demand') || (direction === 'sell' && zone.type === 'supply');
}

function getOppositeDirection(direction: 'buy' | 'sell'): 'buy' | 'sell' {
  return direction === 'buy' ? 'sell' : 'buy';
}

function toTradeDirection(trend: TrendDirection): 'buy' | 'sell' | null {
  if (trend === 'bullish') return 'buy';
  if (trend === 'bearish') return 'sell';
  return null;
}

// ── Ideal structural entry for potential trades ──
// Instead of using the live current price (which moves every tick),
// lock the entry to the nearest structural level:
//   Priority 1: OTE zone midpoint (62–79% fib) — highest-conviction retracement
//   Priority 2: FVG midpoint (if an active FVG reaction was detected)
//   Priority 3: Breaker block zone edge (retest level of the flipped zone)
//   Priority 4: Directional zone edge (demand top for buys, supply bottom for sells)
//   Priority 5: Directional FVG edge
//   Fallback: current price (only when no structural level exists)

function computeIdealPotentialEntry(
  direction: 'buy' | 'sell',
  currentPrice: number,
  candles: Candle[],
  areas: {
    directionalZone: PriceZone | null;
    directionalFvg: FairValueGap | null;
    activeBreaker: BreakerBlock | null;
    ote: OteResult | null;
    fvgReaction: FvgReaction | null;
  },
): number {
  const candidates: number[] = [];

  // OTE zone midpoint — the golden pocket
  if (areas.ote && areas.ote.inOteZone) {
    candidates.push((areas.ote.oteTop + areas.ote.oteBottom) / 2);
  }

  // FVG that price is reacting from — use the gap edge
  if (areas.fvgReaction) {
    const gap = areas.fvgReaction.gap;
    candidates.push(direction === 'buy' ? gap.bottom : gap.top);
  }

  // Breaker block zone — retest level
  if (areas.activeBreaker) {
    candidates.push(direction === 'buy' ? areas.activeBreaker.bottom : areas.activeBreaker.top);
  }

  // Directional zone — demand top (buy) or supply bottom (sell)
  if (areas.directionalZone) {
    candidates.push(direction === 'buy' ? areas.directionalZone.top : areas.directionalZone.bottom);
  }

  // Directional FVG edge
  if (areas.directionalFvg) {
    candidates.push(direction === 'buy' ? areas.directionalFvg.bottom : areas.directionalFvg.top);
  }

  if (candidates.length === 0) {
    return currentPrice;
  }

  // Pick the candidate closest to current price — this is the most
  // immediately-relevant structural level.
  candidates.sort((a, b) => Math.abs(a - currentPrice) - Math.abs(b - currentPrice));

  const best = candidates[0];

  // Sanity: the ideal entry must be on the correct side of the trade
  // (below current price for buys = discount entry, above for sells = premium entry).
  // If the best structural level is wrong-side, fall back to current price.
  if (direction === 'buy' && best > currentPrice * 1.005) return currentPrice;
  if (direction === 'sell' && best < currentPrice * 0.995) return currentPrice;

  return best;
}

interface PotentialCandidateInput {
  symbol: string;
  candles: Candle[];
  trend: TrendDirection;
  broaderTrend: TrendDirection;
  macroTrend: TrendDirection;
  emaTrend: EmaTrendContext;
  currentPrice: number;
  zones: PriceZone[];
  gaps: FairValueGap[];
  currentZone: PriceZone | null;
  direction: 'buy' | 'sell';
  mode: PotentialSetupMode;
  bullishReversal: boolean;
  bearishReversal: boolean;
  bullishPoiReclaim: boolean;
  bearishPoiReclaim: boolean;
}

function buildPotentialCandidate({
  symbol,
  candles,
  trend,
  broaderTrend,
  macroTrend,
  emaTrend,
  currentPrice,
  zones,
  gaps,
  currentZone,
  direction,
  mode,
  bullishReversal,
  bearishReversal,
  bullishPoiReclaim,
  bearishPoiReclaim,
}: PotentialCandidateInput): PotentialTradeSetup | null {
  const directionalZone = findDirectionalZone(direction, zones, currentPrice, candles, symbol);
  const directionalFvg = findDirectionalFvg(direction, gaps, candles, symbol);
  const preferredArea = toPriceArea(directionalZone ?? directionalFvg);
  const pullback = detectPullback(trend, candles);
  const sweep = detectLiquiditySweep(candles);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const engulfing = detectEngulfing(prev, last);
  const rejection = detectRejection(last);
  const structure = detectStructureBreak(candles);
  const recentMomentum = detectRecentMomentum(candles);
  const alignedSweep = isSweepAligned(direction, sweep);
  const alignedRejection = isRejectionAligned(direction, rejection);
  const alignedEngulfing = isEngulfingAligned(direction, engulfing);
  const alignedStructure = isStructureAligned(direction, structure);
  const alignedMomentum = (direction === 'buy' && recentMomentum === 'bullish') || (direction === 'sell' && recentMomentum === 'bearish');
  const freshReaction = isDirectionalReactionFromArea(direction, preferredArea, candles);
  const poiReclaim = direction === 'buy' ? bullishPoiReclaim : bearishPoiReclaim;
  const freshDisplacement = hasFreshDisplacement(direction, candles);
  const stretchedFromArea = isExtendedFromArea(direction, currentPrice, preferredArea, candles);
  const nearDirectionalZone = directionalZone ? isNearZone(currentPrice, [directionalZone], 0.0025) !== null : false;
  const isReversalSetup = direction === 'buy' ? bullishReversal : bearishReversal;
  // EMA 50 execution context
  const ema50Exec = analyzeEma50Execution(candles, emaTrend, directionalZone, directionalFvg);
  const emaStackAligned = direction === 'buy' ? ema50Exec.ema50Above200 : !ema50Exec.ema50Above200;
  const emaAligned = emaStackAligned;
  const volatilitySymbol = isVolatilitySymbol(symbol);
  const broaderTrendDirection = toTradeDirection(broaderTrend);
  const trendDirection = toTradeDirection(trend);
  const macroTrendDirection = toTradeDirection(macroTrend);
  const activeBreaker = findActiveBreakerBlock(direction, currentPrice, candles);
  const hasBreaker = activeBreaker !== null;
  const fvgReaction = detectFvgReaction(direction, candles, gaps);
  const hasFvgReaction = fvgReaction !== null && fvgReaction.hasReactionCandle;
  const eqlSweep = detectEqualLevelSweep(direction, candles);
  const hasEqlSweep = eqlSweep !== null;
  const premiumDiscountBias = getPremiumDiscountBias(direction, currentPrice, candles);
  const ote = detectOptimalTradeEntry(direction, currentPrice, candles, gaps, zones);
  const hasOte = ote !== null && ote.inOteZone;
  const mss = detectMarketStructureShift(candles);
  const hasMss = isMssAligned(direction, mss);
  const hasBos = alignedStructure || hasMss;
  const hasLiquiditySweep = alignedSweep || hasEqlSweep;
  const hasStrongZone = directionalZone ? isMeaningfulZone(symbol, directionalZone, candles, currentPrice) : false;
  const hasContinuationAreaReaction = nearDirectionalZone || freshReaction || poiReclaim || hasBreaker || hasFvgReaction;
  const macroCounterTrend = macroTrendDirection !== null && macroTrendDirection !== direction;
  const broaderCounterTrend = broaderTrendDirection !== null && broaderTrendDirection !== direction;
  const strictReversalConfirmationNeeded = isReversalSetup && (macroCounterTrend || broaderCounterTrend || volatilitySymbol);
  const tradeConfirmations = buildTradeConfirmations({
    alignedSweep: alignedSweep || hasEqlSweep,
    alignedEngulfing,
    alignedRejection,
    alignedStructure,
    poiReclaim,
    emaAligned,
    zoneReaction: nearDirectionalZone || freshReaction,
    freshDisplacement,
    alignedMomentum,
    breakerBlock: hasBreaker,
    fvgReaction: hasFvgReaction,
    equalLevelSweep: hasEqlSweep,
    premiumDiscount: premiumDiscountBias > 0,
    ote: hasOte,
    mss: hasMss,
  });
  const confirmationScore = countTradeConfirmations(tradeConfirmations);
  const counterPressureCount = [
    nearDirectionalZone,
    freshReaction,
    poiReclaim,
    alignedSweep,
    alignedRejection,
    alignedEngulfing,
    alignedStructure,
    alignedMomentum,
    isReversalSetup,
  ].filter(Boolean).length;

  if (direction === 'sell' && currentZone?.type === 'demand' && bullishPoiReclaim) {
    return null;
  }

  if (direction === 'buy' && currentZone?.type === 'supply' && bearishPoiReclaim) {
    return null;
  }

  if (mode === 'trend' && trend === 'ranging' && !isReversalSetup) {
    return null;
  }

  if (mode === 'counter' && trend === 'ranging' && !isReversalSetup) {
    return null;
  }

  if (emaTrend.ema50 != null && emaTrend.ema200 != null && mode === 'trend' && !emaAligned && !isReversalSetup) {
    return null;
  }

  if (emaTrend.ema50 != null && emaTrend.ema200 != null && mode === 'counter' && !emaAligned && (!isReversalSetup || !poiReclaim || !alignedStructure)) {
    return null;
  }

  if (!directionalZone && !directionalFvg && !(mode === 'trend' && pullback)) {
    return null;
  }

  if (mode === 'counter' && !directionalZone) {
    return null;
  }

  if (isVolatilitySymbol(symbol) && !directionalZone) {
    return null;
  }

  if (volatilitySymbol && mode === 'trend' && trendDirection === direction && !hasContinuationAreaReaction) {
    return null;
  }

  if (volatilitySymbol && mode === 'counter') {
    if (!isReversalSetup) {
      return null;
    }

    if ((broaderTrendDirection && broaderTrendDirection !== direction) || (trendDirection && trendDirection !== direction)) {
      if (!nearDirectionalZone || !freshReaction || !alignedSweep || !alignedStructure) {
        return null;
      }
    }
  }

  if (strictReversalConfirmationNeeded && (!alignedSweep || !freshDisplacement || !alignedStructure)) {
    return null;
  }

  if (isReversalSetup && macroCounterTrend && emaTrend.ema200 != null && !poiReclaim) {
    return null;
  }

  let probability = mode === 'trend' ? 20 : 16;

  if (directionalZone) probability += mode === 'trend' ? 20 : 24;
  if (directionalFvg) probability += mode === 'trend' ? 10 : 6;
  if (pullback) probability += mode === 'trend' ? 15 : 4;
  if (nearDirectionalZone) probability += mode === 'counter' ? 16 : 8;
  if (matchesZoneDirection(direction, currentZone)) probability += mode === 'counter' ? 12 : 6;
  if (isReversalSetup) probability += mode === 'counter' ? 24 : 20;
  if (freshReaction) probability += 12;
  if (poiReclaim) probability += 12;
  if (freshDisplacement) probability += 8;
  if (alignedSweep) probability += 10;
  if (alignedRejection) probability += 10;
  if (alignedEngulfing) probability += 10;
  if (alignedStructure) probability += mode === 'counter' ? 10 : 5;
  if (alignedMomentum) probability += 5;
  if (emaAligned) probability += 10;
  if (ema50Exec.nearEma50) probability += 8;
  if (ema50Exec.ema50ZoneConfluence) probability += 10;
  if (hasBreaker) probability += 14;
  if (hasFvgReaction) probability += 14;
  if (hasEqlSweep) probability += 12;
  if (hasOte) probability += ote!.hasFvgOverlap || ote!.hasZoneOverlap ? 16 : 10;
  if (hasMss) probability += 10;
  probability += premiumDiscountBias;
  if (stretchedFromArea) probability -= 15;
  if (!emaAligned && emaTrend.ema50 != null && emaTrend.ema200 != null) probability -= mode === 'counter' ? 16 : 28;

  if (mode === 'counter' && !nearDirectionalZone && counterPressureCount < 2) {
    return null;
  }

  if (mode === 'counter' && !isReversalSetup && !alignedSweep && !alignedRejection && !alignedEngulfing && !alignedStructure) {
    probability -= 8;
  }

  if (probability < (mode === 'trend' ? 35 : 42)) {
    return null;
  }

  const trendPriorityDecision = evaluateTrendPriorityFilter({
    symbol,
    direction,
    macroTrend,
    confidenceScore: confirmationScore,
    hasBos,
    hasDisplacement: freshDisplacement,
    hasLiquiditySweep,
    hasStrongZone,
    hasRejection: alignedRejection || alignedEngulfing || freshReaction,
  });

  if (!trendPriorityDecision.allowed) {
    return null;
  }

  const fulfilledConditions: string[] = [];
  const requiredTriggers: string[] = [];
  const contextLabels: string[] = [];

  contextLabels.push(trendPriorityDecision.reason);

  if (mode === 'trend') {
    fulfilledConditions.push(trend === 'bullish' ? 'Bullish trend context' : trend === 'bearish' ? 'Bearish trend context' : 'Range-to-reversal context');
  } else {
    fulfilledConditions.push(`Counter-trend idea against ${trend === 'ranging' ? 'a range' : trend} backdrop`);
    contextLabels.push('Aggressive one-tap style setup');
  }

  if (emaTrend.ema50 != null && emaTrend.ema200 != null) {
    if (emaAligned) {
      fulfilledConditions.push(direction === 'buy' ? 'EMA 50 above EMA 200 — bullish stack' : 'EMA 50 below EMA 200 — bearish stack');
      contextLabels.push(direction === 'buy' ? 'EMA bullish stack' : 'EMA bearish stack');
    } else {
      requiredTriggers.push(direction === 'buy' ? 'EMA 50 needs to cross above EMA 200' : 'EMA 50 needs to cross below EMA 200');
      contextLabels.push(direction === 'buy' ? 'EMA stack not yet bullish' : 'EMA stack not yet bearish');
    }
    if (macroTrend !== 'ranging') {
      fulfilledConditions.push(direction === 'buy' ? 'Price above EMA 200 — macro bullish filter' : 'Price below EMA 200 — macro bearish filter');
    }
    if (ema50Exec.nearEma50) {
      fulfilledConditions.push(direction === 'buy' ? 'Pullback to EMA 50 dynamic support' : 'Pullback to EMA 50 dynamic resistance');
      contextLabels.push('EMA 50 pullback');
    }
    if (ema50Exec.ema50ZoneConfluence) {
      fulfilledConditions.push('EMA 50 confluent with structural zone');
      contextLabels.push('EMA 50 + zone confluence');
    }
  }

  if (directionalZone) {
    if (nearDirectionalZone) {
      fulfilledConditions.push(direction === 'buy' ? 'Price is at demand/support zone' : 'Price is at supply/resistance zone');
      contextLabels.push(direction === 'buy' ? 'Testing demand/support' : 'Testing supply/resistance');
    } else {
      requiredTriggers.push(direction === 'buy' ? 'Price tap back into demand/support zone' : 'Price tap back into supply/resistance zone');
      contextLabels.push(direction === 'buy' ? 'Demand/support mapped' : 'Supply/resistance mapped');
    }
  }

  if (directionalFvg) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish FVG in play' : 'Bearish FVG in play');
    contextLabels.push(direction === 'buy' ? 'Bullish imbalance nearby' : 'Bearish imbalance nearby');
  } else if (mode === 'trend') {
    requiredTriggers.push(direction === 'buy' ? 'Bullish FVG retest or cleaner demand reaction' : 'Bearish FVG retest or cleaner supply reaction');
  }

  if (pullback) {
    fulfilledConditions.push('Pullback location is developing');
    contextLabels.push('Pullback structure intact');
  } else if (mode === 'trend') {
    requiredTriggers.push('Cleaner pullback into value area');
  }

  if (freshReaction) {
    fulfilledConditions.push(direction === 'buy' ? 'Fresh demand reaction confirmed' : 'Fresh supply reaction confirmed');
    contextLabels.push(direction === 'buy' ? 'Fresh bullish reaction' : 'Fresh bearish reaction');
  } else if (poiReclaim) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish reclaim from POI is forming' : 'Bearish reclaim from POI is forming');
    contextLabels.push(direction === 'buy' ? 'POI reclaim up' : 'POI reclaim down');
  } else {
    requiredTriggers.push(
      mode === 'counter'
        ? direction === 'buy'
          ? 'Clear bullish rejection from opposing demand zone'
          : 'Clear bearish rejection from opposing supply zone'
        : direction === 'buy'
          ? 'Clean bullish reaction from the POI'
          : 'Clean bearish reaction from the POI',
    );
  }

  if (freshDisplacement) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish displacement is underway' : 'Bearish displacement is underway');
    contextLabels.push(direction === 'buy' ? 'Displacement up' : 'Displacement down');
  } else {
    requiredTriggers.push(
      mode === 'counter'
        ? direction === 'buy'
          ? 'Bullish displacement away from the demand tap'
          : 'Bearish displacement away from the supply tap'
        : direction === 'buy'
          ? 'Stronger bullish displacement candle'
          : 'Stronger bearish displacement candle',
    );
  }

  if (stretchedFromArea) {
    requiredTriggers.push(direction === 'buy' ? 'Retest closer to demand/FVG before entry' : 'Retest closer to supply/FVG before entry');
  }

  if (alignedSweep) {
    fulfilledConditions.push(direction === 'buy' ? 'Sell-side liquidity sweep printed' : 'Buy-side liquidity sweep printed');
  } else {
    requiredTriggers.push(
      mode === 'counter'
        ? direction === 'buy'
          ? 'Sweep lower into demand before reversal trigger'
          : 'Sweep higher into supply before reversal trigger'
        : direction === 'buy'
          ? 'Sell-side liquidity sweep or zone reaction'
          : 'Buy-side liquidity sweep or zone reaction',
    );
  }

  if (alignedRejection) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish rejection from zone' : 'Bearish rejection from zone');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Bullish rejection wick from demand/support/FVG' : 'Bearish rejection wick from supply/resistance/FVG');
  }

  if (alignedEngulfing) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish engulfing confirmation' : 'Bearish engulfing confirmation');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Bullish engulfing candle' : 'Bearish engulfing candle');
  }

  if (alignedStructure) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish micro BOS printed' : 'Bearish micro BOS printed');
  } else {
    requiredTriggers.push(
      mode === 'counter'
        ? direction === 'buy'
          ? 'Bullish CHoCH / BOS against the prior drop'
          : 'Bearish CHoCH / BOS against the prior rally'
        : direction === 'buy'
          ? 'Bullish micro BOS / momentum shift'
          : 'Bearish micro BOS / momentum shift',
    );
  }

  if (isReversalSetup) {
    fulfilledConditions.push(direction === 'buy' ? 'Demand reversal pattern is visible' : 'Supply reversal pattern is visible');
    contextLabels.push(direction === 'buy' ? 'Demand reversal in play' : 'Supply reversal in play');
  }

  if (hasBreaker) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish breaker block retest (flipped supply → demand)' : 'Bearish breaker block retest (flipped demand → supply)');
    contextLabels.push(direction === 'buy' ? 'Bullish breaker block' : 'Bearish breaker block');
  }

  if (hasFvgReaction) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish FVG fill reaction — price entered imbalance and reversed' : 'Bearish FVG fill reaction — price entered imbalance and reversed');
    contextLabels.push(direction === 'buy' ? 'FVG fill reaction up' : 'FVG fill reaction down');
  }

  if (hasEqlSweep) {
    fulfilledConditions.push(direction === 'buy' ? `Equal lows swept (${eqlSweep!.touches} touches) — engineered liquidity taken` : `Equal highs swept (${eqlSweep!.touches} touches) — engineered liquidity taken`);
    contextLabels.push(direction === 'buy' ? 'EQL sweep' : 'EQH sweep');
  }

  if (hasOte) {
    fulfilledConditions.push(`Price in optimal trade entry zone (62–79% Fib retracement)${ote!.hasFvgOverlap ? ' with FVG overlap' : ote!.hasZoneOverlap ? ' with zone overlap' : ''}`);
    contextLabels.push(ote!.hasFvgOverlap ? 'OTE + FVG' : ote!.hasZoneOverlap ? 'OTE + zone' : 'OTE zone');
  }

  if (hasMss) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish market structure shift (swing high broken)' : 'Bearish market structure shift (swing low broken)');
    contextLabels.push(direction === 'buy' ? 'Bullish MSS' : 'Bearish MSS');
  }

  if (premiumDiscountBias > 0) {
    fulfilledConditions.push(direction === 'buy' ? 'Entry in discount zone (below 50% of swing)' : 'Entry in premium zone (above 50% of swing)');
    contextLabels.push(direction === 'buy' ? 'Discount entry' : 'Premium entry');
  }

  if (alignedMomentum) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish momentum is aligned' : 'Bearish momentum is aligned');
  }

  // Compute the ideal entry from the strongest structural level rather than
  // using the live current price.  This lets the potential card stay locked
  // until the market structure genuinely changes.
  const entry = computeIdealPotentialEntry(direction, currentPrice, candles, {
    directionalZone,
    directionalFvg,
    activeBreaker,
    ote,
    fvgReaction,
  });
  const stopLossDecision = computeStopLoss(symbol, direction, candles);
  const stopLoss = stopLossDecision.stopLoss;
  const { takeProfit, takeProfit2, structuralTargets } = resolveTakeProfitTargets(symbol, direction, entry, stopLoss, candles);

  if (isVolatilitySymbol(symbol) && structuralTargets.length === 0) {
    return null;
  }

  const isMacroAligned = macroTrend !== 'ranging';
  const strategy = mode === 'counter'
    ? `${poiReclaim
      ? direction === 'buy'
        ? 'Bullish POI Reclaim Countertrend'
        : 'Bearish POI Reclaim Countertrend'
      : hasEqlSweep
        ? direction === 'buy'
          ? 'Bullish EQL Sweep Reversal'
          : 'Bearish EQH Sweep Reversal'
      : nearDirectionalZone || isReversalSetup
        ? 'Counter-Trend Zone Reversal'
        : 'Counter-Trend Zone Tap'} Watchlist`
    : `${isReversalSetup
      ? direction === 'buy'
        ? isMacroAligned
          ? 'Bullish Trend Pullback Reversal'
          : broaderTrend === 'bearish'
            ? 'Bullish Countertrend Reversal from Demand'
            : 'Bullish Higher-Timeframe Reversal'
        : isMacroAligned
          ? 'Bearish Trend Pullback Reversal'
          : broaderTrend === 'bullish'
            ? 'Bearish Countertrend Reversal from Supply'
            : 'Bearish Higher-Timeframe Reversal'
      : hasFvgReaction
        ? direction === 'buy'
          ? 'Bullish FVG Fill Continuation'
          : 'Bearish FVG Fill Continuation'
      : hasEqlSweep
        ? direction === 'buy'
          ? 'Bullish EQL Sweep Reversal'
          : 'Bearish EQH Sweep Reversal'
      : poiReclaim
        ? direction === 'buy'
          ? isMacroAligned || broaderTrend !== 'bearish'
            ? 'Bullish POI Reclaim Continuation'
            : 'Bullish POI Reclaim Countertrend'
          : isMacroAligned || broaderTrend !== 'bullish'
            ? 'Bearish POI Reclaim Continuation'
            : 'Bearish POI Reclaim Countertrend'
      : nearDirectionalZone
        ? deriveStrategy(direction, sweep)
        : direction === 'buy'
          ? 'Bullish Pullback Zone Tap'
          : 'Bearish Pullback Zone Tap'} Watchlist`;

  const narrative = mode === 'counter'
    ? buildCounterTrendNarrative(trend, direction, currentPrice, contextLabels, requiredTriggers.slice(0, 3))
    : buildPotentialNarrative(direction, currentPrice, contextLabels, requiredTriggers.slice(0, 3));

  let cappedConfidenceScore = confirmationScore;

  if (macroCounterTrend && !hasBos) {
    cappedConfidenceScore = Math.min(cappedConfidenceScore, 7);
  }

  if (isReversalSetup && !alignedStructure) {
    cappedConfidenceScore = Math.min(cappedConfidenceScore, 5);
  }

  if (isReversalSetup && macroCounterTrend) {
    cappedConfidenceScore = Math.min(cappedConfidenceScore, 4);
  }

  if (isReversalSetup && !freshDisplacement) {
    cappedConfidenceScore = Math.min(cappedConfidenceScore, 4);
  }

  if (isReversalSetup && emaTrend.ema50 != null && emaTrend.ema200 != null && !emaAligned) {
    cappedConfidenceScore = Math.min(cappedConfidenceScore, 4);
  }

  return {
    symbol,
    direction,
    currentPrice,
    entry,
    stopLoss,
    slReason: stopLossDecision.slReason,
    takeProfit,
    takeProfit2,
    activationProbability: Math.min(95, probability),
    confidenceScore: cappedConfidenceScore,
    marketRegime: mode === 'trend' ? 'trend' : 'reversal',
    confirmations: tradeConfirmations,
    strategy,
    narrative,
    fulfilledConditions,
    requiredTriggers,
    contextLabels,
  };
}

function hasStrongClosure(direction: 'buy' | 'sell', candles: Candle[]): boolean {
  if (candles.length < 2) {
    return false;
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const range = Math.max(last.high - last.low, 0.0001);
  const body = Math.abs(last.close - last.open);

  if (body < range * 0.45) {
    return false;
  }

  if (direction === 'buy') {
    return last.close > last.open && last.close >= last.low + range * 0.7 && last.close > prev.high;
  }

  return last.close < last.open && last.close <= last.high - range * 0.7 && last.close < prev.low;
}

function isZoneRetestStillTradable(currentPrice: number, zone: PriceZone, candles: Candle[]): boolean {
  const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
  const baselineRange = Math.max(averageRange(candles, 12), currentPrice * 0.0004);
  const outsideDistance = currentPrice < zone.bottom
    ? zone.bottom - currentPrice
    : currentPrice > zone.top
      ? currentPrice - zone.top
      : 0;
  const maxTradableDistance = Math.max(zoneHeight * 0.35, baselineRange * 0.45);

  return outsideDistance <= maxTradableDistance;
}

function findActiveReversalZone(currentPrice: number, zones: PriceZone[], candles: Candle[]): PriceZone | null {
  const baselineRange = Math.max(averageRange(candles, 12), currentPrice * 0.0004);

  for (const zone of zones) {
    const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
    const dynamicBuffer = Math.max(zoneHeight * 0.12, baselineRange * 0.3, currentPrice * 0.00045);

    if (currentPrice >= zone.bottom - dynamicBuffer && currentPrice <= zone.top + dynamicBuffer) {
      return zone;
    }
  }

  return null;
}

interface PatternPoint {
  candle: Candle;
  index: number;
}

interface ReversalPatternMatch {
  matched: boolean;
  label: string | null;
}

function isInDemandReversalBand(point: PatternPoint, zone: PriceZone): boolean {
  const zoneHeight = Math.max(zone.top - zone.bottom, 0.0001);
  const lowerBandCeiling = zone.bottom + zoneHeight * 0.55;
  return point.candle.low >= zone.bottom * 0.9985 && point.candle.low <= lowerBandCeiling;
}

function isInSupplyReversalBand(point: PatternPoint, zone: PriceZone): boolean {
  const zoneHeight = Math.max(zone.top - zone.bottom, 0.0001);
  const upperBandFloor = zone.top - zoneHeight * 0.55;
  return point.candle.high <= zone.top * 1.0015 && point.candle.high >= upperBandFloor;
}

function hasMeaningfulSwingBetween(
  candles: Candle[],
  firstIndex: number,
  secondIndex: number,
  direction: 'buy' | 'sell',
  minimumDepth: number,
): boolean {
  if (secondIndex - firstIndex < 2) {
    return false;
  }

  const middle = candles.slice(firstIndex + 1, secondIndex);
  if (middle.length === 0) {
    return false;
  }

  if (direction === 'buy') {
    const firstLow = candles[firstIndex].low;
    const secondLow = candles[secondIndex].low;
    const neckline = Math.max(...middle.map((candle) => candle.high));
    return neckline - Math.max(firstLow, secondLow) >= minimumDepth;
  }

  const firstHigh = candles[firstIndex].high;
  const secondHigh = candles[secondIndex].high;
  const neckline = Math.min(...middle.map((candle) => candle.low));
  return Math.min(firstHigh, secondHigh) - neckline >= minimumDepth;
}

function detectDoubleBottom(candles: Candle[], zone: PriceZone | null): boolean {
  if (!zone || zone.type !== 'demand' || candles.length < DOUBLE_REVERSAL_PATTERN_LOOKBACK) {
    return false;
  }

  const recent = candles.slice(-DOUBLE_REVERSAL_PATTERN_LOOKBACK);
  const baselineRange = Math.max(averageRange(candles, 12), 0.0001);
  const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
  const lows = recent
    .map((candle, index) => ({ candle, index }))
    .filter((point) => isInDemandReversalBand(point, zone))
    .sort((left, right) => left.candle.low - right.candle.low);

  if (lows.length < 2) {
    return false;
  }

  const first = lows[0];
  const second = lows.find((item) => {
    if (Math.abs(item.index - first.index) < 2) {
      return false;
    }

    const sameLevel = Math.abs(item.candle.low - first.candle.low) <= Math.max(zoneHeight * 0.25, baselineRange * 0.35, first.candle.low * 0.001);
    const meaningfulSwing = hasMeaningfulSwingBetween(recent, Math.min(first.index, item.index), Math.max(first.index, item.index), 'buy', Math.max(zoneHeight * 0.45, baselineRange * 0.9));

    return sameLevel && meaningfulSwing;
  });

  if (!second) {
    return false;
  }

  const laterIndex = Math.max(first.index, second.index);
  const neckline = Math.max(...recent.slice(Math.min(first.index, second.index) + 1, laterIndex).map((candle) => candle.high));
  const last = recent[recent.length - 1];

  return last.close >= neckline - baselineRange * 0.15;
}

function detectDoubleTop(candles: Candle[], zone: PriceZone | null): boolean {
  if (!zone || zone.type !== 'supply' || candles.length < DOUBLE_REVERSAL_PATTERN_LOOKBACK) {
    return false;
  }

  const recent = candles.slice(-DOUBLE_REVERSAL_PATTERN_LOOKBACK);
  const baselineRange = Math.max(averageRange(candles, 12), 0.0001);
  const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
  const highs = recent
    .map((candle, index) => ({ candle, index }))
    .filter((point) => isInSupplyReversalBand(point, zone))
    .sort((left, right) => right.candle.high - left.candle.high);

  if (highs.length < 2) {
    return false;
  }

  const first = highs[0];
  const second = highs.find((item) => {
    if (Math.abs(item.index - first.index) < 2) {
      return false;
    }

    const sameLevel = Math.abs(item.candle.high - first.candle.high) <= Math.max(zoneHeight * 0.25, baselineRange * 0.35, first.candle.high * 0.001);
    const meaningfulSwing = hasMeaningfulSwingBetween(recent, Math.min(first.index, item.index), Math.max(first.index, item.index), 'sell', Math.max(zoneHeight * 0.45, baselineRange * 0.9));

    return sameLevel && meaningfulSwing;
  });

  if (!second) {
    return false;
  }

  const laterIndex = Math.max(first.index, second.index);
  const neckline = Math.min(...recent.slice(Math.min(first.index, second.index) + 1, laterIndex).map((candle) => candle.low));
  const last = recent[recent.length - 1];

  return last.close <= neckline + baselineRange * 0.15;
}

function detectInverseHeadAndShoulders(candles: Candle[], zone: PriceZone | null): boolean {
  if (!zone || zone.type !== 'demand' || candles.length < HEAD_SHOULDERS_PATTERN_LOOKBACK) {
    return false;
  }

  const recent = candles.slice(-HEAD_SHOULDERS_PATTERN_LOOKBACK);
  const baselineRange = Math.max(averageRange(candles, 12), 0.0001);
  const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
  const lows = recent
    .map((candle, index) => ({ candle, index }))
    .filter((point) => isInDemandReversalBand(point, zone))
    .sort((left, right) => left.index - right.index);

  if (lows.length < 3) {
    return false;
  }

  const shoulderTolerance = Math.max(zoneHeight * 0.28, baselineRange * 0.4, recent[0]?.low ? recent[0].low * 0.0012 : 0.0001);
  const headClearance = Math.max(zoneHeight * 0.22, baselineRange * 0.45, recent[0]?.low ? recent[0].low * 0.0008 : 0.0001);

  for (let leftIndex = 0; leftIndex < lows.length - 2; leftIndex++) {
    for (let headIndex = leftIndex + 1; headIndex < lows.length - 1; headIndex++) {
      for (let rightIndex = headIndex + 1; rightIndex < lows.length; rightIndex++) {
        const left = lows[leftIndex];
        const head = lows[headIndex];
        const right = lows[rightIndex];

        if (head.index - left.index < 2 || right.index - head.index < 2) {
          continue;
        }

        const shouldersAligned = Math.abs(left.candle.low - right.candle.low) <= shoulderTolerance;
        const headIsLower = head.candle.low < Math.min(left.candle.low, right.candle.low) - headClearance;

        if (!shouldersAligned || !headIsLower) {
          continue;
        }

        const firstNecklineSlice = recent.slice(left.index + 1, head.index);
        const secondNecklineSlice = recent.slice(head.index + 1, right.index);
        if (firstNecklineSlice.length === 0 || secondNecklineSlice.length === 0) {
          continue;
        }

        const neckline = Math.min(
          Math.max(...firstNecklineSlice.map((candle) => candle.high)),
          Math.max(...secondNecklineSlice.map((candle) => candle.high)),
        );
        const last = recent[recent.length - 1];

        if (last.close >= neckline - baselineRange * 0.15) {
          return true;
        }
      }
    }
  }

  return false;
}

function detectHeadAndShoulders(candles: Candle[], zone: PriceZone | null): boolean {
  if (!zone || zone.type !== 'supply' || candles.length < HEAD_SHOULDERS_PATTERN_LOOKBACK) {
    return false;
  }

  const recent = candles.slice(-HEAD_SHOULDERS_PATTERN_LOOKBACK);
  const baselineRange = Math.max(averageRange(candles, 12), 0.0001);
  const zoneHeight = Math.max(Math.abs(zone.top - zone.bottom), 0.0001);
  const highs = recent
    .map((candle, index) => ({ candle, index }))
    .filter((point) => isInSupplyReversalBand(point, zone))
    .sort((left, right) => left.index - right.index);

  if (highs.length < 3) {
    return false;
  }

  const shoulderTolerance = Math.max(zoneHeight * 0.28, baselineRange * 0.4, recent[0]?.high ? recent[0].high * 0.0012 : 0.0001);
  const headClearance = Math.max(zoneHeight * 0.22, baselineRange * 0.45, recent[0]?.high ? recent[0].high * 0.0008 : 0.0001);

  for (let leftIndex = 0; leftIndex < highs.length - 2; leftIndex++) {
    for (let headIndex = leftIndex + 1; headIndex < highs.length - 1; headIndex++) {
      for (let rightIndex = headIndex + 1; rightIndex < highs.length; rightIndex++) {
        const left = highs[leftIndex];
        const head = highs[headIndex];
        const right = highs[rightIndex];

        if (head.index - left.index < 2 || right.index - head.index < 2) {
          continue;
        }

        const shouldersAligned = Math.abs(left.candle.high - right.candle.high) <= shoulderTolerance;
        const headIsHigher = head.candle.high > Math.max(left.candle.high, right.candle.high) + headClearance;

        if (!shouldersAligned || !headIsHigher) {
          continue;
        }

        const firstNecklineSlice = recent.slice(left.index + 1, head.index);
        const secondNecklineSlice = recent.slice(head.index + 1, right.index);
        if (firstNecklineSlice.length === 0 || secondNecklineSlice.length === 0) {
          continue;
        }

        const neckline = Math.max(
          Math.min(...firstNecklineSlice.map((candle) => candle.low)),
          Math.min(...secondNecklineSlice.map((candle) => candle.low)),
        );
        const last = recent[recent.length - 1];

        if (last.close <= neckline + baselineRange * 0.15) {
          return true;
        }
      }
    }
  }

  return false;
}

function resolveBullishReversalPattern(currentPrice: number, zone: PriceZone | null, candles: Candle[]): ReversalPatternMatch {
  if (!zone || !isZoneRetestStillTradable(currentPrice, zone, candles) || !hasStrongClosure('buy', candles)) {
    return { matched: false, label: null };
  }

  if (detectInverseHeadAndShoulders(candles, zone)) {
    return { matched: true, label: 'Inverse head and shoulders at demand' };
  }

  if (detectDoubleBottom(candles, zone)) {
    return { matched: true, label: 'Double bottom at demand' };
  }

  return { matched: false, label: null };
}

function resolveBearishReversalPattern(currentPrice: number, zone: PriceZone | null, candles: Candle[]): ReversalPatternMatch {
  if (!zone || !isZoneRetestStillTradable(currentPrice, zone, candles) || !hasStrongClosure('sell', candles)) {
    return { matched: false, label: null };
  }

  if (detectHeadAndShoulders(candles, zone)) {
    return { matched: true, label: 'Head and shoulders at supply' };
  }

  if (detectDoubleTop(candles, zone)) {
    return { matched: true, label: 'Double top at supply' };
  }

  return { matched: false, label: null };
}

function findRecentDirectionalTargets(
  symbol: string,
  direction: 'buy' | 'sell',
  candles: Candle[],
  entry: number,
  stopLoss: number,
): number[] {
  const profile = getSymbolRiskProfile(symbol);
  const swings = findSwingHighsLows(candles.slice(-Math.min(120, candles.length)));
  const sourceCandles = candles.slice(-Math.min(120, candles.length));
  const risk = Math.abs(entry - stopLoss);
  const baselineRange = Math.max(averageRange(sourceCandles, 14), entry * profile.minZoneHeightPriceRatio);
  const minTargetDistance = Math.max(risk * profile.minTargetRiskMultiple, baselineRange * 2);

  const prices = swings
    .filter((swing) => {
      if (direction === 'buy' && (swing.type !== 'high' || swing.price <= entry)) {
        return false;
      }

      if (direction === 'sell' && (swing.type !== 'low' || swing.price >= entry)) {
        return false;
      }

      return getOriginAge(sourceCandles.length, swing.index) >= profile.minTargetOriginAge;
    })
    .map((swing) => sourceCandles[swing.index]?.[swing.type] ?? swing.price)
    .filter((price) => {
      if (!Number.isFinite(price)) {
        return false;
      }

      return direction === 'buy'
        ? price - entry >= minTargetDistance
        : entry - price >= minTargetDistance;
    })
    .sort((left, right) => direction === 'buy' ? left - right : right - left)
    .filter((price, index, array) => array.indexOf(price) === index);

  return prices;
}

function resolveTakeProfitTargets(symbol: string, direction: 'buy' | 'sell', entry: number, stopLoss: number, candles: Candle[]) {
  const fallbackTp1 = computeTakeProfit(direction, entry, stopLoss);
  const fallbackTp2 = computeSecondaryTakeProfit(direction, entry, stopLoss);
  const targets = findRecentDirectionalTargets(symbol, direction, candles, entry, stopLoss);

  const takeProfit = targets[0] ?? fallbackTp1;
  let takeProfit2 = targets[1] ?? fallbackTp2;

  if (direction === 'buy') {
    if (takeProfit <= entry) {
      return { takeProfit: fallbackTp1, takeProfit2: fallbackTp2, structuralTargets: targets };
    }

    if (takeProfit2 <= takeProfit) {
      takeProfit2 = Math.max(fallbackTp2, takeProfit + Math.abs(entry - stopLoss));
    }
  } else {
    if (takeProfit >= entry) {
      return { takeProfit: fallbackTp1, takeProfit2: fallbackTp2, structuralTargets: targets };
    }

    if (takeProfit2 >= takeProfit) {
      takeProfit2 = Math.min(fallbackTp2, takeProfit - Math.abs(entry - stopLoss));
    }
  }

  return { takeProfit, takeProfit2, structuralTargets: targets };
}

export function isNearZone(currentPrice: number, zones: PriceZone[], bufferRatio = 0.0015): PriceZone | null {
  for (const zone of zones) {
    const dynamicBuffer = Math.max(currentPrice * bufferRatio, Math.abs(zone.top - zone.bottom) * 0.2);

    if (currentPrice >= zone.bottom - dynamicBuffer && currentPrice <= zone.top + dynamicBuffer) {
      return zone;
    }
  }

  return null;
}

function isTooCloseToOpposingZone(
  direction: 'buy' | 'sell',
  entry: number,
  zones: PriceZone[],
  thresholdRatio = 0.002,
): PriceZone | null {
  const threshold = Math.max(entry * thresholdRatio, 0.0005);

  for (const zone of zones) {
    if (direction === 'buy' && zone.type === 'supply' && zone.bottom >= entry) {
      const distance = zone.bottom - entry;
      if (distance <= threshold) {
        return zone;
      }
    }

    if (direction === 'sell' && zone.type === 'demand' && zone.top <= entry) {
      const distance = entry - zone.top;
      if (distance <= threshold) {
        return zone;
      }
    }
  }

  return null;
}

export function zoneFilter(signal: Pick<TradeSetup, 'symbol' | 'direction' | 'entry'>, candles: Candle[]) {
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, signal.entry);
  const currentZone = isNearZone(signal.entry, zones);

  if (currentZone) {
    if (signal.direction === 'buy' && currentZone.type === 'supply') {
      return { valid: false, reason: 'Buying into supply zone' };
    }

    if (signal.direction === 'sell' && currentZone.type === 'demand') {
      return { valid: false, reason: 'Selling into demand zone' };
    }
  }

  const opposingZoneTooClose = isTooCloseToOpposingZone(signal.direction, signal.entry, zones);
  if (opposingZoneTooClose) {
    return {
      valid: false,
      reason: signal.direction === 'buy'
        ? 'Buy entry is too close to overhead supply'
        : 'Sell entry is too close to underlying demand',
    };
  }

  return { valid: true, reason: null as string | null };
}

// ── 9. Main Analysis Function (single symbol) ──
// Pure logic — no AI, no network calls. Just candles in, setup out.

export function analyzeMarket(symbol: string, candles: Candle[]): TradeSetup | null {
  if (candles.length < MIN_SCANNER_ANALYSIS_CANDLES) return null;

  const trend = detectTrend(candles);
  const broaderTrend = detectContextTrend(candles);
  const emaTrend = analyzeEmaTrend(candles);
  const currentPrice = candles[candles.length - 1].close;
  const range = detectSupportResistanceRange(candles);
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, currentPrice);
  const gaps = buildFairValueGaps(lookLeftCandles, currentPrice);
  const currentZone = findActiveReversalZone(currentPrice, zones, candles);
  const bullishReversalPattern = resolveBullishReversalPattern(currentPrice, currentZone, candles);
  const bearishReversalPattern = resolveBearishReversalPattern(currentPrice, currentZone, candles);
  const bullishReversal = bullishReversalPattern.matched;
  const bearishReversal = bearishReversalPattern.matched;
  const macroTrend = detectMacroTrend(candles, emaTrend);

  // Macro ranging → prioritize range trades (buy support, sell resistance)
  if (macroTrend === 'ranging') {
    const rangeTradeSetup = buildSupportResistanceTradeSetup(symbol, candles, broaderTrend, emaTrend);
    if (rangeTradeSetup) return rangeTradeSetup;
    if (trend === 'ranging' && !bullishReversal && !bearishReversal) return null;
  }

  const bullishArea = toPriceArea(findDirectionalZone('buy', zones, currentPrice, candles, symbol) ?? findDirectionalFvg('buy', gaps, candles, symbol));
  const bearishArea = toPriceArea(findDirectionalZone('sell', zones, currentPrice, candles, symbol) ?? findDirectionalFvg('sell', gaps, candles, symbol));
  const bullishPoiReclaim = hasPoiReclaim('buy', bullishArea, candles);
  const bearishPoiReclaim = hasPoiReclaim('sell', bearishArea, candles);

  let direction: 'buy' | 'sell';
  if (macroTrend === 'bullish') {
    direction = bearishReversal && !bullishReversal ? 'sell' : 'buy';
  } else if (macroTrend === 'bearish') {
    direction = bullishReversal && !bearishReversal ? 'buy' : 'sell';
  } else {
    // Macro ranging — use micro trend / reversal patterns for direction
    if (trend === 'ranging' && !bullishReversal && !bearishReversal) return null;
    direction = bullishReversal
      ? 'buy'
      : bearishReversal
        ? 'sell'
        : currentZone?.type === 'demand' && bullishPoiReclaim
          ? 'buy'
          : currentZone?.type === 'supply' && bearishPoiReclaim
            ? 'sell'
          : trend === 'bullish'
            ? 'buy'
            : 'sell';
  }

  // Only count a reversal when it aligns with the chosen direction
  const isReversalSetup = (direction === 'buy' && bullishReversal) || (direction === 'sell' && bearishReversal);
  const directionalZone = findDirectionalZone(direction, zones, currentPrice, candles, symbol);
  const directionalFvg = findDirectionalFvg(direction, gaps, candles, symbol);
  const preferredArea = toPriceArea(directionalZone ?? directionalFvg);

  // EMA 50 execution analysis
  const ema50Exec = analyzeEma50Execution(candles, emaTrend, directionalZone, directionalFvg);
  const emaStackAligned = direction === 'buy' ? ema50Exec.ema50Above200 : !ema50Exec.ema50Above200;
  const ema50CrossAligned =
    (direction === 'buy' && ema50Exec.ema50Cross === 'bullish') ||
    (direction === 'sell' && ema50Exec.ema50Cross === 'bearish');

  const sweep = detectLiquiditySweep(candles);
  const pullback = detectPullback(trend, candles);

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const engulfing = detectEngulfing(prev, last);
  const rejection = detectRejection(last);
  const structure = detectStructureBreak(candles);

  const score = scoreSetup({ trend, pullback, sweep, engulfing, rejection, structure });

  if (score < 5) return null;

  const recentMomentum = detectRecentMomentum(candles);
  const alignedSweep = isSweepAligned(direction, sweep);
  const alignedEngulfing = isEngulfingAligned(direction, engulfing);
  const alignedRejection = isRejectionAligned(direction, rejection);
  const alignedStructure = isStructureAligned(direction, structure);
  const alignedMomentum = (direction === 'buy' && recentMomentum === 'bullish') || (direction === 'sell' && recentMomentum === 'bearish');
  const freshReaction = isDirectionalReactionFromArea(direction, preferredArea, candles);
  const poiReclaim = direction === 'buy' ? bullishPoiReclaim : bearishPoiReclaim;
  const freshDisplacement = hasFreshDisplacement(direction, candles);
  const stretchedFromArea = isExtendedFromArea(direction, currentPrice, preferredArea, candles);
  // EMA alignment: require EMA 50 above EMA 200 for buys, below for sells
  const emaAligned = emaStackAligned;
  const nearDirectionalZone = directionalZone ? isNearZone(currentPrice, [directionalZone], 0.0025) !== null : false;
  const activeBreaker = findActiveBreakerBlock(direction, currentPrice, candles);
  const hasBreaker = activeBreaker !== null;
  const fvgReaction = detectFvgReaction(direction, candles, gaps);
  const hasFvgReaction = fvgReaction !== null && fvgReaction.hasReactionCandle;
  const eqlSweep = detectEqualLevelSweep(direction, candles);
  const hasEqlSweep = eqlSweep !== null;
  const premiumDiscountBias = getPremiumDiscountBias(direction, currentPrice, candles);
  const ote = detectOptimalTradeEntry(direction, currentPrice, candles, gaps, zones);
  const hasOte = ote !== null && ote.inOteZone;
  const mss = detectMarketStructureShift(candles);
  const hasMss = isMssAligned(direction, mss);
  const hasBos = alignedStructure || hasMss;
  const hasLiquiditySweep = alignedSweep || hasEqlSweep;
  const hasStrongZone = directionalZone ? isMeaningfulZone(symbol, directionalZone, candles, currentPrice) : false;
  const volatilitySymbol = isVolatilitySymbol(symbol);
  const trendDirection = toTradeDirection(trend);
  const broaderTrendDirection = toTradeDirection(broaderTrend);
  const macroTrendDirection = toTradeDirection(macroTrend);
  const macroCounterTrend = macroTrendDirection !== null && macroTrendDirection !== direction;
  const hasContinuationAreaReaction = nearDirectionalZone || freshReaction || poiReclaim || hasBreaker || hasFvgReaction;
  const tradeConfirmations = buildTradeConfirmations({
    alignedSweep: alignedSweep || hasEqlSweep,
    alignedEngulfing,
    alignedRejection,
    alignedStructure,
    poiReclaim,
    emaAligned,
    zoneReaction: nearDirectionalZone || freshReaction,
    freshDisplacement,
    alignedMomentum,
    breakerBlock: hasBreaker,
    fvgReaction: hasFvgReaction,
    equalLevelSweep: hasEqlSweep,
    premiumDiscount: premiumDiscountBias > 0,
    ote: hasOte,
    mss: hasMss,
  });
  const confirmationScore = countTradeConfirmations(tradeConfirmations);

  if (direction === 'sell' && currentZone?.type === 'demand' && bullishPoiReclaim) return null;
  if (direction === 'buy' && currentZone?.type === 'supply' && bearishPoiReclaim) return null;

  if (sweep && !alignedSweep) return null;
  if (engulfing && !alignedEngulfing) return null;
  if (rejection && !alignedRejection) return null;
  if (structure && !alignedStructure) return null;

  const hasZonePresence = !!(directionalZone || directionalFvg || hasBreaker || hasFvgReaction);
  const hasSweepConfirmation = alignedSweep || hasEqlSweep;
  const hasEntryConfirmation = alignedRejection || alignedEngulfing;

  // Core zone requirement — EMA 50 cross setups can bypass zone presence
  // because the cross itself is the execution trigger from a dynamic level
  if (!hasZonePresence && !ema50CrossAligned) return null;
  if (isVolatilitySymbol(symbol) && !directionalZone && !hasBreaker && !hasFvgReaction && !ema50CrossAligned) return null;
  if (stretchedFromArea && !freshDisplacement && !ema50CrossAligned) return null;

  // Sniper entry: when macro trend is clear, enforce the full sequence:
  // 1) Price in zone  2) Liquidity sweep  3) Rejection/engulfing  4) EMA stack aligned
  // Exception: EMA 50 cross aligned with macro direction is a standalone trigger
  if (macroTrend !== 'ranging') {
    if (!emaStackAligned && !isReversalSetup && !ema50CrossAligned) return null;

    // Price must be at or reacting from a zone/FVG — or triggering off EMA 50 cross
    if (!nearDirectionalZone && !freshReaction && !poiReclaim && !hasBreaker && !hasFvgReaction && !isReversalSetup && !ema50CrossAligned) return null;

    // Need sweep + entry candle confirmation for the cleanest entries — EMA 50 cross counts as execution confirmation
    if (!hasSweepConfirmation && !hasEntryConfirmation && !isReversalSetup && !hasBreaker && !hasFvgReaction && !(alignedStructure || hasMss) && !ema50CrossAligned) return null;
  }

  if (volatilitySymbol && trendDirection === direction && !isReversalSetup && !hasContinuationAreaReaction && !ema50CrossAligned) return null;

  // When macro is ranging, apply the stricter micro counter-trend gates
  if (macroTrend === 'ranging') {
    if (volatilitySymbol && trendDirection && direction !== trendDirection) {
      if (!isReversalSetup) return null;
      if (!nearDirectionalZone || !freshReaction || !hasSweepConfirmation || !(alignedStructure || hasMss)) return null;
    }
    if (volatilitySymbol && broaderTrendDirection && direction !== broaderTrendDirection && !isReversalSetup) return null;
  }

  const directionalConfirmationCount = [hasSweepConfirmation, alignedEngulfing, alignedRejection, alignedStructure || hasMss, alignedMomentum, poiReclaim]
    .filter(Boolean)
    .length;

  const trendPriorityDecision = evaluateTrendPriorityFilter({
    symbol,
    direction,
    macroTrend,
    confidenceScore: confirmationScore,
    hasBos,
    hasDisplacement: freshDisplacement,
    hasLiquiditySweep,
    hasStrongZone,
    hasRejection: alignedRejection || alignedEngulfing || freshReaction,
  });

  if (!trendPriorityDecision.allowed) {
    return null;
  }

  // EMA 50/200 not stacked for this direction — need extra confirmation
  // EMA 50 cross already confirms intent so it bypasses the stack requirement
  if (!emaAligned && !isReversalSetup && !ema50CrossAligned && directionalConfirmationCount < 3) return null;

  if (directionalConfirmationCount < 2 && !isReversalSetup && !hasBreaker && !hasFvgReaction && !ema50CrossAligned) return null;
  if (!alignedEngulfing && !alignedRejection && !(alignedStructure || hasMss) && !poiReclaim && !isReversalSetup && !hasBreaker && !hasFvgReaction && !ema50CrossAligned) return null;

  // Liquidity sweeps need actual reversal confirmation before the scanner fires.
  if ((alignedSweep || hasEqlSweep) && !alignedEngulfing && !(alignedStructure || hasMss) && !isReversalSetup && !hasBreaker) return null;

  // If the local tape is still moving against the setup, do not force an entry from the higher-level trend.
  if (!alignedMomentum && !(alignedStructure || hasMss) && !alignedEngulfing && !poiReclaim && !isReversalSetup && !hasBreaker && !hasFvgReaction && !ema50CrossAligned) return null;

  // Favor the same setup family shown in the winning examples: reaction from a clean area, then displacement.
  if (!freshReaction && !poiReclaim && !alignedSweep && !hasEqlSweep && !alignedRejection && !alignedEngulfing && !isReversalSetup && !hasBreaker && !hasFvgReaction && !ema50CrossAligned) return null;
  if (!freshDisplacement && !(alignedStructure || hasMss) && !alignedEngulfing && !poiReclaim && !isReversalSetup && !hasBreaker && !hasFvgReaction && !ema50CrossAligned) return null;

  const entry = last.close;
  // EMA 50 cross: anchor SL to EMA 200 (the macro filter level). Otherwise use structural SL.
  const stopLossDecision = ema50CrossAligned && emaTrend.ema200 != null
    ? {
        stopLoss: computeEma200AnchoredStopLoss(symbol, direction, candles, emaTrend.ema200),
        slReason: 'EMA200-anchored SL' as const,
      }
    : computeStopLoss(symbol, direction, candles);
  const stopLoss = stopLossDecision.stopLoss;
  const { takeProfit, takeProfit2, structuralTargets } = resolveTakeProfitTargets(symbol, direction, entry, stopLoss, candles);

  if (isVolatilitySymbol(symbol) && structuralTargets.length === 0 && !ema50CrossAligned) return null;

  // Sanity: TP must be in the right direction
  if (direction === 'buy' && takeProfit <= entry) return null;
  if (direction === 'sell' && takeProfit >= entry) return null;
  if (direction === 'buy' && takeProfit2 <= takeProfit) return null;
  if (direction === 'sell' && takeProfit2 >= takeProfit) return null;

  // Sanity: SL must be on the correct side
  if (direction === 'buy' && stopLoss >= entry) return null;
  if (direction === 'sell' && stopLoss <= entry) return null;

  const confirmations: SetupConfirmations = { sweep, engulfing, rejection, structure };
  const cappedConfidenceScore = macroCounterTrend && !hasBos
    ? Math.min(confirmationScore, 7)
    : confirmationScore;

  const candidateSetup: TradeSetup = {
    symbol,
    direction,
    entry,
    stopLoss,
    slReason: stopLossDecision.slReason,
    takeProfit,
    takeProfit2,
    score,
    confidenceScore: cappedConfidenceScore,
    marketRegime: isReversalSetup ? 'reversal' : 'trend',
    strategy: isReversalSetup
      ? direction === 'buy'
        ? macroTrend === 'bullish'
          ? 'Bullish Trend Pullback Reversal'
          : broaderTrend === 'bearish'
            ? 'Bullish Countertrend Reversal from Demand'
            : 'Bullish Higher-Timeframe Reversal'
        : macroTrend === 'bearish'
          ? 'Bearish Trend Pullback Reversal'
          : broaderTrend === 'bullish'
            ? 'Bearish Countertrend Reversal from Supply'
            : 'Bearish Higher-Timeframe Reversal'
      : hasBreaker
        ? direction === 'buy'
          ? 'Bullish Breaker Block Retest'
          : 'Bearish Breaker Block Retest'
      : hasFvgReaction
        ? direction === 'buy'
          ? 'Bullish FVG Fill Continuation'
          : 'Bearish FVG Fill Continuation'
      : hasEqlSweep
        ? direction === 'buy'
          ? 'Bullish EQL Sweep Reversal'
          : 'Bearish EQH Sweep Reversal'
      : poiReclaim
        ? direction === 'buy'
          ? macroTrend === 'bullish' || broaderTrend !== 'bearish'
            ? 'Bullish POI Reclaim Continuation'
            : 'Bullish POI Reclaim Countertrend'
          : macroTrend === 'bearish' || broaderTrend !== 'bullish'
            ? 'Bearish POI Reclaim Continuation'
            : 'Bearish POI Reclaim Countertrend'
      : ema50CrossAligned
        ? direction === 'buy'
          ? 'Bullish EMA 50 Cross Continuation'
          : 'Bearish EMA 50 Cross Continuation'
      : deriveStrategy(direction, sweep),
    confirmations: tradeConfirmations,
    confirmationLabels: [
      ...(emaAligned
        ? [direction === 'buy' ? 'EMA 50 above EMA 200 — bullish stack confirmed' : 'EMA 50 below EMA 200 — bearish stack confirmed']
        : []),
      ...(macroTrend !== 'ranging'
        ? [direction === 'buy' ? 'Price above EMA 200 — macro bullish filter' : 'Price below EMA 200 — macro bearish filter']
        : []),
      ...(ema50Exec.nearEma50
        ? [direction === 'buy' ? 'Pullback to EMA 50 dynamic support' : 'Pullback to EMA 50 dynamic resistance']
        : []),
      ...(ema50Exec.ema50ZoneConfluence
        ? ['EMA 50 confluent with structural zone']
        : []),
      ...(ema50CrossAligned
        ? [direction === 'buy'
          ? 'Price closed above EMA 50 — bullish execution trigger'
          : 'Price closed below EMA 50 — bearish execution trigger']
        : []),
      ...(isReversalSetup ? [direction === 'buy' ? 'Demand reversal pattern confirmed' : 'Supply reversal pattern confirmed', direction === 'buy' ? 'Bullish closure confirmation' : 'Bearish closure confirmation'] : []),
      ...(poiReclaim && !isReversalSetup ? [direction === 'buy' ? 'POI reclaim from demand/support' : 'POI reclaim from supply/resistance'] : []),
      ...(hasBreaker ? [direction === 'buy' ? 'Bullish breaker block retest (flipped supply → demand)' : 'Bearish breaker block retest (flipped demand → supply)'] : []),
      ...(hasFvgReaction ? [direction === 'buy' ? 'Bullish FVG fill reaction — price entered imbalance and reversed' : 'Bearish FVG fill reaction — price entered imbalance and reversed'] : []),
      ...(hasEqlSweep ? [direction === 'buy' ? `Equal lows swept at ${eqlSweep!.price.toFixed(5)} (${eqlSweep!.touches} touches)` : `Equal highs swept at ${eqlSweep!.price.toFixed(5)} (${eqlSweep!.touches} touches)`] : []),
      ...(hasOte ? [`Price in OTE zone (62–79% retracement)${ote!.hasFvgOverlap ? ' with FVG overlap' : ote!.hasZoneOverlap ? ' with zone overlap' : ''}`] : []),
      ...(hasMss ? [direction === 'buy' ? 'Bullish market structure shift (swing high broken)' : 'Bearish market structure shift (swing low broken)'] : []),
      ...(premiumDiscountBias > 0 ? [direction === 'buy' ? 'Entry in discount zone (below 50% of swing)' : 'Entry in premium zone (above 50% of swing)'] : []),
      ...buildConfirmationLabels(confirmations),
    ],
  };

  const zoneCheck = zoneFilter(candidateSetup, candles);
  if (!zoneCheck.valid) {
    console.log(`[scanner-engine] Blocked ${symbol} ${direction.toUpperCase()} by zone filter: ${zoneCheck.reason}`);
    return null;
  }

  return candidateSetup;
}

export function analyzePotentialTrade(symbol: string, candles: Candle[]): PotentialTradeSetup | null {
  if (candles.length < MIN_SCANNER_ANALYSIS_CANDLES) return null;

  const trend = detectTrend(candles);
  const currentPrice = candles[candles.length - 1].close;
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, currentPrice);
  const gaps = buildFairValueGaps(lookLeftCandles, currentPrice);
  const currentZone = findActiveReversalZone(currentPrice, zones, candles);
  const bullishReversalPattern = resolveBullishReversalPattern(currentPrice, currentZone, candles);
  const bearishReversalPattern = resolveBearishReversalPattern(currentPrice, currentZone, candles);
  const bullishReversal = bullishReversalPattern.matched;
  const bearishReversal = bearishReversalPattern.matched;

  const candidates = analyzePotentialTrades(symbol, candles, {
    trend,
    currentPrice,
    zones,
    gaps,
    currentZone,
    bullishReversal,
    bearishReversal,
  });

  return candidates[0] ?? null;
}

interface AnalyzePotentialTradeContext {
  trend: TrendDirection;
  broaderTrend?: TrendDirection;
  emaTrend?: EmaTrendContext;
  currentPrice: number;
  zones: PriceZone[];
  gaps: FairValueGap[];
  currentZone: PriceZone | null;
  bullishReversal: boolean;
  bearishReversal: boolean;
  bullishPoiReclaim?: boolean;
  bearishPoiReclaim?: boolean;
}

export function analyzePotentialTrades(
  symbol: string,
  candles: Candle[],
  context?: AnalyzePotentialTradeContext,
): PotentialTradeSetup[] {
  if (candles.length < MIN_SCANNER_ANALYSIS_CANDLES) return [];

  const trend = context?.trend ?? detectTrend(candles);
  const broaderTrend = context?.broaderTrend ?? detectContextTrend(candles);
  const emaTrend = context?.emaTrend ?? analyzeEmaTrend(candles);
  const macroTrend = detectMacroTrend(candles, emaTrend);
  const currentPrice = context?.currentPrice ?? candles[candles.length - 1].close;
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = context?.zones ?? buildZones(lookLeftCandles, currentPrice);
  const gaps = context?.gaps ?? buildFairValueGaps(lookLeftCandles, currentPrice);
  const currentZone = context?.currentZone ?? findActiveReversalZone(currentPrice, zones, candles);
  const bullishReversal = context?.bullishReversal ?? resolveBullishReversalPattern(currentPrice, currentZone, candles).matched;
  const bearishReversal = context?.bearishReversal ?? resolveBearishReversalPattern(currentPrice, currentZone, candles).matched;
  const rangeCandidate = buildSupportResistanceRangePotential(symbol, candles, broaderTrend, emaTrend);
  const bullishArea = toPriceArea(findDirectionalZone('buy', zones, currentPrice, candles, symbol) ?? findDirectionalFvg('buy', gaps, candles, symbol));
  const bearishArea = toPriceArea(findDirectionalZone('sell', zones, currentPrice, candles, symbol) ?? findDirectionalFvg('sell', gaps, candles, symbol));
  const bullishPoiReclaim = context?.bullishPoiReclaim ?? hasPoiReclaim('buy', bullishArea, candles);
  const bearishPoiReclaim = context?.bearishPoiReclaim ?? hasPoiReclaim('sell', bearishArea, candles);

  // Macro ranging → only range candidates (buy support, sell resistance)
  if (macroTrend === 'ranging') {
    if (trend === 'ranging' && !bullishReversal && !bearishReversal) {
      return rangeCandidate ? [rangeCandidate] : [];
    }

    const candidates: PotentialTradeSetup[] = [];
    if (rangeCandidate) candidates.push(rangeCandidate);

    // In ranging macro, allow micro-trend direction as a secondary candidate
    const microDirection = bullishReversal
      ? 'buy' as const
      : bearishReversal
        ? 'sell' as const
        : trend === 'bullish'
          ? 'buy' as const
          : trend === 'bearish'
            ? 'sell' as const
            : null;

    if (microDirection) {
      const microCandidate = buildPotentialCandidate({
        symbol, candles, trend, broaderTrend, macroTrend, emaTrend, currentPrice,
        zones, gaps, currentZone, direction: microDirection, mode: 'trend',
        bullishReversal, bearishReversal, bullishPoiReclaim, bearishPoiReclaim,
      });
      if (microCandidate) candidates.push(microCandidate);
    }

    return candidates
      .filter((c, i, a) => a.findIndex(x => x.direction === c.direction && x.strategy === c.strategy) === i)
      .sort((a, b) => b.activationProbability - a.activationProbability);
  }

  const macroDirection: 'buy' | 'sell' = macroTrend === 'bullish' ? 'buy' : 'sell';
  const counterDirection: 'buy' | 'sell' = macroDirection === 'buy' ? 'sell' : 'buy';

  const candidates: PotentialTradeSetup[] = [];

  const trendCandidate = buildPotentialCandidate({
    symbol, candles, trend, broaderTrend, macroTrend, emaTrend, currentPrice,
    zones, gaps, currentZone, direction: macroDirection, mode: 'trend',
    bullishReversal, bearishReversal, bullishPoiReclaim, bearishPoiReclaim,
  });
  if (trendCandidate) candidates.push(trendCandidate);

  const counterCandidate = buildPotentialCandidate({
    symbol, candles, trend, broaderTrend, macroTrend, emaTrend, currentPrice,
    zones, gaps, currentZone, direction: counterDirection, mode: 'counter',
    bullishReversal, bearishReversal, bullishPoiReclaim, bearishPoiReclaim,
  });
  if (counterCandidate) candidates.push(counterCandidate);

  return candidates
    .filter((c, i, a) => a.findIndex(x => x.direction === c.direction && x.strategy === c.strategy) === i)
    .sort((left, right) => {
      const leftAligned = left.direction === macroDirection ? 1 : 0;
      const rightAligned = right.direction === macroDirection ? 1 : 0;
      if (leftAligned !== rightAligned) {
        return rightAligned - leftAligned;
      }

      return right.activationProbability - left.activationProbability;
    });
}
