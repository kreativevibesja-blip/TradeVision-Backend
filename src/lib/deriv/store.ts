export interface TickPoint {
  price: number;
  time: number;
}

type TickListener = (tick: { logicalSymbol: string; price: number; time: number }) => void;

const derivToLogicalSymbol = new Map<string, string>();
const tickListeners = new Set<TickListener>();

export function registerTrackedDerivSymbol(logicalSymbol: string, derivSymbol: string) {
  derivToLogicalSymbol.set(derivSymbol, logicalSymbol);
}

export function getLogicalSymbolForDerivSymbol(derivSymbol: string) {
  return derivToLogicalSymbol.get(derivSymbol);
}

export function handleTick(tick: { symbol: string; quote: number; epoch: number }) {
  const logicalSymbol = derivToLogicalSymbol.get(tick.symbol);
  if (!logicalSymbol) {
    return;
  }

  for (const listener of tickListeners) {
    listener({
      logicalSymbol,
      price: Number(tick.quote),
      time: Number(tick.epoch),
    });
  }
}

export function subscribeToTicks(listener: TickListener) {
  tickListeners.add(listener);

  return () => {
    tickListeners.delete(listener);
  };
}

