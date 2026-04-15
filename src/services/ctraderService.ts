import { decrypt } from '../lib/encryption';
import { config } from '../config';

// ── Types ──

export interface CTraderCredentials {
  accountId: string;
  apiToken: string;
}

export interface CTraderOrder {
  symbol: string;
  direction: 'buy' | 'sell';
  lotSize: number;
  sl: number;
  tp: number;
}

export interface CTraderPosition {
  orderId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  currentPrice: number;
  lotSize: number;
  sl: number;
  tp: number;
  profit: number;
  openTime: string;
}

export interface CTraderAccountInfo {
  balance: number;
  equity: number;
  freeMargin: number;
  currency: string;
}

export interface CTraderTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface CTraderTradingAccount {
  accountId: string;
  accountNumber: number;
  live: boolean;
  brokerName: string;
  balance: number;
  currency: string;
}

// ── cTrader API Client ──

const CTRADER_API_BASE = config.ctrader.apiUrl;
const CTRADER_AUTH_BASE = config.ctrader.authUrl;

const makeHeaders = (apiToken: string) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${apiToken}`,
});

const handleResponse = async <T>(response: Response, context: string): Promise<T> => {
  if (!response.ok) {
    const body = await response.text().catch(() => 'No body');
    console.error(`[cTrader] ${context} failed: ${response.status} ${body}`);
    throw new Error(`cTrader API error (${context}): ${response.status}`);
  }
  return response.json() as Promise<T>;
};

// ── Public Functions ──

export const connectAccount = async (encryptedToken: string, accountId: string): Promise<CTraderAccountInfo> => {
  const apiToken = decrypt(encryptedToken);
  const response = await fetch(`${CTRADER_API_BASE}/v2/accounts/${accountId}`, {
    method: 'GET',
    headers: makeHeaders(apiToken),
  });
  return handleResponse<CTraderAccountInfo>(response, 'connectAccount');
};

export const getAccountBalance = async (encryptedToken: string, accountId: string): Promise<CTraderAccountInfo> => {
  const apiToken = decrypt(encryptedToken);
  const response = await fetch(`${CTRADER_API_BASE}/v2/accounts/${accountId}/balance`, {
    method: 'GET',
    headers: makeHeaders(apiToken),
  });
  return handleResponse<CTraderAccountInfo>(response, 'getAccountBalance');
};

export const placeTrade = async (
  encryptedToken: string,
  accountId: string,
  order: CTraderOrder,
): Promise<{ orderId: string }> => {
  const apiToken = decrypt(encryptedToken);
  const response = await fetch(`${CTRADER_API_BASE}/v2/accounts/${accountId}/orders`, {
    method: 'POST',
    headers: makeHeaders(apiToken),
    body: JSON.stringify({
      symbolName: order.symbol,
      orderType: 'MARKET',
      tradeSide: order.direction === 'buy' ? 'BUY' : 'SELL',
      volume: Math.round(order.lotSize * 100), // Convert lots to volume units
      stopLoss: order.sl,
      takeProfit: order.tp,
    }),
  });
  return handleResponse<{ orderId: string }>(response, 'placeTrade');
};

export const closeTrade = async (
  encryptedToken: string,
  accountId: string,
  orderId: string,
): Promise<void> => {
  const apiToken = decrypt(encryptedToken);
  const response = await fetch(`${CTRADER_API_BASE}/v2/accounts/${accountId}/positions/${orderId}/close`, {
    method: 'POST',
    headers: makeHeaders(apiToken),
    body: JSON.stringify({}),
  });
  await handleResponse(response, 'closeTrade');
};

export const getOpenTrades = async (
  encryptedToken: string,
  accountId: string,
): Promise<CTraderPosition[]> => {
  const apiToken = decrypt(encryptedToken);
  const response = await fetch(`${CTRADER_API_BASE}/v2/accounts/${accountId}/positions`, {
    method: 'GET',
    headers: makeHeaders(apiToken),
  });
  const data = await handleResponse<{ positions: CTraderPosition[] }>(response, 'getOpenTrades');
  return data.positions ?? [];
};

// ── OAuth ──

export const exchangeCodeForTokens = async (code: string): Promise<CTraderTokenResponse> => {
  const response = await fetch(`${CTRADER_AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.ctrader.clientId,
      client_secret: config.ctrader.clientSecret,
      redirect_uri: config.ctrader.redirectUri,
    }),
  });
  return handleResponse<CTraderTokenResponse>(response, 'exchangeCodeForTokens');
};

export const refreshAccessToken = async (encryptedRefreshToken: string): Promise<CTraderTokenResponse> => {
  const refreshToken = decrypt(encryptedRefreshToken);
  const response = await fetch(`${CTRADER_AUTH_BASE}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.ctrader.clientId,
      client_secret: config.ctrader.clientSecret,
    }),
  });
  return handleResponse<CTraderTokenResponse>(response, 'refreshAccessToken');
};

export const getTradingAccounts = async (accessToken: string): Promise<CTraderTradingAccount[]> => {
  const response = await fetch(`${CTRADER_API_BASE}/v2/trading-accounts`, {
    method: 'GET',
    headers: makeHeaders(accessToken),
  });
  const data = await handleResponse<{ accounts: CTraderTradingAccount[] }>(response, 'getTradingAccounts');
  return data.accounts ?? [];
};
