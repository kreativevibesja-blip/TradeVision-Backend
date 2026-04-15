import { decrypt } from '../lib/encryption';

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

// ── cTrader API Client ──

const CTRADER_API_BASE = process.env.CTRADER_API_URL || 'https://openapi.ctrader.com';

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
