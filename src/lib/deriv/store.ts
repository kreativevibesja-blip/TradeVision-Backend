export interface TickPoint {
  price: number;
  time: number;
}

type TickListener = (tick: { logicalSymbol: string; price: number; time: number }) => void;

const tickStore: Record<string, TickPoint[]> = {};
const derivToLogicalSymbol = new Map<string, string>();
const tickListeners = new Set<TickListener>();

export function registerTrackedDerivSymbol(logicalSymbol: string, derivSymbol: string) {
  derivToLogicalSymbol.set(derivSymbol, logicalSymbol);

  if (!tickStore[logicalSymbol]) {
    tickStore[logicalSymbol] = [];
  }
}

export function getTrackedLogicalSymbols() {
  return Object.keys(tickStore);
}

export function getTicksForSymbol(symbol: string): TickPoint[] {
  return tickStore[symbol] ?? [];
}

export function setTicksForSymbol(symbol: string, ticks: TickPoint[]) {
  tickStore[symbol] = ticks;
}

export function handleTick(tick: { symbol: string; quote: number; epoch: number }) {
  const logicalSymbol = derivToLogicalSymbol.get(tick.symbol);
  if (!logicalSymbol) {
    return;
  }

  if (!tickStore[logicalSymbol]) {
    tickStore[logicalSymbol] = [];
  }

  tickStore[logicalSymbol].push({
    price: Number(tick.quote),
    time: Number(tick.epoch),
  });

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

