import WebSocket from 'ws';
import { config } from '../../config';
import { saveCandles } from '../db/saveCandles';
import { aggregateCandles, type DerivedCandle } from './candles';
import { DERIV_SCANNER_SYMBOLS, type DerivScannerSymbolConfig } from './symbols';
import { handleTick, registerTrackedDerivSymbol } from './store';

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

function sendRequest(ws: WebSocket, payload: Record<string, unknown>) {
  const reqId = nextRequestId++;

  return new Promise<any>((resolve, reject) => {
    pendingRequests.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

function resolveSymbolCode(configSymbol: DerivScannerSymbolConfig, activeSymbols: DerivActiveSymbol[]) {
  const aliases = configSymbol.aliases.map(normalize);

  return activeSymbols.find((activeSymbol) => {
    const searchable = [
      activeSymbol.symbol,
      activeSymbol.display_name ?? '',
      activeSymbol.market_display_name ?? '',
      activeSymbol.submarket_display_name ?? '',
    ]
      .map(normalize)
      .filter(Boolean);

    return aliases.some((alias) => searchable.some((candidate) => candidate.includes(alias) || alias.includes(candidate)));
  })?.symbol ?? null;
}

async function seedHistoricalCandles(ws: WebSocket, logicalSymbol: string, derivSymbol: string) {
  const response = await sendRequest(ws, {
    ticks_history: derivSymbol,
    style: 'candles',
    granularity: 60,
    count: config.deriv.historyM1Count,
    end: 'latest',
    adjust_start_time: 1,
  });

  const historicalCandles = Array.isArray(response?.candles)
    ? (response.candles as Array<{ epoch: number; open: number; high: number; low: number; close: number }>).map((candle) => ({
        time: Number(candle.epoch),
        open: Number(candle.open),
        high: Number(candle.high),
        low: Number(candle.low),
        close: Number(candle.close),
      }))
    : [];

  if (historicalCandles.length === 0) {
    console.warn(`[deriv-ws] no historical candles returned for ${logicalSymbol} (${derivSymbol})`);
    return;
  }

  await saveCandles(logicalSymbol, 'M1', historicalCandles);
  await saveCandles(logicalSymbol, 'M5', aggregateCandles(historicalCandles, 300));
  await saveCandles(logicalSymbol, 'M15', aggregateCandles(historicalCandles, 900));
}

async function subscribeToSymbols(ws: WebSocket, symbols: string[]) {
  const response = await sendRequest(ws, {
    active_symbols: 'brief',
    product_type: 'basic',
  });

  const activeSymbols = (response?.active_symbols ?? []) as DerivActiveSymbol[];

  for (const requestedSymbol of symbols) {
    const configSymbol = DERIV_SCANNER_SYMBOLS.find((symbol) => symbol.symbol === requestedSymbol);
    if (!configSymbol) {
      console.warn(`[deriv-ws] no Deriv config found for ${requestedSymbol}`);
      continue;
    }

    const derivSymbol = resolveSymbolCode(configSymbol, activeSymbols);
    if (!derivSymbol) {
      console.warn(`[deriv-ws] unable to resolve Deriv symbol for ${requestedSymbol}`);
      continue;
    }

    registerTrackedDerivSymbol(requestedSymbol, derivSymbol);
    await seedHistoricalCandles(ws, requestedSymbol, derivSymbol).catch((error) => {
      console.error(`[deriv-ws] failed to seed historical candles for ${requestedSymbol}:`, error);
    });

    ws.send(JSON.stringify({ ticks: derivSymbol, subscribe: 1 }));
    console.log(`[deriv-ws] subscribed ${requestedSymbol} -> ${derivSymbol}`);
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
  const ws = new WebSocket(buildWsUrl());
  socket = ws;

  ws.on('open', async () => {
    console.log('[deriv-ws] connected');

    try {
      await subscribeToSymbols(ws, symbols);
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
        handleTick({
          symbol: payload.tick.symbol,
          quote: Number(payload.tick.quote),
          epoch: Number(payload.tick.epoch),
        });
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
    clearPendingRequests(new Error('Deriv websocket closed'));
    scheduleReconnect(symbols);
  });
}

export function startDerivStream(symbols: string[]) {
  if (started) {
    return;
  }

  started = true;
  console.log('[deriv-ws] starting stream');
  connect(symbols);
}
