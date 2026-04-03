export interface TickPoint {
  price: number;
  time: number;
}

const tickStore: Record<string, TickPoint[]> = {};
const derivToLogicalSymbol = new Map<string, string>();

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
}
