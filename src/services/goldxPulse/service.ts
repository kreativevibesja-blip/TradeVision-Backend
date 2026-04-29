import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { config } from '../../config';

type AccountType = 'demo' | 'real';
type StrategyMode = 'digit-pulse' | 'range-pressure';
type TradeAction = 'OVER' | 'UNDER' | 'MATCH' | 'DIFFER';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
type TradeStatus = 'proposal' | 'open' | 'won' | 'lost' | 'error';
type BiasDirection = 'over' | 'under' | 'neutral';
type BiasStrength = 'strong' | 'weak' | 'neutral';
type DigitBiasState = 'underrepresented' | 'overrepresented' | 'neutral';

type PendingResolver = {
  resolve: (payload: any) => void;
  reject: (error: Error) => void;
};

export interface GoldxPulseSymbolOption {
  symbol: string;
  label: string;
  category: 'volatility' | 'volatility-1s' | 'jump' | 'step' | 'boom-crash';
  digits: number;
}

export interface GoldxPulseTick {
  quote: number;
  formattedQuote: string;
  epoch: number;
  digit: number;
}

export interface GoldxPulseDigitProbability {
  digit: number;
  count: number;
  probability: number;
  deviation: number;
  bias: DigitBiasState;
}

export interface GoldxPulseOverUnderProbability {
  selectedDigit: number;
  overProbability: number;
  underProbability: number;
  difference: number;
  confidence: number;
  bias: BiasDirection;
  strength: BiasStrength;
}

export interface GoldxPulseMatchDifferProbability {
  selectedDigit: number;
  matchProbability: number;
  differProbability: number;
  matchDeviation: number;
  differDeviation: number;
}

export interface GoldxPulseWarmupStatus {
  minTicksRequired: number;
  currentTicks: number;
  remainingTicks: number;
  progressPct: number;
  ready: boolean;
  message: string;
}

export interface GoldxPulseAnalytics {
  frequencyMap: number[];
  digitProbabilities: GoldxPulseDigitProbability[];
  mostFrequentDigit: number | null;
  leastFrequentDigit: number | null;
  currentStreakDigit: number | null;
  currentStreakLength: number;
  longestStreakDigit: number | null;
  longestStreakLength: number;
  aboveFivePct: number;
  belowFivePct: number;
  bias: BiasDirection;
  overUnder: GoldxPulseOverUnderProbability;
  matchDiffer: GoldxPulseMatchDifferProbability;
  warmup: GoldxPulseWarmupStatus;
}

export interface GoldxPulseTrade {
  id: string;
  action: TradeAction;
  symbol: string;
  stake: number;
  duration: number;
  digit: number | null;
  barrier: string | null;
  status: TradeStatus;
  payout: number | null;
  profit: number | null;
  contractId: number | null;
  buyPrice: number | null;
  sellPrice: number | null;
  displayMessage: string;
  createdAt: string;
  settledAt: string | null;
}

export interface GoldxPulseSettings {
  symbol: string;
  stake: number;
  duration: number;
  strategyMode: StrategyMode;
  selectedDigit: number;
  maxDailyLoss: number | null;
  cooldownMs: number;
}

export interface GoldxPulseSnapshot {
  connected: boolean;
  connectionState: ConnectionState;
  account: {
    balance: number;
    currency: string;
    accountType: AccountType;
    loginId: string;
  } | null;
  settings: GoldxPulseSettings;
  ticks: GoldxPulseTick[];
  totalTickCount: number;
  analytics: GoldxPulseAnalytics;
  trades: GoldxPulseTrade[];
  cooldownRemainingMs: number;
  dailyLoss: number;
  error: string | null;
  updatedAt: string;
}

type SessionListener = (snapshot: GoldxPulseSnapshot) => void;

