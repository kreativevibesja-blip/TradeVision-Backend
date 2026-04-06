// ============================================================
// Dynamic Cooldown Engine
// Adaptive cooldowns, continuation allowances, confidence gates
// ============================================================

export type TradeResult = 'tp' | 'sl' | null;

interface CooldownInput {
  symbol: string;
  result: TradeResult;
}

interface ContinuationInput {
  lastDirection: 'buy' | 'sell';
  lastResult: TradeResult;
  newDirection: 'buy' | 'sell';
  confidenceScore: number;
}

interface PostFirstTradeFilterInput {
  sessionTradeCount: number;
  confidenceScore: number;
}

// ── Symbol classification ──

function isFastIndex(symbol: string): boolean {
  return /^1HZ\d+V$/i.test(symbol);
}

function isVolatilityIndex(symbol: string): boolean {
  return /^R_\d+$/.test(symbol) || isFastIndex(symbol);
}

// ── Dynamic cooldown (minutes) ──
// Fast indices get longer cooldowns — they move fast, bigger risk of revenge trading.
// Wins get shorter cooldowns — the trend may still be running.
// Losses get longer cooldowns — force a reset before re-entering.

export function getCooldownMinutes({ symbol, result }: CooldownInput): number {
  if (isFastIndex(symbol)) {
    if (result === 'sl') return 120;
    if (result === 'tp') return 75;
    return 90; // invalidated/expired — moderate cooldown
  }

  if (isVolatilityIndex(symbol)) {
    if (result === 'sl') return 90;
    if (result === 'tp') return 45;
    return 60;
  }

  // Forex / commodities / indices
  if (result === 'sl') return 90;
  if (result === 'tp') return 45;
  return 60;
}

// ── Cooldown check ──

export function isSymbolOnCooldown(
  closedAt: string | null,
  cooldownMinutes: number,
  now: Date = new Date(),
): boolean {
  if (!closedAt) return false;

  const closedMs = new Date(closedAt).getTime();
  if (Number.isNaN(closedMs)) return false;

  const diffMinutes = (now.getTime() - closedMs) / 60_000;
  return diffMinutes < cooldownMinutes;
}

// ── Continuation logic ──
// After a WIN, allow another trade on the same symbol if it's the same
// direction and the new signal is high-confidence (≥ 7).
// This captures trend continuations without blindly re-entering.

export function allowContinuation({
  lastDirection,
  lastResult,
  newDirection,
  confidenceScore,
}: ContinuationInput): boolean {
  // Only continue after wins
  if (lastResult !== 'tp') return false;

  // Must be same direction (trend continuation, not reversal)
  if (newDirection !== lastDirection) return false;

  // Must be a strong setup
  return confidenceScore >= 7;
}

// ── Confidence gate after first trade in session ──
// Once we've already taken a trade in this session,
// raise the bar — only high-quality setups pass.

const POST_FIRST_TRADE_CONFIDENCE_THRESHOLD = 7;

export function passesPostFirstTradeFilter({
  sessionTradeCount,
  confidenceScore,
}: PostFirstTradeFilterInput): boolean {
  if (sessionTradeCount < 1) return true; // no prior trades this session
  return confidenceScore >= POST_FIRST_TRADE_CONFIDENCE_THRESHOLD;
}
