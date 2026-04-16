import MetaApi from 'metaapi.cloud-sdk';
import { config } from '../config';

export interface MT5TradeRequest {
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  sl?: number;
  tp?: number;
}

export interface MT5TradeResult {
  orderId: string;
  rawResult: unknown;
}

export interface MT5AccountSnapshot {
  balance: number;
  equity: number;
  freeMargin: number;
  currency: string;
}

export interface MT5Position {
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

type MT5ServiceErrorCode =
  | 'not_configured'
  | 'invalid_credentials'
  | 'invalid_server'
  | 'timeout'
  | 'metaapi_error';

export class MT5ServiceError extends Error {
  code: MT5ServiceErrorCode;
  statusCode: number;

  constructor(code: MT5ServiceErrorCode, message: string, statusCode = 500) {
    super(message);
    this.name = 'MT5ServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

let api: any | null = null;

const getMetaApi = () => {
  if (!config.metaapi.apiKey) {
    throw new MT5ServiceError('not_configured', 'MT5 integration is not configured.', 500);
  }

  if (!api) {
    api = new MetaApi(config.metaapi.apiKey);
  }

  return api;
};

const mapMetaApiError = (error: unknown): MT5ServiceError => {
  if (error instanceof MT5ServiceError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('e_auth') || normalized.includes('invalid account') || normalized.includes('authorization')) {
    return new MT5ServiceError('invalid_credentials', 'Invalid MT5 login or password. Please verify your credentials.', 400);
  }

  if (normalized.includes('e_srv_not_found') || normalized.includes('server') || normalized.includes('timezone')) {
    return new MT5ServiceError('invalid_server', 'The MT5 server name could not be verified. Please check the broker server.', 400);
  }

  if (normalized.includes('timeout') || normalized.includes('timed out')) {
    return new MT5ServiceError('timeout', 'MT5 connection timed out. Please try again shortly.', 504);
  }

  return new MT5ServiceError('metaapi_error', 'MetaAPI request failed. Please try again.', 502);
};

const getRpcConnection = async (accountId: string) => {
  try {
    const account = await getMetaApi().metatraderAccountApi.getAccount(accountId);

    if (account.state !== 'DEPLOYED' && account.state !== 'DEPLOYING') {
      await account.deploy();
    }

    if (account.connectionStatus !== 'CONNECTED') {
      await account.waitConnected();
    }

    const connection = account.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized();
    return connection;
  } catch (error) {
    throw mapMetaApiError(error);
  }
};

export const connectMT5Account = async (userId: string, login: string, password: string, server: string) => {
  try {
    const account = await getMetaApi().metatraderAccountApi.createAccount({
      name: `User-${userId}`,
      type: 'cloud',
      login,
      password,
      server,
      platform: 'mt5',
      magic: 1000,
    });

    await account.deploy();
    await account.waitConnected();

    return {
      accountId: String(account.id),
      status: account.connectionStatus === 'CONNECTED' ? 'connected' : 'connecting',
    };
  } catch (error) {
    throw mapMetaApiError(error);
  }
};

export const disconnectMT5Account = async (accountId: string) => {
  try {
    const account = await getMetaApi().metatraderAccountApi.getAccount(accountId);
    await account.undeploy();
  } catch (error) {
    throw mapMetaApiError(error);
  }
};

export const getMT5AccountState = async (accountId: string): Promise<MT5AccountSnapshot> => {
  const connection = await getRpcConnection(accountId);
  const info = await connection.getAccountInformation();

  return {
    balance: Number(info.balance ?? 0),
    equity: Number(info.equity ?? info.balance ?? 0),
    freeMargin: Number(info.freeMargin ?? 0),
    currency: String(info.currency ?? 'USD'),
  };
};

export const executeMT5Trade = async (accountId: string, trade: MT5TradeRequest): Promise<MT5TradeResult> => {
  const connection = await getRpcConnection(accountId);
  const result = trade.type === 'buy'
    ? await connection.createMarketBuyOrder(trade.symbol, trade.volume, trade.sl ?? null, trade.tp ?? null)
    : await connection.createMarketSellOrder(trade.symbol, trade.volume, trade.sl ?? null, trade.tp ?? null);

  return {
    orderId: String(result.orderId ?? result.positionId ?? result.numericCode ?? result.stringCode),
    rawResult: result,
  };
};

export const getMT5OpenPositions = async (accountId: string): Promise<MT5Position[]> => {
  const connection = await getRpcConnection(accountId);
  const positions = await connection.getPositions();

  return (positions ?? []).map((position: any) => ({
    orderId: String(position.id ?? position.positionId ?? position.ticket),
    symbol: String(position.symbol ?? ''),
    direction: position.type === 'POSITION_TYPE_SELL' || position.type === 'sell' ? 'sell' : 'buy',
    entryPrice: Number(position.openPrice ?? 0),
    currentPrice: Number(position.currentPrice ?? position.currentTickValue ?? position.openPrice ?? 0),
    lotSize: Number(position.volume ?? 0),
    sl: Number(position.stopLoss ?? 0),
    tp: Number(position.takeProfit ?? 0),
    profit: Number(position.profit ?? 0),
    openTime: new Date(position.time ?? Date.now()).toISOString(),
  }));
};

export const closeMT5Position = async (accountId: string, positionId: string) => {
  const connection = await getRpcConnection(accountId);
  return connection.closePosition(positionId);
};