type GoldxPulseSession = {
  userId: string;
  token: string | null;
  ws: WebSocket | null;
  nextReqId: number;
  pendingRequests: Map<number, PendingResolver>;
  listeners: Set<SessionListener>;
  tickSubscriptionId: string | null;
  tradeSubscriptionIds: Map<number, string>;
  account: GoldxPulseSnapshot['account'];
  connectionState: ConnectionState;
  error: string | null;
  ticks: GoldxPulseTick[];
  rollingDigitCounts: number[];
  totalTickCount: number;
  trades: GoldxPulseTrade[];
  settings: GoldxPulseSettings;
  lastTradeAt: number;
  dailyLoss: number;
  dailyLossDateKey: string;
};

const MAX_TICKS = 300;
const MAX_TRADES = 20;
const MIN_TICKS_REQUIRED = 70;
const BASELINE_DIGIT_PROBABILITY = 0.1;

export const GOLDX_PULSE_SYMBOLS: GoldxPulseSymbolOption[] = [
  { symbol: 'R_10', label: 'Volatility 10', category: 'volatility', digits: 2 },
  { symbol: 'R_25', label: 'Volatility 25', category: 'volatility', digits: 2 },
  { symbol: 'R_50', label: 'Volatility 50', category: 'volatility', digits: 2 },
  { symbol: 'R_75', label: 'Volatility 75', category: 'volatility', digits: 2 },
  { symbol: 'R_100', label: 'Volatility 100', category: 'volatility', digits: 2 },
  { symbol: '1HZ10V', label: 'Volatility 10 (1s)', category: 'volatility-1s', digits: 2 },
  { symbol: '1HZ25V', label: 'Volatility 25 (1s)', category: 'volatility-1s', digits: 2 },
  { symbol: '1HZ50V', label: 'Volatility 50 (1s)', category: 'volatility-1s', digits: 2 },
  { symbol: '1HZ75V', label: 'Volatility 75 (1s)', category: 'volatility-1s', digits: 2 },
  { symbol: '1HZ100V', label: 'Volatility 100 (1s)', category: 'volatility-1s', digits: 2 },
  { symbol: 'BOOM500', label: 'Boom 500', category: 'boom-crash', digits: 2 },
  { symbol: 'BOOM1000', label: 'Boom 1000', category: 'boom-crash', digits: 2 },
  { symbol: 'CRASH500', label: 'Crash 500', category: 'boom-crash', digits: 2 },
  { symbol: 'CRASH1000', label: 'Crash 1000', category: 'boom-crash', digits: 2 },
  { symbol: 'JD10', label: 'Jump 10', category: 'jump', digits: 2 },
  { symbol: 'JD25', label: 'Jump 25', category: 'jump', digits: 2 },
  { symbol: 'JD50', label: 'Jump 50', category: 'jump', digits: 2 },
  { symbol: 'JD75', label: 'Jump 75', category: 'jump', digits: 2 },
  { symbol: 'JD100', label: 'Jump 100', category: 'jump', digits: 2 },
  { symbol: 'stpRNG', label: 'Step Index 100', category: 'step', digits: 2 },
  { symbol: 'stpRNG2', label: 'Step Index 200', category: 'step', digits: 2 },
  { symbol: 'stpRNG3', label: 'Step Index 300', category: 'step', digits: 2 },
  { symbol: 'stpRNG4', label: 'Step Index 400', category: 'step', digits: 2 },
  { symbol: 'stpRNG5', label: 'Step Index 500', category: 'step', digits: 2 },
];

const sessions = new Map<string, GoldxPulseSession>();

function buildWsUrl() {
  return `${config.deriv.wsUrl}?app_id=${config.deriv.appId}`;
}

function getSession(userId: string) {
  let session = sessions.get(userId);
  if (!session) {
    session = {
      userId,
      token: null,
      ws: null,
      nextReqId: 1,
      pendingRequests: new Map(),
      listeners: new Set(),
      tickSubscriptionId: null,
      tradeSubscriptionIds: new Map(),
      account: null,
      connectionState: 'disconnected',
      error: null,
      ticks: [],
      rollingDigitCounts: Array.from({ length: 10 }, () => 0),
      totalTickCount: 0,
      trades: [],
      settings: {
        symbol: 'R_75',
        stake: 1,
        duration: 5,
        strategyMode: 'digit-pulse',
        selectedDigit: 7,
        maxDailyLoss: null,
        cooldownMs: 15000,
      },
      lastTradeAt: 0,
      dailyLoss: 0,
      dailyLossDateKey: new Date().toISOString().slice(0, 10),
    };
    sessions.set(userId, session);
  }

  return session;
}

