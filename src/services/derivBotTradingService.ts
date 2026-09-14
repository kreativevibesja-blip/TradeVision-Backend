import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { supabase } from '../lib/supabase';
import { getStoredDerivToken } from './derivBotService';

export type DerivBotContractType = 'DIGITMATCH' | 'DIGITDIFF';
export type DerivBotStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface DerivBotTick {
  quote: number;
  digit: number;
  epoch: number;
}

export interface DerivBotProposal {
  id: string;
  symbol: string;
  contractType: DerivBotContractType;
  digit: number;
  askPrice: number;
  payout: number;
  payoutRate: number | null;
  expiresAt: number | null;
}

export interface DerivBotScan {
  symbol: string;
  targetDigit: number | null;
  payoutRate: number | null;
  sampleSize: number;
  targetOccurrences: number;
  setupScore: number | null;
  status: 'eligible' | 'target_repeated' | 'below_threshold' | 'no_trade';
  reason: string;
  proposal: DerivBotProposal | null;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

interface BotSession {
  userId: string;
  accountId: string;
  accountType: 'demo' | 'real';
  currency: string;
  balance: number | null;
  ws: WebSocket | null;
  status: DerivBotStatus;
  nextRequestId: number;
  pending: Map<number, PendingRequest>;
  tickSubscriptionId: string | null;
  contractSubscriptions: Map<string, string>;
  symbol: string | null;
  ticks: DerivBotTick[];
  lastError: string | null;
}

const sessions = new Map<string, BotSession>();

function sessionKey(userId: string, accountId: string) {
  return `${userId}:${accountId}`;
}

function getSession(userId: string, accountId: string, accountType: 'demo' | 'real', currency: string) {
  const key = sessionKey(userId, accountId);
  let session = sessions.get(key);
  if (!session) {
    session = {
      userId,
      accountId,
      accountType,
      currency,
      balance: null,
      ws: null,
      status: 'disconnected',
      nextRequestId: 1,
      pending: new Map(),
      tickSubscriptionId: null,
      contractSubscriptions: new Map(),
      symbol: null,
      ticks: [],
      lastError: null,
    };
    sessions.set(key, session);
  }
  return session;
}

function extractDigit(quote: unknown, pipSize: unknown) {
  const numericQuote = Number(quote);
  if (!Number.isFinite(numericQuote)) return null;
  const precision = Number.isFinite(Number(pipSize)) ? Math.max(0, Math.round(-Math.log10(Number(pipSize)))) : 2;
  const fixed = numericQuote.toFixed(precision);
  const digit = Number(fixed.at(-1));
  return Number.isInteger(digit) ? digit : null;
}

function rejectPending(session: BotSession, error: Error) {
  for (const pending of session.pending.values()) pending.reject(error);
  session.pending.clear();
}

function sendRequest(session: BotSession, payload: Record<string, unknown>) {
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Deriv account session is not connected.'));
  const reqId = session.nextRequestId++;
  return new Promise<any>((resolve, reject) => {
    session.pending.set(reqId, { resolve, reject });
    session.ws!.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

function attachHandlers(session: BotSession) {
  const ws = session.ws!;
  ws.on('message', (raw) => {
    let payload: any;
    try { payload = JSON.parse(raw.toString()); } catch { return; }
    const reqId = Number(payload.req_id);
    if (Number.isInteger(reqId) && session.pending.has(reqId)) {
      const pending = session.pending.get(reqId)!;
      session.pending.delete(reqId);
      if (payload.error) pending.reject(new Error(String(payload.error.message ?? 'Deriv request failed.')));
      else pending.resolve(payload);
    }
    const tick = payload.tick;
    if (tick && String(tick.symbol ?? '') === session.symbol) {
      const digit = extractDigit(tick.quote, tick.pip_size);
      if (digit != null) {
        session.ticks.push({ quote: Number(tick.quote), digit, epoch: Number(tick.epoch) });
        session.ticks = session.ticks.slice(-500);
      }
    }
    const openContract = payload.proposal_open_contract;
    if (openContract?.contract_id && openContract.is_sold) {
      void persistCompletedTrade(session, openContract);
    }
    if (payload.balance && Number.isFinite(Number(payload.balance.balance))) {
      session.balance = Number(payload.balance.balance);
    }
  });
  ws.on('close', () => {
    session.status = 'disconnected';
    session.tickSubscriptionId = null;
    rejectPending(session, new Error('Deriv account session closed.'));
  });
  ws.on('error', (error) => {
    session.status = 'error';
    session.lastError = error.message;
    rejectPending(session, error);
  });
}

async function connectSession(session: BotSession) {
  const token = await getStoredDerivToken(session.userId, session.accountId);
  const otpResponse = await fetch(`${config.deriv.apiBaseUrl}/trading/v1/options/accounts/${encodeURIComponent(session.accountId)}/otp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const otpPayload = await otpResponse.json() as Record<string, unknown>;
  if (!otpResponse.ok) throw new Error(typeof otpPayload.message === 'string' ? otpPayload.message : 'Unable to create Deriv account session.');
  const otpData = (otpPayload.data ?? otpPayload) as Record<string, unknown>;
  const wsUrl = String(otpData.websocket_url ?? otpData.ws_url ?? otpData.url ?? '');
  if (!wsUrl.startsWith('wss://')) throw new Error('Deriv did not return a valid account WebSocket URL.');

  session.status = 'connecting';
  const ws = new WebSocket(wsUrl);
  session.ws = ws;
  attachHandlers(session);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  session.status = 'connected';
  session.lastError = null;
  await sendRequest(session, { balance: 1, subscribe: 1 });
}

export async function selectDerivBotAccount(input: { userId: string; accountId: string; accountType: 'demo' | 'real'; currency: string; symbol: string }) {
  const session = getSession(input.userId, input.accountId, input.accountType, input.currency);
  for (const [key, other] of sessions) {
    if (other.userId === input.userId && key !== sessionKey(input.userId, input.accountId) && other.ws) {
      other.ws.close();
      other.status = 'disconnected';
    }
  }
  if (!session.ws || session.ws.readyState !== WebSocket.OPEN) await connectSession(session);
  await subscribeDerivBotTicks(session, input.symbol);
  return getDerivBotSession(input.userId, input.accountId);
}

async function subscribeDerivBotTicks(session: BotSession, symbol: string) {
  if (session.tickSubscriptionId) await sendRequest(session, { forget: session.tickSubscriptionId }).catch(() => undefined);
  session.symbol = symbol;
  session.ticks = [];
  const response = await sendRequest(session, { ticks: symbol, subscribe: 1 });
  session.tickSubscriptionId = String(response.subscription?.id ?? '');
}

export function getDerivBotSession(userId: string, accountId: string) {
  const session = sessions.get(sessionKey(userId, accountId));
  if (!session) return { status: 'disconnected' as const, symbol: null, ticks: [], lastError: null };
  return { status: session.status, symbol: session.symbol, balance: session.balance, currency: session.currency, accountType: session.accountType, ticks: session.ticks.slice(-500), lastError: session.lastError };
}

async function requestProposal(session: BotSession, contractType: DerivBotContractType, digit: number, stake: number, duration: number): Promise<DerivBotProposal> {
  const response = await sendRequest(session, {
    proposal: 1,
    amount: stake,
    basis: 'stake',
    contract_type: contractType,
    currency: session.currency,
    duration,
    duration_unit: 't',
    underlying_symbol: session.symbol,
    barrier: String(digit),
  });
  const proposal = response.proposal;
  const askPrice = Number(proposal?.ask_price ?? proposal?.display_value ?? stake);
  const payout = Number(proposal?.payout ?? 0);
  const payoutRate = askPrice > 0 && Number.isFinite(payout) ? Number((((payout - askPrice) / askPrice) * 100).toFixed(2)) : null;
  return {
    id: String(proposal?.id ?? ''),
    symbol: String(session.symbol),
    contractType,
    digit,
    askPrice,
    payout,
    payoutRate,
    expiresAt: Number.isFinite(Number(proposal?.date_expiry)) ? Number(proposal.date_expiry) : null,
  };
}

export async function getDerivBotProposal(userId: string, accountId: string, contractType: DerivBotContractType, digit: number, stake: number, duration: number) {
  const session = sessions.get(sessionKey(userId, accountId));
  if (!session || session.status !== 'connected' || !session.symbol) throw new Error('Select a connected Deriv account and symbol first.');
  return requestProposal(session, contractType, digit, stake, duration);
}

export async function getDerivBotTradeHistory(userId: string, accountId?: string) {
  let query = supabase.from('deriv_bot_trades').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
  if (accountId) query = query.eq('account_id', accountId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const trades = data ?? [];
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const completed = trades.filter((trade) => (trade.result === 'win' || trade.result === 'loss') && new Date(trade.completed_at ?? trade.created_at).getTime() >= startOfDay.getTime());
  const wins = completed.filter((trade) => trade.result === 'win').length;
  const profit = completed.reduce((total, trade) => total + Number(trade.profit ?? 0), 0);
  return {
    trades,
    stats: {
      trades: completed.length,
      wins,
      losses: completed.length - wins,
      winRate: completed.length ? Number(((wins / completed.length) * 100).toFixed(1)) : 0,
      stakeTotal: completed.reduce((total, trade) => total + Number(trade.stake ?? 0), 0),
      profitTotal: Number(profit.toFixed(2)),
    },
  };
}

export async function scanDerivBot(userId: string, accountId: string, stake: number, duration: number): Promise<DerivBotScan> {
  const session = sessions.get(sessionKey(userId, accountId));
  if (!session || session.status !== 'connected' || !session.symbol) throw new Error('Select a connected Deriv account and symbol first.');
  const ticks = session.ticks.slice(-500);
  const relevantTicks = ticks.slice(-Math.max(10, config.deriv.botTickWindow));
  if (ticks.length < config.deriv.botMinSample) return { symbol: session.symbol, targetDigit: null, payoutRate: null, sampleSize: ticks.length, targetOccurrences: 0, setupScore: null, status: 'no_trade', reason: `Insufficient tick sample. Need ${config.deriv.botMinSample} ticks.`, proposal: null };

  const counts = Array.from({ length: 10 }, () => 0);
  ticks.forEach((tick) => { counts[tick.digit] += 1; });
  const candidates = counts.map((count, digit) => ({ digit, count })).sort((a, b) => a.count - b.count);
  const candidate = candidates[0];
  const proposal = await requestProposal(session, 'DIGITDIFF', candidate.digit, stake, duration);
  const occurrences = relevantTicks.filter((tick) => tick.digit === candidate.digit).length;
  const score = Math.max(0, Math.min(100, Math.round(50 + (0.1 - candidate.count / ticks.length) * 250)));
  if (occurrences > 1) return { symbol: session.symbol, targetDigit: candidate.digit, payoutRate: proposal.payoutRate, sampleSize: ticks.length, targetOccurrences: occurrences, setupScore: score, status: 'target_repeated', reason: 'Target digit repeated in the configured recent tick window. Scan again.', proposal };
  return { symbol: session.symbol, targetDigit: candidate.digit, payoutRate: proposal.payoutRate, sampleSize: ticks.length, targetOccurrences: occurrences, setupScore: score, status: 'eligible', reason: 'Scan selected the least-occurring digit. Payout is displayed for information and does not block manual execution.', proposal };
}

export async function placeDerivBotTrade(userId: string, accountId: string, contractType: DerivBotContractType, digit: number, stake: number, duration: number) {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) throw new Error('Digit must be between 0 and 9.');
  if (!Number.isFinite(stake) || stake <= 0) throw new Error('Stake must be positive.');
  const session = sessions.get(sessionKey(userId, accountId));
  if (!session || session.status !== 'connected' || !session.symbol) throw new Error('Select a connected Deriv account and symbol first.');
  const { data: activeTrade, error: activeTradeError } = await supabase.from('deriv_bot_trades').select('id').eq('user_id', userId).eq('account_id', accountId).eq('symbol', session.symbol).eq('result', 'open').limit(1).maybeSingle();
  if (activeTradeError) throw new Error(activeTradeError.message);
  if (activeTrade) throw new Error('An active contract already exists for this account and symbol.');
  const proposal = await requestProposal(session, contractType, digit, stake, duration);
  if (!proposal.id) throw new Error('Deriv returned no proposal ID.');
  const buyResponse = await sendRequest(session, { buy: proposal.id, price: proposal.askPrice });
  const contractId = String(buyResponse.buy?.contract_id ?? '');
  if (!contractId) throw new Error('Deriv returned no contract ID.');
  await sendRequest(session, { proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  const trade = { id: randomUUID(), user_id: userId, account_id: accountId, symbol: session.symbol, contract_type: contractType, digit, stake, payout: proposal.payout, payout_rate: proposal.payoutRate, proposal_id: proposal.id, contract_id: contractId, result: 'open', duration, account_type: session.accountType, created_at: new Date().toISOString() };
  const { error } = await supabase.from('deriv_bot_trades').insert(trade);
  if (error) throw new Error(error.message);
  return { ...trade, proposal };
}

async function persistCompletedTrade(session: BotSession, contract: Record<string, unknown>) {
  const contractId = String(contract.contract_id);
  const profit = Number(contract.profit);
  await supabase.from('deriv_bot_trades').update({
    result: profit >= 0 ? 'win' : 'loss',
    profit: Number.isFinite(profit) ? profit : null,
    payout: Number.isFinite(Number(contract.payout)) ? Number(contract.payout) : null,
    exit_quote: Number.isFinite(Number(contract.exit_spot)) ? Number(contract.exit_spot) : null,
    completed_at: new Date().toISOString(),
  }).eq('user_id', session.userId).eq('contract_id', contractId);
}

export function disconnectDerivBotSession(userId: string, accountId?: string) {
  for (const [key, session] of sessions) {
    if (session.userId === userId && (!accountId || session.accountId === accountId)) {
      session.ws?.close();
      sessions.delete(key);
    }
  }
}
