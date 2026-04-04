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

export interface TradeSetup {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit2: number;
  score: number;
  confidenceScore: number;
  strategy: string;
  confirmations: SetupConfirmations;
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
  takeProfit: number;
  takeProfit2: number;
  activationProbability: number;
  strategy: string;
  narrative: string;
  fulfilledConditions: string[];
  requiredTriggers: string[];
  contextLabels: string[];
}

// ── 1. Trend Detection ──
// Counts higher-highs/higher-lows vs lower-highs/lower-lows
// over the last 20 candles to classify the trend.

export function detectTrend(candles: Candle[]): TrendDirection {
  if (candles.length < 21) return 'ranging';

  const recent = candles.slice(-20);

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

  if (higherHighs > 10 && higherLows > 10) return 'bullish';
  if (lowerHighs > 10 && lowerLows > 10) return 'bearish';

  return 'ranging';
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
}

function isVolatilitySymbol(symbol: string): boolean {
  return /^R_\d+$/.test(symbol) || /^1HZ\d+V$/i.test(symbol);
}

function isForexSymbol(symbol: string): boolean {
  return /^[A-Z]{6}$/.test(symbol) && !['XAUUSD', 'BTCUSD'].includes(symbol);
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
  };
}

function computeStopLoss(symbol: string, direction: 'buy' | 'sell', candles: Candle[]): number {
  const profile = getSymbolRiskProfile(symbol);
  const recent = candles.slice(-profile.structureLookback);
  const last = candles[candles.length - 1];
  const atr = computeAtr(candles, profile.atrPeriod);
  const averageRange = average(recent.map((c) => c.high - c.low));
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, last.close);
  const gaps = buildFairValueGaps(lookLeftCandles, last.close);
  const directionalZone = findDirectionalZone(direction, zones, last.close);
  const directionalFvg = findDirectionalFvg(direction, gaps);

  const zoneBuffer = (areaTop: number, areaBottom: number) => {
    const areaHeight = Math.max(Math.abs(areaTop - areaBottom), 0.0001);
    return Math.max(
      atr * 0.18,
      averageRange * 0.12,
      areaHeight * 0.18,
      last.close * Math.max(profile.bufferPriceRatio * 0.35, 0.00008),
    );
  };

  if (directionalZone) {
    const buffer = zoneBuffer(directionalZone.top, directionalZone.bottom);
    return direction === 'buy'
      ? directionalZone.bottom - buffer
      : directionalZone.top + buffer;
  }

  if (directionalFvg) {
    const buffer = zoneBuffer(directionalFvg.top, directionalFvg.bottom);
    return direction === 'buy'
      ? Math.min(directionalFvg.bottom, directionalFvg.top) - buffer
      : Math.max(directionalFvg.top, directionalFvg.bottom) + buffer;
  }

  if (direction === 'buy') {
    const swingLow = Math.min(...recent.map((c) => c.low));
    const structuralDistance = Math.abs(last.close - swingLow);
    const minDistance = Math.max(
      atr * profile.minStopAtrMultiplier,
      averageRange * profile.minStopRangeMultiplier,
      last.close * profile.minStopPriceRatio,
    );
    const buffer = Math.max(
      atr * profile.bufferAtrMultiplier,
      averageRange * profile.bufferRangeMultiplier,
      last.close * profile.bufferPriceRatio,
    );

    const stopDistance = Math.max(structuralDistance + buffer, minDistance);
    return last.close - stopDistance;
  }

  const swingHigh = Math.max(...recent.map((c) => c.high));
  const structuralDistance = Math.abs(swingHigh - last.close);
  const minDistance = Math.max(
    atr * profile.minStopAtrMultiplier,
    averageRange * profile.minStopRangeMultiplier,
    last.close * profile.minStopPriceRatio,
  );
  const buffer = Math.max(
    atr * profile.bufferAtrMultiplier,
    averageRange * profile.bufferRangeMultiplier,
    last.close * profile.bufferPriceRatio,
  );

  const stopDistance = Math.max(structuralDistance + buffer, minDistance);
  return last.close + stopDistance;
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

function findDirectionalZone(direction: 'buy' | 'sell', zones: PriceZone[], currentPrice: number): PriceZone | null {
  const matchingZones = zones.filter((zone) => {
    if (direction === 'buy') {
      return zone.type === 'demand' && zone.top <= currentPrice * 1.01;
    }

    return zone.type === 'supply' && zone.bottom >= currentPrice * 0.99;
  });

  return matchingZones.sort((left, right) => {
    const rightIndex = right.originIndex ?? -1;
    const leftIndex = left.originIndex ?? -1;
    if (rightIndex !== leftIndex) {
      return rightIndex - leftIndex;
    }

    return left.distanceToPrice - right.distanceToPrice;
  })[0] ?? null;
}