function getSymbolMeta(symbol: string) {
  return GOLDX_PULSE_SYMBOLS.find((item) => item.symbol === symbol) ?? GOLDX_PULSE_SYMBOLS[0];
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyLossIfNeeded(session: GoldxPulseSession) {
  const todayKey = getTodayKey();
  if (session.dailyLossDateKey !== todayKey) {
    session.dailyLossDateKey = todayKey;
    session.dailyLoss = 0;
  }
}

function formatQuote(quote: number, digits: number) {
  return quote.toFixed(digits);
}

function deriveLastDigit(quote: number, digits: number) {
  const formatted = formatQuote(quote, digits);
  const digitCharacter = formatted.replace(/[^0-9]/g, '').slice(-1);
  return Number.parseInt(digitCharacter || '0', 10);
}

function toPercent(value: number) {
  return Number((value * 100).toFixed(1));
}

function buildStreakMetrics(ticks: GoldxPulseTick[]) {
  let currentStreakDigit: number | null = null;
  let currentStreakLength = 0;
  let longestStreakDigit: number | null = null;
  let longestStreakLength = 0;

  for (let index = ticks.length - 1; index >= 0; index -= 1) {
    const digit = ticks[index]?.digit;
    if (digit == null) {
      continue;
    }

    if (currentStreakDigit == null || digit === currentStreakDigit) {
      currentStreakDigit = digit;
      currentStreakLength += 1;
    } else {
      break;
    }
  }

  let trackingDigit: number | null = null;
  let trackingLength = 0;
  for (const tick of ticks) {
    if (trackingDigit == null || tick.digit === trackingDigit) {
      trackingDigit = tick.digit;
      trackingLength += 1;
    } else {
      if (trackingLength > longestStreakLength) {
        longestStreakLength = trackingLength;
        longestStreakDigit = trackingDigit;
      }
      trackingDigit = tick.digit;
      trackingLength = 1;
    }
  }
  if (trackingLength > longestStreakLength) {
    longestStreakLength = trackingLength;
    longestStreakDigit = trackingDigit;
  }

  return {
    currentStreakDigit,
    currentStreakLength,
    longestStreakDigit,
    longestStreakLength,
  };
}

function buildOverUnderProbability(probabilities: number[], selectedDigit: number): GoldxPulseOverUnderProbability {
  const underProbability = probabilities.slice(0, selectedDigit).reduce((total, value) => total + value, 0);
  const overProbability = probabilities.slice(selectedDigit + 1).reduce((total, value) => total + value, 0);
  const difference = Math.abs(overProbability - underProbability);
  const strength: BiasStrength = difference > 0.1 ? 'strong' : difference > 0.05 ? 'weak' : 'neutral';
  const bias: BiasDirection = strength === 'neutral' ? 'neutral' : overProbability > underProbability ? 'over' : 'under';

  return {
    selectedDigit,
    overProbability: toPercent(overProbability),
    underProbability: toPercent(underProbability),
    difference: toPercent(difference),
    confidence: Math.max(0, Math.min(100, toPercent(difference))),
    bias,
    strength,
  };
}

function buildMatchDifferProbability(probabilities: number[], selectedDigit: number): GoldxPulseMatchDifferProbability {
  const matchProbability = probabilities[selectedDigit] ?? 0;
  const differProbability = 1 - matchProbability;

  return {
    selectedDigit,
    matchProbability: toPercent(matchProbability),
    differProbability: toPercent(differProbability),
    matchDeviation: toPercent(matchProbability - BASELINE_DIGIT_PROBABILITY),
    differDeviation: toPercent(differProbability - (1 - BASELINE_DIGIT_PROBABILITY)),
  };
}

function buildWarmupStatus(totalTickCount: number): GoldxPulseWarmupStatus {
  const currentTicks = totalTickCount;
  const remainingTicks = Math.max(0, MIN_TICKS_REQUIRED - currentTicks);
  const ready = currentTicks >= MIN_TICKS_REQUIRED;

  return {
    minTicksRequired: MIN_TICKS_REQUIRED,
    currentTicks,
    remainingTicks,
    progressPct: Math.min(100, Number(((currentTicks / MIN_TICKS_REQUIRED) * 100).toFixed(1))),
    ready,
    message: ready ? 'Data ready' : `Collecting data... (${currentTicks} / ${MIN_TICKS_REQUIRED} ticks)`,
  };
}

function buildAnalytics(session: GoldxPulseSession): GoldxPulseAnalytics {
  const frequencyMap = [...session.rollingDigitCounts];
  const sampleSize = Math.max(session.ticks.length, 1);
  const digitProbabilities = frequencyMap.map((count, digit) => {
    const probability = count / sampleSize;
    const deviation = probability - BASELINE_DIGIT_PROBABILITY;
    const bias: DigitBiasState = deviation <= -0.02 ? 'underrepresented' : deviation >= 0.02 ? 'overrepresented' : 'neutral';

    return {
      digit,
      count,
      probability: toPercent(probability),
      deviation: toPercent(deviation),
      bias,
    };
  });

  const rawProbabilities = frequencyMap.map((count) => count / sampleSize);
  const mostFrequentCount = Math.max(...frequencyMap);
  const leastFrequentCount = Math.min(...frequencyMap);
  const mostFrequentDigit = mostFrequentCount > 0 ? frequencyMap.findIndex((count) => count === mostFrequentCount) : null;
  const leastFrequentDigit = session.ticks.length > 0 ? frequencyMap.findIndex((count) => count === leastFrequentCount) : null;
  const aboveFive = frequencyMap.slice(6).reduce((total, count) => total + count, 0);
  const belowFive = frequencyMap.slice(0, 5).reduce((total, count) => total + count, 0);
  const streakMetrics = buildStreakMetrics(session.ticks);
  const overUnder = buildOverUnderProbability(rawProbabilities, session.settings.selectedDigit);
  const matchDiffer = buildMatchDifferProbability(rawProbabilities, session.settings.selectedDigit);
  const warmup = buildWarmupStatus(session.totalTickCount);

  return {
    frequencyMap,
    digitProbabilities,
    mostFrequentDigit,
    leastFrequentDigit,
    currentStreakDigit: streakMetrics.currentStreakDigit,
    currentStreakLength: streakMetrics.currentStreakLength,
    longestStreakDigit: streakMetrics.longestStreakDigit,
    longestStreakLength: streakMetrics.longestStreakLength,
    aboveFivePct: toPercent(aboveFive / sampleSize),
    belowFivePct: toPercent(belowFive / sampleSize),
    bias: overUnder.bias,
    overUnder,
    matchDiffer,
    warmup,
  };
}

function snapshotSession(session: GoldxPulseSession): GoldxPulseSnapshot {
  resetDailyLossIfNeeded(session);
  return {
    connected: session.connectionState === 'connected',
    connectionState: session.connectionState,
    account: session.account,
    settings: session.settings,
    ticks: session.ticks,
    totalTickCount: session.totalTickCount,
    analytics: buildAnalytics(session),
    trades: session.trades,
    cooldownRemainingMs: Math.max(0, session.settings.cooldownMs - (Date.now() - session.lastTradeAt)),
    dailyLoss: session.dailyLoss,
    error: session.error,
    updatedAt: new Date().toISOString(),
  };
}

function emit(session: GoldxPulseSession) {
  const snapshot = snapshotSession(session);
  for (const listener of session.listeners) {
    listener(snapshot);
  }
}

function rejectPending(session: GoldxPulseSession, error: Error) {
  for (const [, pending] of session.pendingRequests) {
    pending.reject(error);
  }
  session.pendingRequests.clear();
}

function sendRequest(session: GoldxPulseSession, payload: Record<string, unknown>) {
  const ws = session.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('Deriv connection is not open.'));
  }

  const reqId = session.nextReqId += 1;
  return new Promise<any>((resolve, reject) => {
    session.pendingRequests.set(reqId, { resolve, reject });
    ws.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

async function subscribeTicks(session: GoldxPulseSession, symbol: string) {
  const ws = session.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Deriv connection is not open.');
  }

  if (session.tickSubscriptionId) {
    ws.send(JSON.stringify({ forget: session.tickSubscriptionId }));
    session.tickSubscriptionId = null;
  }

  session.settings.symbol = symbol;
  session.ticks = [];
  session.rollingDigitCounts = Array.from({ length: 10 }, () => 0);
  session.totalTickCount = 0;
  const response = await sendRequest(session, { ticks: symbol, subscribe: 1 });
  session.tickSubscriptionId = response?.subscription?.id ?? null;
  emit(session);
}

function upsertTrade(session: GoldxPulseSession, nextTrade: GoldxPulseTrade) {
  const existingIndex = session.trades.findIndex((trade) => trade.id === nextTrade.id || (trade.contractId != null && trade.contractId === nextTrade.contractId));
  if (existingIndex >= 0) {
    session.trades[existingIndex] = { ...session.trades[existingIndex], ...nextTrade };
  } else {
    session.trades.unshift(nextTrade);
    session.trades = session.trades.slice(0, MAX_TRADES);
  }
}

function handleProposalOpenContract(session: GoldxPulseSession, payload: any) {
  const openContract = payload?.proposal_open_contract;
  if (!openContract?.contract_id) {
    return;
  }

  const profit = Number.isFinite(Number(openContract.profit)) ? Number(openContract.profit) : null;
  const isSold = Boolean(openContract.is_sold);
  const status: TradeStatus = isSold ? (profit != null && profit >= 0 ? 'won' : 'lost') : 'open';

  upsertTrade(session, {
    id: `contract:${openContract.contract_id}`,
    action: 'OVER',
    symbol: openContract.underlying ?? session.settings.symbol,
    stake: Number(openContract.buy_price ?? 0),
    duration: Number(openContract.tick_count ?? session.settings.duration),
    digit: null,
    barrier: openContract.barrier != null ? String(openContract.barrier) : null,
    status,
    payout: Number.isFinite(Number(openContract.payout)) ? Number(openContract.payout) : null,
    profit,
    contractId: Number(openContract.contract_id),
    buyPrice: Number.isFinite(Number(openContract.buy_price)) ? Number(openContract.buy_price) : null,
    sellPrice: Number.isFinite(Number(openContract.sell_price)) ? Number(openContract.sell_price) : null,
    displayMessage: isSold
      ? profit != null && profit >= 0
        ? 'Trade settled in profit.'
        : 'Trade settled at a loss.'
      : 'Trade is live.',
    createdAt: new Date((Number(openContract.purchase_time) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    settledAt: isSold ? new Date((Number(openContract.date_expiry) || Math.floor(Date.now() / 1000)) * 1000).toISOString() : null,
  });

  if (isSold && profit != null && profit < 0) {
    resetDailyLossIfNeeded(session);
    session.dailyLoss += Math.abs(profit);
  }

  emit(session);
}

function attachSocketHandlers(session: GoldxPulseSession, ws: WebSocket) {
  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(raw.toString());
      const reqId = typeof payload?.req_id === 'number' ? payload.req_id : null;

      if (reqId != null && session.pendingRequests.has(reqId)) {
        const pending = session.pendingRequests.get(reqId)!;
        session.pendingRequests.delete(reqId);
        if (payload?.error?.message) {
          pending.reject(new Error(payload.error.message));
        } else {
          pending.resolve(payload);
        }
        return;
      }

      if (payload?.tick?.symbol && Number.isFinite(Number(payload.tick.quote))) {
        const meta = getSymbolMeta(session.settings.symbol);
        const quote = Number(payload.tick.quote);
        const formattedQuote = formatQuote(quote, meta.digits);
        const tick: GoldxPulseTick = {
          quote,
          formattedQuote,
          epoch: Number(payload.tick.epoch),
          digit: deriveLastDigit(quote, meta.digits),
        };
        if (session.ticks.length >= MAX_TICKS) {
          const removedTick = session.ticks.shift();
          if (removedTick) {
            session.rollingDigitCounts[removedTick.digit] = Math.max(0, session.rollingDigitCounts[removedTick.digit] - 1);
          }
        }
        session.ticks.push(tick);
        session.rollingDigitCounts[tick.digit] += 1;
        session.totalTickCount += 1;
        emit(session);
        return;
      }

      if (payload?.proposal_open_contract) {
        handleProposalOpenContract(session, payload);
      }
    } catch (error) {
      console.error('[goldx-pulse] failed to parse Deriv payload:', error);
    }
  });

  ws.on('close', () => {
    session.connectionState = 'disconnected';
    session.error = 'Deriv connection closed.';
    session.tickSubscriptionId = null;
    rejectPending(session, new Error('Deriv connection closed.'));
    emit(session);
  });

  ws.on('error', (error) => {
    session.connectionState = 'error';
    session.error = error.message;
    rejectPending(session, error instanceof Error ? error : new Error('Deriv connection error.'));
    emit(session);
  });
}

