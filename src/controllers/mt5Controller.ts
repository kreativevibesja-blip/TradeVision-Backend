import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getMT5AccountByUserId, upsertMT5Account } from '../lib/supabase';
import { connectMT5Account, executeMT5Trade, MT5ServiceError } from '../services/mt5Service';

const getErrorResponse = (error: unknown) => {
  if (error instanceof MT5ServiceError) {
    return { status: error.statusCode, body: { error: error.message, code: error.code } };
  }

  return { status: 500, body: { error: 'Failed to process MT5 request.' } };
};

export const connectMT5 = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { login, password, server } = req.body;

    if (!login || !password || !server) {
      return res.status(400).json({ error: 'Login, password, and server are required.' });
    }

    const connection = await connectMT5Account(userId, String(login), String(password), String(server));

    await upsertMT5Account(userId, {
      metaapi_account_id: connection.accountId,
      login: String(login),
      server: String(server),
      status: 'connecting',
    });

    return res.json({
      success: true,
      accountId: connection.accountId,
      status: connection.status,
    });
  } catch (error) {
    console.error('[mt5] connect error:', error);
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
};

export const executeManualMT5Trade = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const mt5Account = await getMT5AccountByUserId(userId);
    if (!mt5Account) {
      return res.status(400).json({ error: 'No MT5 account connected.' });
    }

    const { symbol, type, sl, tp, volume } = req.body;
    if (!symbol || (type !== 'buy' && type !== 'sell')) {
      return res.status(400).json({ error: 'A valid symbol and trade type are required.' });
    }

    const result = await executeMT5Trade(mt5Account.metaapi_account_id, {
      symbol: String(symbol),
      type,
      sl: sl != null ? Number(sl) : undefined,
      tp: tp != null ? Number(tp) : undefined,
      volume: volume != null ? Number(volume) : 0.01,
    });

    return res.json({ success: true, orderId: result.orderId });
  } catch (error) {
    console.error('[mt5] trade error:', error);
    const response = getErrorResponse(error);
    return res.status(response.status).json(response.body);
  }
};
