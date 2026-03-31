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
  score: number;
  confidenceScore: number;
  strategy: string;
  confirmations: SetupConfirmations;
  confirmationLabels: string[];
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

function deriveStrategy(trend: TrendDirection, sweep: LiquiditySweep | null): string {
  if (sweep) {
    return trend === 'bullish'
      ? 'Bullish Liquidity Sweep Reversal'
      : 'Bearish Liquidity Sweep Reversal';
  }
  return trend === 'bullish'
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

function computeStopLoss(direction: 'buy' | 'sell', candles: Candle[]): number {
  const recent = candles.slice(-10);
  const last = candles[candles.length - 1];

  if (direction === 'buy') {
    // SL below the recent swing low with a small buffer
    const swingLow = Math.min(...recent.map((c) => c.low));
    const buffer = (last.close - swingLow) * 0.1;
    return swingLow - Math.max(buffer, last.close * 0.0005);
  }

  // SL above the recent swing high with a small buffer
  const swingHigh = Math.max(...recent.map((c) => c.high));
  const buffer = (swingHigh - last.close) * 0.1;
  return swingHigh + Math.max(buffer, last.close * 0.0005);
}

function computeTakeProfit(direction: 'buy' | 'sell', entry: number, stopLoss: number): number {
  const risk = Math.abs(entry - stopLoss);
  // 2:1 risk-reward ratio
  return direction === 'buy' ? entry + risk * 2 : entry - risk * 2;
}

// ── 8. Main Analysis Function (single symbol) ──
// Pure logic — no AI, no network calls. Just candles in, setup out.

export function analyzeMarket(symbol: string, candles: Candle[]): TradeSetup | null {
  if (candles.length < 30) return null;

  const trend = detectTrend(candles);
  if (trend === 'ranging') return null;

  const sweep = detectLiquiditySweep(candles);
  const pullback = detectPullback(trend, candles);

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  const engulfing = detectEngulfing(prev, last);
  const rejection = detectRejection(last);
  const structure = detectStructureBreak(candles);

  const score = scoreSetup({ trend, pullback, sweep, engulfing, rejection, structure });

  if (score < 5) return null;

  const direction: 'buy' | 'sell' = trend === 'bullish' ? 'buy' : 'sell';

  // Guard: confirmations should align with direction
  if (engulfing && engulfing !== trend) return null;
  if (rejection) {
    const rejectionAligned =
      (direction === 'buy' && rejection === 'bullish_rejection') ||
      (direction === 'sell' && rejection === 'bearish_rejection');
    if (!rejectionAligned) return null;
  }
  if (structure && structure !== trend) return null;

  const entry = last.close;
  const stopLoss = computeStopLoss(direction, candles);
  const takeProfit = computeTakeProfit(direction, entry, stopLoss);

  // Sanity: TP must be in the right direction
  if (direction === 'buy' && takeProfit <= entry) return null;
  if (direction === 'sell' && takeProfit >= entry) return null;

  // Sanity: SL must be on the correct side
  if (direction === 'buy' && stopLoss >= entry) return null;
  if (direction === 'sell' && stopLoss <= entry) return null;

  const confirmations: SetupConfirmations = { sweep, engulfing, rejection, structure };

  return {
    symbol,
    direction,
    entry,
    stopLoss,
    takeProfit,
    score,
    confidenceScore: scoreToConfidence(score),
    strategy: deriveStrategy(trend, sweep),
    confirmations,
    confirmationLabels: buildConfirmationLabels(confirmations),
  };
}
