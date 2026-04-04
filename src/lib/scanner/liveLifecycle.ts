import { subscribeToTicks } from '../deriv/store';
import { scheduleScannerPanelRefreshForAllUsers } from './panelStream';
import { processLivePriceUpdate } from '../../services/scannerService';

const SYMBOL_DEBOUNCE_MS = 750;

let started = false;
const latestPrices = new Map<string, { currentPrice: number; lowPrice: number; highPrice: number }>();
const scheduledSymbols = new Set<string>();

async function flushSymbol(symbol: string) {
  scheduledSymbols.delete(symbol);
  const priceWindow = latestPrices.get(symbol);
  latestPrices.delete(symbol);
  scheduleScannerPanelRefreshForAllUsers();
  if (priceWindow == null) {
    return;
  }

  try {
    const updates = await processLivePriceUpdate(symbol, priceWindow);
    if (updates > 0) {
      console.log(`[scanner-live-lifecycle] ${symbol} processed ${updates} live trade update(s)`);
    }
  } catch (error) {
    console.error(`[scanner-live-lifecycle] failed for ${symbol}:`, error);
  }
}

export function startLiveLifecycleMonitor() {
  if (started) {
    return;
  }

  started = true;

  subscribeToTicks(({ logicalSymbol, price }) => {
    const existing = latestPrices.get(logicalSymbol);
    latestPrices.set(logicalSymbol, existing
      ? {
          currentPrice: price,
          lowPrice: Math.min(existing.lowPrice, price),
          highPrice: Math.max(existing.highPrice, price),
        }
      : {
          currentPrice: price,
          lowPrice: price,
          highPrice: price,
        });

    if (scheduledSymbols.has(logicalSymbol)) {
      return;
    }

    scheduledSymbols.add(logicalSymbol);
    setTimeout(() => {
      void flushSymbol(logicalSymbol);
    }, SYMBOL_DEBOUNCE_MS);
  });

  console.log(`[scanner-live-lifecycle] started (debounce ${SYMBOL_DEBOUNCE_MS}ms)`);
}