export function getGoldxPulseSymbols() {
  return GOLDX_PULSE_SYMBOLS;
}

export function getGoldxPulseSnapshot(userId: string) {
  return snapshotSession(getSession(userId));
}

export async function connectGoldxPulse(userId: string, apiToken: string, symbol?: string) {
  const session = getSession(userId);
  if (session.ws) {
    session.ws.removeAllListeners();
    session.ws.close();
  }

  session.token = apiToken;
  session.connectionState = 'connecting';
  session.error = null;
  emit(session);

  const ws = new WebSocket(buildWsUrl());
  session.ws = ws;
  attachSocketHandlers(session, ws);

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (error) => reject(error));
  });

  const authorizeResponse = await sendRequest(session, { authorize: apiToken });
  const authorize = authorizeResponse?.authorize;
  if (!authorize?.loginid) {
    throw new Error('Deriv authorization failed.');
  }

  session.account = {
    balance: Number(authorize.balance ?? 0),
    currency: String(authorize.currency ?? 'USD'),
    accountType: authorize.is_virtual || /^VRTC|^CR/i.test(String(authorize.loginid)) ? 'demo' : 'real',
    loginId: String(authorize.loginid),
  };
  session.connectionState = 'connected';
  session.error = null;
  await subscribeTicks(session, symbol ?? session.settings.symbol);
  emit(session);

  return session.account;
}

