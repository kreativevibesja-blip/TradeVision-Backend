import WebSocket from 'ws';
import { config } from '../../config';
import { type DerivedCandle } from './candles';
import { DERIV_SCANNER_SYMBOLS, type DerivScannerSymbolConfig } from './symbols';
import { getLogicalSymbolForDerivSymbol, handleTick, registerTrackedDerivSymbol } from './store';
import { updateCandlesForTick } from './updateCandle';

type PendingResolver = {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
};

type DerivActiveSymbol = {
  symbol: string;
  display_name?: string;
  market_display_name?: string;
  submarket_display_name?: string;
};

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingResolver>();
const requestedSymbols = new Set<string>();
const resolvedSymbols = new Map<string, string>();
const pendingSubscriptions = new Map<string, Promise<string>>();
let activeSymbolsCache: DerivActiveSymbol[] = [];
let pendingActiveSymbolsRequest: Promise<DerivActiveSymbol[]> | null = null;
let waitForOpenPromise: Promise<WebSocket> | null = null;
let resolveWaitForOpen: ((ws: WebSocket) => void) | null = null;
let rejectWaitForOpen: ((error: Error) => void) | null = null;

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

function buildWsUrl() {
  return `${config.deriv.wsUrl}?app_id=${config.deriv.appId}`;
}

function clearPendingRequests(error: Error) {
  for (const [, pending] of pendingRequests) {
    pending.reject(error);
  }
  pendingRequests.clear();
}

function resetWaitForOpen() {
  waitForOpenPromise = new Promise<WebSocket>((resolve, reject) => {
    resolveWaitForOpen = resolve;
    rejectWaitForOpen = reject;
  });
}

function waitForSocketOpen() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    return Promise.resolve(socket);
  }

  if (!waitForOpenPromise) {
    resetWaitForOpen();
  }

  return waitForOpenPromise!;
}

function sendRequest(ws: WebSocket, payload: Record<string, unknown>) {
  const reqId = nextRequestId++;

  return new Promise<any>((resolve, reject) => {
    pendingRequests.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

function resolveSymbolCode(configSymbol: DerivScannerSymbolConfig, activeSymbols: DerivActiveSymbol[]) {
  const aliases = configSymbol.aliases
    .map(normalize)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  let bestMatch: { symbol: string; score: number } | null = null;

  for (const activeSymbol of activeSymbols) {
    const searchable = [
      activeSymbol.symbol,
      activeSymbol.display_name ?? '',
      activeSymbol.market_display_name ?? '',
      activeSymbol.submarket_display_name ?? '',
    ]
      .map(normalize)
      .filter(Boolean);

    let score = -1;

    for (const alias of aliases) {
      for (const candidate of searchable) {
        if (candidate === alias) {
          score = Math.max(score, 1000 + alias.length);
          continue;
        }

        if (candidate.startsWith(alias) || alias.startsWith(candidate)) {
          score = Math.max(score, 700 + Math.min(alias.length, candidate.length));
          continue;
        }

        if (candidate.includes(alias)) {
          score = Math.max(score, 400 + alias.length);
        }
      }
    }

    if (score > (bestMatch?.score ?? -1)) {
      bestMatch = { symbol: activeSymbol.symbol, score };
    }
  }

  return bestMatch?.symbol ?? null;
}

async function getActiveSymbols(ws: WebSocket) {
  if (activeSymbolsCache.length > 0) {
    return activeSymbolsCache;
  }

  if (pendingActiveSymbolsRequest) {
    return pendingActiveSymbolsRequest;
  }

  pendingActiveSymbolsRequest = (async () => {
    const response = await sendRequest(ws, {
      active_symbols: 'brief',
      product_type: 'basic',
    });

    activeSymbolsCache = (response?.active_symbols ?? []) as DerivActiveSymbol[];
    return activeSymbolsCache;
  })().finally(() => {
    pendingActiveSymbolsRequest = null;
  });

  return pendingActiveSymbolsRequest;
}

function resolveRequestedSymbol(requestedSymbol: string, activeSymbols: DerivActiveSymbol[]) {
  const normalizedRequested = requestedSymbol.trim().toUpperCase();
  const exactMatch = activeSymbols.find((activeSymbol) => activeSymbol.symbol.trim().toUpperCase() === normalizedRequested);
  if (exactMatch) {
    return exactMatch.symbol;
  }

  const configSymbol = DERIV_SCANNER_SYMBOLS.find((symbol) => symbol.symbol === normalizedRequested);
  if (configSymbol) {
    const aliased = resolveSymbolCode(configSymbol, activeSymbols);
    if (aliased) {
      return aliased;
    }
  }

  return normalizedRequested;
}

async function subscribeSymbol(ws: WebSocket, requestedSymbol: string, retries = 2): Promise<string> {
  const normalizedSymbol = requestedSymbol.trim().toUpperCase();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const activeSymbols = await getActiveSymbols(ws);
      const derivSymbol = resolveRequestedSymbol(normalizedSymbol, activeSymbols);

      registerTrackedDerivSymbol(normalizedSymbol, derivSymbol);
      resolvedSymbols.set(normalizedSymbol, derivSymbol);

      ws.send(JSON.stringify({ ticks: derivSymbol, subscribe: 1 }));
      console.log(`[deriv-ws] subscribed ${normalizedSymbol} -> ${derivSymbol}`);
      return derivSymbol;
    } catch (error) {
      if (attempt < retries) {
        const delay = 1000 * (attempt + 1);
        console.warn(`[deriv-ws] subscription attempt ${attempt + 1} failed for ${normalizedSymbol}, retrying in ${delay}ms`);
        await new Promise<void>((r) => setTimeout(r, delay));
        ws = await waitForSocketOpen();
      } else {
        throw error;
      }
    }
  }

  throw new Error(`Failed to subscribe ${normalizedSymbol} after ${retries + 1} attempts`);
}

async function subscribeToSymbols(ws: WebSocket, symbols: string[]) {
  for (const requestedSymbol of symbols) {
    await subscribeSymbol(ws, requestedSymbol);
  }
}

function scheduleReconnect(symbols: string[]) {
  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(symbols);
  }, config.deriv.reconnectDelayMs);
}

