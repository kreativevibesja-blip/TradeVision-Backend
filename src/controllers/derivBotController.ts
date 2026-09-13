import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import {
  completeDerivOAuth,
  createDerivOAuthUrl,
  disconnectDerivAccounts,
  listDerivAccounts,
} from '../services/derivBotService';
import {
  disconnectDerivBotSession,
  getDerivBotSession,
  getDerivBotProposal,
  getDerivBotTradeHistory,
  placeDerivBotTrade,
  scanDerivBot,
  selectDerivBotAccount,
  type DerivBotContractType,
} from '../services/derivBotTradingService';
import { config } from '../config';

function requireUser(req: AuthRequest) {
  if (!req.user) throw new Error('Authentication required.');
  return req.user;
}

export async function connectDerivBot(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    return res.json({ authorizationUrl: createDerivOAuthUrl(user.id) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to start Deriv OAuth.' });
  }
}

export async function derivBotCallback(req: AuthRequest, res: Response) {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  try {
    if (!state || !code) throw new Error('Deriv OAuth callback is missing state or code.');
    const result = await completeDerivOAuth(state, code);
    return res.redirect(`${config.frontend.url}/dashboard/deriv-bot?connected=1&account=${encodeURIComponent(result.accounts[0]?.id ?? '')}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deriv OAuth failed.';
    return res.redirect(`${config.frontend.url}/dashboard/deriv-bot?derivError=${encodeURIComponent(message)}`);
  }
}

export async function getDerivBotAccounts(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    return res.json({ accounts: await listDerivAccounts(user.id) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load Deriv accounts.' });
  }
}

export async function disconnectDerivBot(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    await disconnectDerivAccounts(user.id);
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to disconnect Deriv.' });
  }
}

export async function selectDerivBotAccountHandler(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : '';
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol : '';
    const account = (await listDerivAccounts(user.id)).find((item) => item.id === accountId);
    if (!account || !symbol) return res.status(400).json({ error: 'A connected account and symbol are required.' });
    const session = await selectDerivBotAccount({ userId: user.id, accountId, accountType: account.accountType, currency: account.currency, symbol });
    return res.json({ session });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to select Deriv account.' });
  }
}

export async function getDerivBotSessionHandler(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : '';
    return res.json({ session: getDerivBotSession(user.id, accountId) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load Deriv session.' });
  }
}

export async function scanDerivBotHandler(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : '';
    const stake = Number(req.body?.stake);
    const duration = Number(req.body?.duration ?? 1);
    return res.json({ scan: await scanDerivBot(user.id, accountId, stake, duration) });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to scan Deriv ticks.' });
  }
}

export async function getDerivBotProposalHandler(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    const contractType = req.body?.contractType as DerivBotContractType;
    if (contractType !== 'DIGITMATCH' && contractType !== 'DIGITDIFF') return res.status(400).json({ error: 'Unsupported contract type.' });
    const proposal = await getDerivBotProposal(user.id, String(req.body?.accountId ?? ''), contractType, Number(req.body?.digit), Number(req.body?.stake), Number(req.body?.duration ?? 1));
    return res.json({ proposal });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to refresh Deriv proposal.' });
  }
}

export async function getDerivBotTradeHistoryHandler(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
    return res.json(await getDerivBotTradeHistory(user.id, accountId));
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to load Deriv trade history.' });
  }
}

export async function tradeDerivBotHandler(req: AuthRequest, res: Response) {
  try {
    const user = requireUser(req);
    const contractType = req.body?.contractType as DerivBotContractType;
    if (contractType !== 'DIGITMATCH' && contractType !== 'DIGITDIFF') return res.status(400).json({ error: 'Unsupported contract type.' });
    const trade = await placeDerivBotTrade(user.id, String(req.body?.accountId ?? ''), contractType, Number(req.body?.digit), Number(req.body?.stake), Number(req.body?.duration ?? 1));
    return res.status(201).json({ trade });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Unable to place Deriv trade.' });
  }
}

export async function disconnectDerivBotSessionHandler(req: AuthRequest, res: Response) {
  const user = requireUser(req);
  disconnectDerivBotSession(user.id, typeof req.body?.accountId === 'string' ? req.body.accountId : undefined);
  return res.json({ success: true });
}
