import {
  getAllActiveTrackedTrades,
  updateTrackedTradeState,
  type TrackedTradeRecord,
  type TrackedTradeState,
} from '../lib/supabase';
import { sendPushToUser } from './pushService';
import { fetchLiveQuoteForSymbol, type LiveMarketQuote } from './marketData';
import { subscribeToTicks } from '../lib/deriv/store';
import { VOLATILITY_SCANNER_SYMBOL_IDS } from '../lib/deriv/symbols';

const TICK_INTERVAL_MS = 10_000; // 10 seconds — kinder to the market data API
let intervalId: ReturnType<typeof setInterval> | null = null;
let unsubDerivTicks: (() => void) | null = null;

/** Live price cache fed by Deriv WebSocket ticks */
const derivPriceCache = new Map<string, { price: number; time: number }>();

/** Set of volatility/synthetic symbol IDs for quick lookup (normalized) */
const VOLATILITY_SYMBOLS = new Set<string>(
  (VOLATILITY_SCANNER_SYMBOL_IDS as readonly string[]).map((s) => s.replace(/[/\s\-_]/g, '').toUpperCase()),
);

const stateLabels: Record<TrackedTradeState, string> = {
  TRACKING: 'being tracked',
  READY: 'READY — price approaching entry zone',
  ACTIVE: 'ACTIVE — price inside entry zone',
  INVALID: 'INVALIDATED — stop loss breached',
  EXPIRED: 'EXPIRED',
};

/** Normalize a pair like "EUR/USD" → "EURUSD" for the market data API */
function normalizePairId(symbol: string): string {
  return symbol.replace(/[/\s\-_]/g, '').toUpperCase();
}

/** Check if a symbol is a Deriv volatility index */
function isVolatilitySymbol(symbol: string): boolean {
  const norm = symbol.replace(/[/\s\-_]/g, '').toUpperCase();
  return VOLATILITY_SYMBOLS.has(norm);
}

/** Get live price for a volatility symbol from Deriv tick cache */
function getDerivLivePrice(symbol: string): number | null {
  const norm = symbol.replace(/[/\s\-_]/g, '').toUpperCase();
  const cached = derivPriceCache.get(norm);
  if (!cached) return null;
  // Consider stale if older than 30 seconds
  if (Date.now() - cached.time * 1000 > 30_000) return null;
  return cached.price;
}

async function notifyStateChange(trade: TrackedTradeRecord, newState: TrackedTradeState, price?: number) {
  if (newState === 'TRACKING') return;
  try {
    const priceStr = price != null ? ` @ ${price}` : '';
    await sendPushToUser(trade.userId, {
      title: `🎯 ${trade.symbol} Radar Alert`,
      body: `${stateLabels[newState]}${priceStr}`,
      tag: `radar-${trade.id}`,
      url: '/dashboard/radar',
    });
  } catch (err) {
    console.error(`Radar push failed for ${trade.id}:`, err);
  }
}

/**
 * Evaluate new state based on live price vs the trade's entry zone, SL, and TP.
 *
 * State machine:
 *   TRACKING → price within 0.3% of zone edge  → READY
 *   TRACKING → price enters zone               → ACTIVE (skip READY)
 *   READY    → price enters zone               → ACTIVE
 *   READY    → price moves away (>0.5% beyond) → back to TRACKING
 *   Any      → price crosses SL side           → INVALID
 *   Any      → price crosses TP side           → ACTIVE (let user manage exit)
 *   Any      → expired                         → EXPIRED
 */
function evaluateState(
  trade: TrackedTradeRecord,
  price: number,
  now: Date,
): TrackedTradeState | null {
  // Check expiry first
  if (new Date(trade.expiresAt) <= now) {
    return trade.state !== 'EXPIRED' ? 'EXPIRED' : null;
  }

  const { entryZoneMin, entryZoneMax, stopLoss, takeProfit1, direction } = trade;
  const zoneRange = Math.abs(entryZoneMax - entryZoneMin) || entryZoneMax * 0.001;

  // Is price inside the entry zone?
  const inZone = price >= entryZoneMin && price <= entryZoneMax;

  // How close is price to the nearest zone edge? (as ratio of zone width)
  const distToZone = inZone
    ? 0
    : Math.min(Math.abs(price - entryZoneMin), Math.abs(price - entryZoneMax));
  const proximityRatio = distToZone / zoneRange;

  // Check for SL breach
  const slBreached =
    direction === 'buy'
      ? price <= stopLoss
      : price >= stopLoss;

  if (slBreached && trade.state !== 'INVALID') {
    return 'INVALID';
  }

  // Check for TP hit — transition to ACTIVE so user sees it hit target
  const tpHit =
    direction === 'buy'
      ? price >= takeProfit1
      : price <= takeProfit1;

  if (tpHit && trade.state !== 'ACTIVE') {
    return 'ACTIVE';
  }

  // State transitions based on price proximity to entry zone
  if (trade.state === 'TRACKING') {
    if (inZone) return 'ACTIVE';
    // Price within 30% of zone width from the edge → READY
    if (proximityRatio <= 0.3) return 'READY';
    return null;
  }

  if (trade.state === 'READY') {
    if (inZone) return 'ACTIVE';
    // Price moved far away (>5x zone width) → back to TRACKING
    if (proximityRatio > 5) return 'TRACKING';
    return null;
  }

  // ACTIVE trades stay ACTIVE — user manages the exit
  return null;
}

