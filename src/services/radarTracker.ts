import {
  getAllActiveTrackedTrades,
  updateTrackedTradeState,
  type TrackedTradeRecord,
  type TrackedTradeState,
} from '../lib/supabase';
import { sendPushToUser } from './pushService';

const TICK_INTERVAL_MS = 5000;
let intervalId: ReturnType<typeof setInterval> | null = null;

const stateLabels: Record<TrackedTradeState, string> = {
  TRACKING: 'being tracked',
  READY: 'READY for entry',
  ACTIVE: 'ACTIVE — entry triggered',
  INVALID: 'INVALIDATED',
  EXPIRED: 'EXPIRED',
};

async function notifyStateChange(trade: TrackedTradeRecord, newState: TrackedTradeState) {
  if (newState === 'TRACKING') return;
  try {
    await sendPushToUser(trade.userId, {
      title: `Trade Update: ${trade.symbol}`,
      body: `Setup is now ${stateLabels[newState]}`,
      tag: `radar-${trade.id}`,
      url: '/dashboard/radar',
    });
  } catch (err) {
    console.error(`Radar push failed for ${trade.id}:`, err);
  }
}

function evaluateState(trade: TrackedTradeRecord, now: Date): TrackedTradeState | null {
  if (new Date(trade.expiresAt) <= now) {
    return trade.state !== 'EXPIRED' ? 'EXPIRED' : null;
  }

  // Use a simulated price from the entry zone for now.
  // In production this would come from a market data feed.
  // The entryZone itself is used as the trigger boundary.
  const midEntry = (trade.entryZoneMin + trade.entryZoneMax) / 2;

  // Check invalidation: if SL is breached conceptually (time-based heuristic)
  const ageMs = now.getTime() - new Date(trade.createdAt).getTime();
  const expiryMs = new Date(trade.expiresAt).getTime() - new Date(trade.createdAt).getTime();
  const ageRatio = ageMs / expiryMs;

  if (trade.state === 'TRACKING') {
    // After 80% of time with no progress → INVALID
    if (ageRatio > 0.8) return 'INVALID';
    // After 40% of time → READY (simulates price approaching zone)
    if (ageRatio > 0.4) return 'READY';
    return null;
  }

  if (trade.state === 'READY') {
    if (ageRatio > 0.85) return 'INVALID';
    // After 60% of time → ACTIVE (simulates confirmation met)
    if (ageRatio > 0.6) return 'ACTIVE';
    return null;
  }

  return null;
}

async function tick() {
  try {
    const trades = await getAllActiveTrackedTrades();
    if (trades.length === 0) return;

    const now = new Date();

    // Batch process all trades
    const updates: Promise<void>[] = [];

    for (const trade of trades) {
      const newState = evaluateState(trade, now);
      if (newState && newState !== trade.state) {
        updates.push(
          updateTrackedTradeState(trade.id, newState)
            .then(() => notifyStateChange(trade, newState))
            .catch((err) => console.error(`Radar update failed for ${trade.id}:`, err))
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
  console.log('Trade Radar tracker started (5s interval)');
  intervalId = setInterval(tick, TICK_INTERVAL_MS);
}

export function stopRadarTracker() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
