import { subscribeToTicks } from '../deriv/store';
import { processLivePriceUpdate } from '../../services/scannerService';

const SYMBOL_DEBOUNCE_MS = 750;

let started = false;
const latestPrices = new Map<string, number>();
const scheduledSymbols = new Set<string>();

async function flushSymbol(symbol: string) {
  scheduledSymbols.delete(symbol);
  const price = latestPrices.get(symbol);
  if (price == null) {
    return;
  }

  try {
    const updates = await processLivePriceUpdate(symbol, price);
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
    latestPrices.set(logicalSymbol, price);

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
