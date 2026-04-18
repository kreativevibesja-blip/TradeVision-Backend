import {
  getAllActiveTrackedTrades,
  updateTrackedTradeState,
  type TrackedTradeRecord,
  type TrackedTradeState,
} from '../lib/supabase';
import { sendPushToUser } from './pushService';
import { fetchLiveQuoteForSymbol, type LiveMarketQuote } from './marketData';

const TICK_INTERVAL_MS = 10_000; // 10 seconds — kinder to the market data API
let intervalId: ReturnType<typeof setInterval> | null = null;

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

    // 1. Collect unique symbols and fetch live prices in batch
    const symbolIds = trades.map((t) => normalizePairId(t.symbol));
    const quotes = await fetchQuoteBatch(symbolIds);

    // 2. Evaluate each trade against its live price
    const updates: Promise<void>[] = [];

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      const symId = symbolIds[i];
      const quote = quotes.get(symId);

      // If no live quote available, fall back to time-based expiry only
      let newState: TrackedTradeState | null = null;

      if (quote) {
        newState = evaluateState(trade, quote.price, now);
      } else {
        // No market data — only check expiry
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

    if (updates.length > 0) {
      await Promise.allSettled(updates);
    }
  } catch (err) {
    console.error('Radar tracking tick error:', err);
  }
}

export function startRadarTracker() {
  if (intervalId) return;
  console.log('Trade Radar tracker started (10s interval, live market data)');
  intervalId = setInterval(tick, TICK_INTERVAL_MS);
}

export function stopRadarTracker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