export function disconnectGoldxPulse(userId: string) {
  const session = getSession(userId);
  if (session.ws) {
    session.ws.removeAllListeners();
    session.ws.close();
  }

  session.ws = null;
  session.token = null;
  session.connectionState = 'disconnected';
  session.account = null;
  session.tickSubscriptionId = null;
  session.error = null;
  session.ticks = [];
  session.rollingDigitCounts = Array.from({ length: 10 }, () => 0);
  session.totalTickCount = 0;
  emit(session);
}

export async function updateGoldxPulseSettings(userId: string, nextSettings: Partial<GoldxPulseSettings>) {
  const session = getSession(userId);
  session.settings = {
    ...session.settings,
    ...nextSettings,
    selectedDigit: Number.isFinite(nextSettings.selectedDigit) ? Math.max(0, Math.min(9, Number(nextSettings.selectedDigit))) : session.settings.selectedDigit,
    duration: Number.isFinite(nextSettings.duration) ? Math.max(1, Number(nextSettings.duration)) : session.settings.duration,
    stake: Number.isFinite(nextSettings.stake) ? Math.max(0.35, Number(nextSettings.stake)) : session.settings.stake,
  };

  if (session.connectionState === 'connected' && nextSettings.symbol && nextSettings.symbol !== session.settings.symbol) {
    await subscribeTicks(session, nextSettings.symbol);
  }

  emit(session);
  return snapshotSession(session);
}

