import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { savePushSubscription, removePushSubscription } from '../services/pushService';

// POST /api/notifications/subscribe
export const subscribe = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { endpoint, p256dh, auth } = req.body;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint is required' });
    }
    if (!p256dh || typeof p256dh !== 'string') {
      return res.status(400).json({ error: 'p256dh key is required' });
    }
    if (!auth || typeof auth !== 'string') {
      return res.status(400).json({ error: 'auth key is required' });
    }

    await savePushSubscription(req.user.id, endpoint, p256dh, auth);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[Push] Subscribe error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to save subscription' });
  }
};

// POST /api/notifications/unsubscribe
export const unsubscribe = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const { endpoint } = req.body;

    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'endpoint is required' });
    }

    await removePushSubscription(req.user.id, endpoint);
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[Push] Unsubscribe error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to remove subscription' });
  }
};