// Cache quotes per tick to avoid duplicate API calls for same symbol
async function fetchQuoteBatch(symbols: string[]): Promise<Map<string, LiveMarketQuote>> {
  const unique = [...new Set(symbols)];
  const results = new Map<string, LiveMarketQuote>();

  await Promise.allSettled(
    unique.map(async (sym) => {
      try {
        const quote = await fetchLiveQuoteForSymbol(sym);
        results.set(sym, quote);
      } catch {
        // Symbol may not be supported for live quotes (e.g. Deriv synthetics)
      }
    }),
  );

  return results;
}

async function tick() {
  try {
    const trades = await getAllActiveTrackedTrades();
    if (trades.length === 0) return;

    const now = new Date();

    // 1. Separate volatility trades (Deriv WS) from forex/index trades (TwelveData)
    const forexTrades: { trade: TrackedTradeRecord; symId: string }[] = [];
    const volTrades: { trade: TrackedTradeRecord; price: number | null }[] = [];

    for (const trade of trades) {
      if (isVolatilitySymbol(trade.symbol)) {
        volTrades.push({ trade, price: getDerivLivePrice(trade.symbol) });
      } else {
        forexTrades.push({ trade, symId: normalizePairId(trade.symbol) });
      }
    }

    // 2. Batch fetch TwelveData quotes for forex/index symbols
    const forexSymIds = forexTrades.map((t) => t.symId);
    const quotes = forexSymIds.length > 0 ? await fetchQuoteBatch(forexSymIds) : new Map<string, LiveMarketQuote>();

    // 3. Evaluate all trades
    const updates: Promise<void>[] = [];

    // Forex/index trades — use TwelveData
    for (const { trade, symId } of forexTrades) {
      const quote = quotes.get(symId);
      let newState: TrackedTradeState | null = null;

      if (quote) {
        newState = evaluateState(trade, quote.price, now);
      } else {
        if (new Date(trade.expiresAt) <= now && trade.state !== 'EXPIRED') {
          newState = 'EXPIRED';
        }
      }

      if (newState && newState !== trade.state) {
        const price = quote?.price;
        updates.push(
          updateTrackedTradeState(trade.id, newState)
            .then(() => notifyStateChange(trade, newState!, price))
            .catch((err) => console.error(`Radar update failed for ${trade.id}:`, err)),
        );
      }
    }

    // Volatility trades — use Deriv WS live prices
    for (const { trade, price } of volTrades) {
      let newState: TrackedTradeState | null = null;

      if (price != null) {
        newState = evaluateState(trade, price, now);
      } else {
        if (new Date(trade.expiresAt) <= now && trade.state !== 'EXPIRED') {
          newState = 'EXPIRED';
        }
      }

      if (newState && newState !== trade.state) {
        updates.push(
          updateTrackedTradeState(trade.id, newState)
            .then(() => notifyStateChange(trade, newState!, price ?? undefined))
            .catch((err) => console.error(`Radar update failed for ${trade.id}:`, err)),
        );
      }
    }

    if (updates.length > 0) {
      await Promise.allSettled(updates);
    }
  } catch (err) {
    console.error('Radar tracking tick error:', err);
  }
}

export function startRadarTracker() {
  if (intervalId) return;

  // Subscribe to Deriv WS ticks to cache live volatility prices
  unsubDerivTicks = subscribeToTicks(({ logicalSymbol, price, time }) => {
    const norm = logicalSymbol.replace(/[/\s\-_]/g, '').toUpperCase();
    if (VOLATILITY_SYMBOLS.has(norm)) {
      derivPriceCache.set(norm, { price, time });
    }
  });

  console.log('Trade Radar tracker started (10s interval, live market data + Deriv WS)');
  intervalId = setInterval(tick, TICK_INTERVAL_MS);
}

export function stopRadarTracker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (unsubDerivTicks) {
    unsubDerivTicks();
    unsubDerivTicks = null;
  }
  derivPriceCache.clear();
}