function connect(symbols: string[]) {
  resetWaitForOpen();
  const ws = new WebSocket(buildWsUrl());
  socket = ws;

  ws.on('open', async () => {
    console.log('[deriv-ws] connected');
    activeSymbolsCache = [];
    resolveWaitForOpen?.(ws);

    try {
      await subscribeToSymbols(ws, Array.from(new Set([...symbols, ...requestedSymbols])));
    } catch (error) {
      console.error('[deriv-ws] subscription bootstrap failed:', error);
    }
  });

  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      const reqId = typeof payload?.req_id === 'number' ? payload.req_id : null;

      if (reqId !== null && pendingRequests.has(reqId)) {
        const pending = pendingRequests.get(reqId)!;
        pendingRequests.delete(reqId);

        if (payload?.error?.message) {
          pending.reject(new Error(payload.error.message));
        } else {
          pending.resolve(payload);
        }
        return;
      }

      if (payload?.tick?.symbol && Number.isFinite(Number(payload.tick.quote)) && Number.isFinite(Number(payload.tick.epoch))) {
        const tick = {
          symbol: payload.tick.symbol,
          quote: Number(payload.tick.quote),
          epoch: Number(payload.tick.epoch),
        };

        handleTick(tick);

        const logicalSymbol = getLogicalSymbolForDerivSymbol(tick.symbol);
        if (logicalSymbol) {
          void updateCandlesForTick(logicalSymbol, tick.quote, tick.epoch).catch((error) => {
            console.error(`[deriv-ws] candle update failed for ${logicalSymbol}:`, error);
          });
        }
      }
    } catch (error) {
      console.error('[deriv-ws] failed to parse message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('[deriv-ws] error:', error);
  });

  ws.on('close', () => {
    console.warn('[deriv-ws] closed');
    socket = null;
    activeSymbolsCache = [];
    pendingActiveSymbolsRequest = null;
    resolvedSymbols.clear();
    clearPendingRequests(new Error('Deriv websocket closed'));
    rejectWaitForOpen?.(new Error('Deriv websocket closed'));
    resetWaitForOpen();
    scheduleReconnect(symbols);
  });
}

export function startDerivStream(symbols: string[]) {
  if (started) {
    return;
  }

  started = true;
  for (const symbol of symbols) {
    requestedSymbols.add(symbol.trim().toUpperCase());
  }
  console.log('[deriv-ws] starting stream');
  connect(symbols);
}

export async function ensureDerivSubscription(symbol: string): Promise<string> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  requestedSymbols.add(normalizedSymbol);

  const existing = resolvedSymbols.get(normalizedSymbol);
  if (existing) {
    return existing;
  }

  const inFlight = pendingSubscriptions.get(normalizedSymbol);
  if (inFlight) {
    return inFlight;
  }

  const subscriptionPromise = (async () => {
    const ws = await waitForSocketOpen();
    return subscribeSymbol(ws, normalizedSymbol);
  })().finally(() => {
    pendingSubscriptions.delete(normalizedSymbol);
  });

  pendingSubscriptions.set(normalizedSymbol, subscriptionPromise);
  return subscriptionPromise;
}

export async function getDerivHistoryCandles(symbol: string, granularity: number, count: number): Promise<DerivedCandle[]> {
  const derivSymbol = await ensureDerivSubscription(symbol);
  const ws = await waitForSocketOpen();
  const response = await sendRequest(ws, {
    ticks_history: derivSymbol,
    style: 'candles',
    granularity,
    count,
    end: 'latest',
    adjust_start_time: 1,
  });

  return Array.isArray(response?.candles)
    ? (response.candles as Array<{ epoch: number; open: number; high: number; low: number; close: number }>).map((candle) => ({
        time: Number(candle.epoch),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }))
    : [];
}
