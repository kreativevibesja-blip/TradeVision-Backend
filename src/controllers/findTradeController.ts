import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import {
  addFindTradeJournalNote,
  getFindTradeHistory,
  getFindTradeJournal,
  getFindTradeJournalInsights,
  getFindTradeStatus,
  resetFindTrade,
  runFindTradeScan,
  updateOpportunityDecision,
} from '../services/findTradeService';

export const scanFindTrade = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const mode = req.body?.mode === 'manual_refresh' ? 'manual_refresh' : 'on_demand';
    const status = await runFindTradeScan(req.user.id, mode);
    return res.json(status);
  } catch (error: any) {
    console.error('[find-trade] scan failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to run find-trade scan' });
  }
};

export const resetFindTradeHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const status = await resetFindTrade(req.user.id);
    return res.json(status);
  } catch (error: any) {
    console.error('[find-trade] reset failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to reset find-trade state' });
  }
};

export const enteredFindTrade = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const opportunityId = typeof req.body?.opportunityId === 'string' ? req.body.opportunityId : '';
    const action = req.body?.action;

    if (!opportunityId || !['entered', 'watchlist', 'ignore', 'not_yet'].includes(action)) {
      return res.status(400).json({ error: 'Valid opportunityId and action are required' });
    }

    const status = await updateOpportunityDecision(req.user.id, { opportunityId, action });
    return res.json(status);
  } catch (error: any) {
    console.error('[find-trade] decision failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to update trade decision' });
  }
};

export const getFindTradeStatusHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const scanId = typeof req.params.id === 'string' && req.params.id !== 'latest' ? req.params.id : undefined;
    const status = await getFindTradeStatus(req.user.id, scanId);
    return res.json(status);
  } catch (error: any) {
    console.error('[find-trade] status failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to load find-trade status' });
  }
};

export const getFindTradeHistoryHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const history = await getFindTradeHistory(req.user.id);
    return res.json(history);
  } catch (error: any) {
    console.error('[find-trade] history failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to load find-trade history' });
  }
};

export const getJournalHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const journal = await getFindTradeJournal(req.user.id);
    return res.json(journal);
  } catch (error: any) {
    console.error('[find-trade] journal failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to load journal' });
  }
};

export const getJournalInsightsHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const insights = await getFindTradeJournalInsights(req.user.id);
    return res.json(insights);
  } catch (error: any) {
    console.error('[find-trade] journal insights failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to load journal insights' });
  }
};

export const postJournalNoteHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const payload = {
      journalId: typeof req.body?.journalId === 'string' ? req.body.journalId : undefined,
      trackingId: typeof req.body?.trackingId === 'string' ? req.body.trackingId : undefined,
      note: typeof req.body?.note === 'string' ? req.body.note : '',
    };
    const journal = await addFindTradeJournalNote(req.user.id, payload);
    return res.json(journal);
  } catch (error: any) {
    console.error('[find-trade] journal note failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to save journal note' });
  }
};