export function clearGoldxPulseTrades(userId: string) {
  const session = getSession(userId);
  session.trades = [];
  emit(session);
  return snapshotSession(session);
}

export function subscribeGoldxPulse(userId: string, listener: SessionListener) {
  const session = getSession(userId);
  session.listeners.add(listener);
  listener(snapshotSession(session));
  return () => {
    session.listeners.delete(listener);
  };
}

function ensureTradeAllowed(session: GoldxPulseSession) {
  resetDailyLossIfNeeded(session);

  if (session.connectionState !== 'connected' || !session.account) {
    throw new Error('Connect a Deriv account first.');
  }

  if (session.settings.maxDailyLoss != null && session.dailyLoss >= session.settings.maxDailyLoss) {
    throw new Error('Max daily loss reached.');
  }

  const cooldownRemaining = session.settings.cooldownMs - (Date.now() - session.lastTradeAt);
  if (cooldownRemaining > 0) {
    throw new Error(`Trade cooldown active for ${Math.ceil(cooldownRemaining / 1000)}s.`);
  }

  if (session.totalTickCount < MIN_TICKS_REQUIRED) {
    throw new Error(`Collecting data... (${session.totalTickCount} / ${MIN_TICKS_REQUIRED} ticks)`);
  }
}

export async function placeGoldxPulseTrade(
  userId: string,
  payload: {
    action: TradeAction;
    symbol?: string;
    stake?: number;
    duration?: number;
    digit?: number | null;
  },
) {
  const session = getSession(userId);
  ensureTradeAllowed(session);

  const symbol = payload.symbol ?? session.settings.symbol;
  if (symbol !== session.settings.symbol) {
    await subscribeTicks(session, symbol);
  }

  const stake = Number(payload.stake ?? session.settings.stake);
  const duration = Number(payload.duration ?? session.settings.duration);
  const selectedDigit = payload.digit != null ? Math.max(0, Math.min(9, Number(payload.digit))) : session.settings.selectedDigit;
  const barrier = String(selectedDigit);

  const contractTypeMap: Record<TradeAction, string> = {
    OVER: 'DIGITOVER',
    UNDER: 'DIGITUNDER',
    MATCH: 'DIGITMATCH',
    DIFFER: 'DIGITDIFF',
  };

  const proposal = await sendRequest(session, {
    proposal: 1,
    amount: stake,
    basis: 'stake',
    contract_type: contractTypeMap[payload.action],
    currency: session.account?.currency ?? 'USD',
    duration,
    duration_unit: 't',
    symbol,
    barrier,
  });

  const proposalId = proposal?.proposal?.id;
  if (!proposalId) {
    throw new Error('Deriv proposal failed.');
  }

  const buyResponse = await sendRequest(session, {
    buy: proposalId,
    price: stake,
  });

  const contractId = Number(buyResponse?.buy?.contract_id ?? 0);
  if (contractId > 0) {
    const contractSubscription = await sendRequest(session, {
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
    });
    const subscriptionId = contractSubscription?.subscription?.id;
    if (subscriptionId) {
      session.tradeSubscriptionIds.set(contractId, subscriptionId);
    }
  }

  const trade: GoldxPulseTrade = {
    id: randomUUID(),
    action: payload.action,
    symbol,
    stake,
    duration,
    digit: payload.action === 'MATCH' || payload.action === 'DIFFER' ? selectedDigit : null,
    barrier,
    status: 'open',
    payout: Number.isFinite(Number(proposal?.proposal?.payout)) ? Number(proposal.proposal.payout) : null,
    profit: null,
    contractId: contractId || null,
    buyPrice: Number.isFinite(Number(buyResponse?.buy?.buy_price)) ? Number(buyResponse.buy.buy_price) : stake,
    sellPrice: null,
    displayMessage: 'Trade placed successfully.',
    createdAt: new Date().toISOString(),
    settledAt: null,
  };

  upsertTrade(session, trade);
  session.lastTradeAt = Date.now();
  emit(session);
  return trade;
}
