import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { getGoldxPulseAccess } from '../services/goldxPulse/access';
import {
  clearGoldxPulseTrades,
  connectGoldxPulse,
  disconnectGoldxPulse,
  getGoldxPulseSnapshot,
  getGoldxPulseSymbols,
  placeGoldxPulseTrade,
  subscribeGoldxPulse,
  updateGoldxPulseSettings,
} from '../services/goldxPulse/service';

function getUserOrThrow(req: AuthRequest) {
  if (!req.user) {
    throw new Error('Authentication required.');
  }

  return req.user;
}

export async function getGoldxPulseAccessHandler(req: AuthRequest, res: Response) {
  const user = getUserOrThrow(req);
  const access = await getGoldxPulseAccess(user.id, user.subscription, user.role);
  res.json({ access, symbols: getGoldxPulseSymbols() });
}

export async function getGoldxPulseSessionHandler(req: AuthRequest, res: Response) {
  const user = getUserOrThrow(req);
  res.json({ snapshot: getGoldxPulseSnapshot(user.id), symbols: getGoldxPulseSymbols() });
}

export async function connectGoldxPulseHandler(req: AuthRequest, res: Response) {
  try {
    const user = getUserOrThrow(req);
    const apiToken = typeof req.body?.apiToken === 'string' ? req.body.apiToken.trim() : '';
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim() : undefined;

    if (!apiToken) {
      return res.status(400).json({ error: 'API token is required.' });
    }

    const account = await connectGoldxPulse(user.id, apiToken, symbol);
    return res.json({ account, snapshot: getGoldxPulseSnapshot(user.id) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to connect Deriv account.' });
  }
}

export async function disconnectGoldxPulseHandler(req: AuthRequest, res: Response) {
  const user = getUserOrThrow(req);
  disconnectGoldxPulse(user.id);
  res.json({ success: true });
}

export async function updateGoldxPulseSettingsHandler(req: AuthRequest, res: Response) {
  try {
    const user = getUserOrThrow(req);
    const snapshot = await updateGoldxPulseSettings(user.id, req.body ?? {});
    return res.json({ snapshot });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to update GoldX Pulse settings.' });
  }
}

export async function placeGoldxPulseTradeHandler(req: AuthRequest, res: Response) {
  try {
    const user = getUserOrThrow(req);
    const trade = await placeGoldxPulseTrade(user.id, req.body ?? {});
    return res.json({ trade, snapshot: getGoldxPulseSnapshot(user.id) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to place GoldX Pulse trade.' });
  }
}

export async function clearGoldxPulseTradesHandler(req: AuthRequest, res: Response) {
  try {
    const user = getUserOrThrow(req);
    const snapshot = clearGoldxPulseTrades(user.id);
    return res.json({ success: true, snapshot });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to clear GoldX Pulse results.' });
  }
}

export async function goldxPulseStreamHandler(req: AuthRequest, res: Response) {
  const user = getUserOrThrow(req);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendSnapshot = (snapshot: unknown) => {
    res.write(`event: pulse-snapshot\n`);
    res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  };

  const unsubscribe = subscribeGoldxPulse(user.id, sendSnapshot);
  const keepAlive = setInterval(() => {
    res.write('event: pulse-heartbeat\n');
    res.write(`data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
}
