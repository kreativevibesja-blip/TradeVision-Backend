import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { registerScannerPanelStream } from '../lib/scanner/panelStream';
import {
  getActiveSessionsForUser,
  toggleScannerSession,
  getScanResults,
  getAlertsForUser,
  markAlertsRead,
  getSessionSummary,
  getPotentialTrades,
  runSessionScanner,
  checkZoneProximityAlerts,
  getRealtimeScannerPanels,
  expireSessionResults,
  isSessionActive,
  getCurrentSessionTypes,
  SCANNER_SYMBOLS,
  SCANNER_TIMEFRAME,
  type SessionType,
} from '../services/scannerService';

const isValidSessionType = (value: unknown): value is SessionType =>
  value === 'london' || value === 'newyork' || value === 'volatility';

// GET /api/scanner/status
export const getScannerStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sessions = await getActiveSessionsForUser(req.user.id);
    const activeSessions = getCurrentSessionTypes();

    return res.json({
      sessions,
      activeWindows: activeSessions,
      londonActive: isSessionActive('london'),
      newyorkActive: isSessionActive('newyork'),
      volatilityActive: isSessionActive('volatility'),
      symbols: SCANNER_SYMBOLS,
      timeframe: SCANNER_TIMEFRAME,
    });
  } catch (error: any) {
    console.error('[Scanner] Status error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to get scanner status' });
  }
};

// POST /api/scanner/toggle
export const toggleScanner = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { sessionType, enabled } = req.body;
    if (!isValidSessionType(sessionType)) {
      return res.status(400).json({ error: 'Invalid session type. Use "london", "newyork", or "volatility".' });
    }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const session = await toggleScannerSession(req.user.id, sessionType, enabled);
    return res.json({ session });
  } catch (error: any) {
    console.error('[Scanner] Toggle error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to toggle scanner' });
  }
};

// POST /api/scanner/scan
export const triggerScan = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { results, alerts } = await runSessionScanner(req.user.id);
    return res.json({ results, alerts });
  } catch (error: any) {
    console.error('[Scanner] Scan error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to run scanner' });
  }
};

// GET /api/scanner/results
export const getResults = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sessionType = typeof req.query.sessionType === 'string' && isValidSessionType(req.query.sessionType)
      ? req.query.sessionType
      : undefined;
    const scope = req.query.scope === 'current' || req.query.scope === 'history' ? req.query.scope : 'all';
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const results = await getScanResults(req.user.id, sessionType, limit, scope);
    return res.json({ results });
  } catch (error: any) {
    console.error('[Scanner] Results error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to get scan results' });
  }
};

// GET /api/scanner/alerts
export const getAlerts = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const unreadOnly = req.query.unreadOnly === 'true';
    const alerts = await getAlertsForUser(req.user.id, unreadOnly);
    return res.json({ alerts });
  } catch (error: any) {
    console.error('[Scanner] Alerts error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to get alerts' });
  }
};

// POST /api/scanner/alerts/read
export const markRead = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { alertIds } = req.body;
    if (!Array.isArray(alertIds) || alertIds.some((id: unknown) => typeof id !== 'string')) {
      return res.status(400).json({ error: 'alertIds must be an array of strings' });
    }

    await markAlertsRead(req.user.id, alertIds);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[Scanner] Mark read error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to mark alerts read' });
  }
};

// GET /api/scanner/summary
export const getSummary = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const sessionType = typeof req.query.sessionType === 'string' && isValidSessionType(req.query.sessionType)
      ? req.query.sessionType
      : undefined;

    const summary = await getSessionSummary(req.user.id, sessionType);
    return res.json({ summary });
  } catch (error: any) {
    console.error('[Scanner] Summary error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to get session summary' });
  }
};

// GET /api/scanner/potentials
export const getPotentials = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const limit = Math.min(parseInt(req.query.limit as string) || 12, 20);
    const potentials = await getPotentialTrades(req.user.id, limit);
    return res.json({ potentials });
  } catch (error: any) {
    console.error('[Scanner] Potential trades error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to get potential trades' });
  }
};

// GET /api/scanner/stream
export const streamScannerPanels = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    registerScannerPanelStream(req.user.id, res, () => getRealtimeScannerPanels(req.user!.id));
  } catch (error: any) {
    console.error('[Scanner] Stream error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error?.message || 'Failed to open scanner stream' });
    }
  }
};
// POST /api/scanner/check-proximity
export const checkProximity = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const alerts = await checkZoneProximityAlerts(req.user.id);
    return res.json({ alerts });
  } catch (error: any) {
    console.error('[Scanner] Proximity check error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to check zone proximity' });
  }
};

// POST /api/scanner/expire
export const expireSession = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { sessionType } = req.body;
    if (!isValidSessionType(sessionType)) {
      return res.status(400).json({ error: 'Invalid session type' });
    }

    await expireSessionResults(req.user.id, sessionType);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[Scanner] Expire error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to expire session' });
  }
};