function findDirectionalFvg(direction: 'buy' | 'sell', gaps: FairValueGap[]): FairValueGap | null {
  return gaps
    .filter((gap) => (direction === 'buy' ? gap.type === 'bullish' : gap.type === 'bearish'))
    .sort((left, right) => {
      const rightIndex = right.originIndex ?? -1;
      const leftIndex = left.originIndex ?? -1;
      if (rightIndex !== leftIndex) {
        return rightIndex - leftIndex;
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
  if (candles.length < 30) return null;

  const trend = detectTrend(candles);
  if (trend === 'ranging') return null;

  const direction: 'buy' | 'sell' = trend === 'bullish' ? 'buy' : 'sell';
  const currentPrice = candles[candles.length - 1].close;
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, currentPrice);
  const gaps = buildFairValueGaps(lookLeftCandles, currentPrice);
  const directionalZone = findDirectionalZone(direction, zones, currentPrice);
  const directionalFvg = findDirectionalFvg(direction, gaps);
  const preferredArea = toPriceArea(directionalZone ?? directionalFvg);

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
  const freshDisplacement = hasFreshDisplacement(direction, candles);
  const stretchedFromArea = isExtendedFromArea(direction, currentPrice, preferredArea, candles);

  if (sweep && !alignedSweep) return null;
  if (engulfing && !alignedEngulfing) return null;
  if (rejection && !alignedRejection) return null;
  if (structure && !alignedStructure) return null;
  if (!directionalZone && !directionalFvg) return null;
  if (stretchedFromArea && !freshDisplacement) return null;

  const directionalConfirmationCount = [alignedSweep, alignedEngulfing, alignedRejection, alignedStructure, alignedMomentum]
    .filter(Boolean)
    .length;

  if (directionalConfirmationCount < 2) return null;
  if (!alignedEngulfing && !alignedRejection && !alignedStructure) return null;

  // Liquidity sweeps need actual reversal confirmation before the scanner fires.
  if (alignedSweep && !alignedEngulfing && !alignedStructure) return null;

  // If the local tape is still moving against the setup, do not force an entry from the higher-level trend.
  if (!alignedMomentum && !alignedStructure && !alignedEngulfing) return null;

  // Favor the same setup family shown in the winning examples: reaction from a clean area, then displacement.
  if (!freshReaction && !alignedSweep && !alignedRejection && !alignedEngulfing) return null;
  if (!freshDisplacement && !alignedStructure && !alignedEngulfing) return null;

  const entry = last.close;
  const stopLoss = computeStopLoss(symbol, direction, candles);
  const takeProfit = computeTakeProfit(direction, entry, stopLoss);
  const takeProfit2 = computeSecondaryTakeProfit(direction, entry, stopLoss);

  // Sanity: TP must be in the right direction
  if (direction === 'buy' && takeProfit <= entry) return null;
  if (direction === 'sell' && takeProfit >= entry) return null;
  if (direction === 'buy' && takeProfit2 <= takeProfit) return null;
  if (direction === 'sell' && takeProfit2 >= takeProfit) return null;

  // Sanity: SL must be on the correct side
  if (direction === 'buy' && stopLoss >= entry) return null;
  if (direction === 'sell' && stopLoss <= entry) return null;

  const confirmations: SetupConfirmations = { sweep, engulfing, rejection, structure };

  const candidateSetup: TradeSetup = {
    symbol,
    direction,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    score,
    confidenceScore: scoreToConfidence(score),
    strategy: deriveStrategy(direction, sweep),
    confirmations,
    confirmationLabels: buildConfirmationLabels(confirmations),
  };

  const zoneCheck = zoneFilter(candidateSetup, candles);
  if (!zoneCheck.valid) {
    console.log(`[scanner-engine] Blocked ${symbol} ${direction.toUpperCase()} by zone filter: ${zoneCheck.reason}`);
    return null;
  }

  return candidateSetup;
}

export function analyzePotentialTrade(symbol: string, candles: Candle[]): PotentialTradeSetup | null {
  if (candles.length < 30) return null;

  const trend = detectTrend(candles);
  if (trend === 'ranging') return null;

  const direction: 'buy' | 'sell' = trend === 'bullish' ? 'buy' : 'sell';
  const currentPrice = candles[candles.length - 1].close;
  const lookLeftCandles = candles.slice(-Math.min(500, candles.length));
  const zones = buildZones(lookLeftCandles, currentPrice);
  const gaps = buildFairValueGaps(lookLeftCandles, currentPrice);
  const directionalZone = findDirectionalZone(direction, zones, currentPrice);
  const directionalFvg = findDirectionalFvg(direction, gaps);
  const preferredArea = toPriceArea(directionalZone ?? directionalFvg);
  const pullback = detectPullback(trend, candles);
  const sweep = detectLiquiditySweep(candles);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const engulfing = detectEngulfing(prev, last);
  const rejection = detectRejection(last);
  const structure = detectStructureBreak(candles);

  const alignedSweep = isSweepAligned(direction, sweep);
  const alignedRejection = isRejectionAligned(direction, rejection);
  const alignedEngulfing = isEngulfingAligned(direction, engulfing);
  const alignedStructure = isStructureAligned(direction, structure);
  const recentMomentum = detectRecentMomentum(candles);
  const alignedMomentum = (direction === 'buy' && recentMomentum === 'bullish') || (direction === 'sell' && recentMomentum === 'bearish');
  const freshReaction = isDirectionalReactionFromArea(direction, preferredArea, candles);
  const freshDisplacement = hasFreshDisplacement(direction, candles);
  const stretchedFromArea = isExtendedFromArea(direction, currentPrice, preferredArea, candles);

  let probability = 20;
  if (pullback) probability += 15;
  if (directionalZone) probability += 20;
  if (directionalFvg) probability += 10;
  if (freshReaction) probability += 12;
  if (freshDisplacement) probability += 8;
  if (alignedSweep) probability += 10;
  if (alignedRejection) probability += 10;
  if (alignedEngulfing) probability += 10;
  if (alignedStructure) probability += 5;
  if (alignedMomentum) probability += 5;
  if (stretchedFromArea) probability -= 15;

  if (!directionalZone && !directionalFvg && !pullback) {
    return null;
  }

  if (probability < 35) {
    return null;
  }

  const fulfilledConditions: string[] = [trend === 'bullish' ? 'Bullish trend context' : 'Bearish trend context'];
  const requiredTriggers: string[] = [];
  const contextLabels: string[] = [];

  if (directionalZone) {
    fulfilledConditions.push(direction === 'buy' ? 'Price is near demand/support zone' : 'Price is near supply/resistance zone');
    contextLabels.push(direction === 'buy' ? 'Near demand/support' : 'Near supply/resistance');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Price revisit into demand/support zone' : 'Price revisit into supply/resistance zone');
  }

  if (directionalFvg) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish FVG in play' : 'Bearish FVG in play');
    contextLabels.push(direction === 'buy' ? 'Bullish FVG nearby' : 'Bearish FVG nearby');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Bullish FVG retest or demand reaction' : 'Bearish FVG retest or supply reaction');
  }

  if (pullback) {
    fulfilledConditions.push('Pullback location is developing');
    contextLabels.push('Pullback structure intact');
  } else {
    requiredTriggers.push('Cleaner pullback into value area');
  }

  if (freshReaction) {
    fulfilledConditions.push(direction === 'buy' ? 'Fresh demand reaction confirmed' : 'Fresh supply reaction confirmed');
    contextLabels.push(direction === 'buy' ? 'Fresh bullish reaction' : 'Fresh bearish reaction');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Clean bullish reaction from the POI' : 'Clean bearish reaction from the POI');
  }

  if (freshDisplacement) {
    fulfilledConditions.push(direction === 'buy' ? 'Bullish displacement is underway' : 'Bearish displacement is underway');
    contextLabels.push(direction === 'buy' ? 'Displacement up' : 'Displacement down');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Stronger bullish displacement candle' : 'Stronger bearish displacement candle');
  }

  if (stretchedFromArea) {
    requiredTriggers.push(direction === 'buy' ? 'Retest closer to demand/FVG before entry' : 'Retest closer to supply/FVG before entry');
  }

  if (alignedSweep) {
    fulfilledConditions.push(direction === 'buy' ? 'Sell-side liquidity sweep printed' : 'Buy-side liquidity sweep printed');
  } else {
    requiredTriggers.push(direction === 'buy' ? 'Sell-side liquidity sweep or zone reaction' : 'Buy-side liquidity sweep or zone reaction');
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
    requiredTriggers.push(direction === 'buy' ? 'Bullish micro BOS / momentum shift' : 'Bearish micro BOS / momentum shift');
  }

  const entry = currentPrice;
  const stopLoss = computeStopLoss(symbol, direction, candles);
  const takeProfit = computeTakeProfit(direction, entry, stopLoss);
  const takeProfit2 = computeSecondaryTakeProfit(direction, entry, stopLoss);

  return {
    symbol,
    direction,
    currentPrice,
    entry,
    stopLoss,
    takeProfit,
    takeProfit2,
    activationProbability: Math.min(95, probability),
    strategy: `${deriveStrategy(direction, sweep)} Watchlist`,
    narrative: buildPotentialNarrative(direction, currentPrice, contextLabels, requiredTriggers.slice(0, 3)),
    fulfilledConditions,
    requiredTriggers,
    contextLabels,
  };
}
