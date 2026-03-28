import { Request, Response } from 'express';
import { getJamaicaDateInputValue } from '../utils/jamaicaTime';
import { upsertVisitorDailyRecord, upsertVisitorPresence } from '../lib/supabase';

export const heartbeatVisitor = async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    const currentPath = typeof req.body?.currentPath === 'string' ? req.body.currentPath.trim().slice(0, 255) : null;

    if (!sessionId || sessionId.length > 128) {
      return res.status(400).json({ error: 'A valid sessionId is required' });
    }

    const nowIso = new Date().toISOString();
    const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 500) : null;
    const visitorDate = getJamaicaDateInputValue();

    await Promise.all([
      upsertVisitorPresence({
        sessionId,
        currentPath,
        userAgent,
        lastSeenAt: nowIso,
      }),
      upsertVisitorDailyRecord({
        sessionId,
        visitorDate,
        lastSeenAt: nowIso,
      }),
    ]);

    return res.json({ success: true });
  } catch (error) {
    console.error('Visitor heartbeat error:', error);
    return res.status(500).json({ error: 'Failed to record visitor heartbeat' });
  }
};