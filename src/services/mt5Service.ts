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

let metaApiInstance: any | null = null;
const connectionCache = new Map<string, any>();

async function getMetaApi() {
  if (!process.env.METAAPI_API_KEY) {
    throw new MT5ServiceError('not_configured', 'MetaAPI key missing', 500);
  }

  if (!metaApiInstance) {
    const MetaApi = (await import('metaapi.cloud-sdk')).default;
    metaApiInstance = new MetaApi(process.env.METAAPI_API_KEY);
  }

  return metaApiInstance;
}

const mapMetaApiError = (error: unknown): MT5ServiceError => {
  console.error('MetaAPI Error:', error);

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
  if (connectionCache.has(accountId)) {
    return connectionCache.get(accountId);
  }

  try {
    const api = await getMetaApi();
    const account = await api.metatraderAccountApi.getAccount(accountId);

    if (account.state !== 'DEPLOYED' && account.state !== 'DEPLOYING') {
      await account.deploy();
    }

    const connection = account.getRPCConnection();
    await connection.connect();

    connectionCache.set(accountId, connection);
    return connection;
  } catch (error) {
    connectionCache.delete(accountId);
    throw mapMetaApiError(error);
  }
};

const withRpcConnection = async <T>(accountId: string, operation: (connection: any) => Promise<T>): Promise<T> => {
  try {
    const connection = await getRpcConnection(accountId);
    return await operation(connection);
  } catch (error) {
    if (connectionCache.has(accountId)) {
      connectionCache.delete(accountId);
      const connection = await getRpcConnection(accountId);
      return operation(connection);
    }

    throw error;
  }
};

export const connectMT5Account = async (userId: string, login: string, password: string, server: string) => {
  try {
    const api = await getMetaApi();
    const account = await api.metatraderAccountApi.createAccount({
      name: `User-${userId}`,
      type: 'cloud',
      login,
      password,
      server,
      platform: 'mt5',
      magic: 1000,
    });

    await account.deploy();

    return {
      accountId: String(account.id),
      status: 'connecting' as const,
    };
  } catch (error) {
    console.error('MetaAPI Error:', error);
    throw new MT5ServiceError('metaapi_error', 'Failed to connect MT5 account', 502);
  }
};

export const checkMT5Connection = async (accountId: string) => {
  try {
    const api = await getMetaApi();
    const account = await api.metatraderAccountApi.getAccount(accountId);

    return {
      status: String(account.connectionStatus ?? 'DISCONNECTED'),
      state: String(account.state ?? 'UNDEPLOYED'),
    };
  } catch (error) {
    throw mapMetaApiError(error);
  }
};

export const disconnectMT5Account = async (accountId: string) => {
  try {
    connectionCache.delete(accountId);
    const api = await getMetaApi();
    const account = await api.metatraderAccountApi.getAccount(accountId);
    await account.undeploy();
  } catch (error) {
    throw mapMetaApiError(error);
  }
};

export const getMT5AccountState = async (accountId: string): Promise<MT5AccountSnapshot> => {
  const info: any = await withRpcConnection(accountId, (connection) => connection.getAccountInformation());

  return {
    balance: Number(info.balance ?? 0),
    equity: Number(info.equity ?? info.balance ?? 0),
    freeMargin: Number(info.freeMargin ?? 0),
    currency: String(info.currency ?? 'USD'),
  };
};

export const executeMT5Trade = async (accountId: string, trade: MT5TradeRequest): Promise<MT5TradeResult> => {
  try {
    const result: any = await withRpcConnection(accountId, (connection) => (
      trade.type === 'buy'
        ? connection.createMarketBuyOrder(trade.symbol, trade.volume, trade.sl ?? null, trade.tp ?? null)
        : connection.createMarketSellOrder(trade.symbol, trade.volume, trade.sl ?? null, trade.tp ?? null)
    ));

    return {
      orderId: String(result.orderId || result.positionId || Date.now()),
      rawResult: result,
    };
  } catch (error) {
    console.error('MT5 trade error:', error);
    throw new MT5ServiceError('metaapi_error', 'Trade execution failed', 502);
  }
};

export const getMT5OpenPositions = async (accountId: string): Promise<MT5Position[]> => {
  const positions: any[] = await withRpcConnection(accountId, (connection) => connection.getPositions());

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
  return withRpcConnection(accountId, (connection) => connection.closePosition(positionId));
};
