import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { savePushSubscription, removePushSubscription, sendPushToUser } from '../services/pushService';

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

// POST /api/notifications/signals
export const sendSignalNotification = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const {
      source,
      session,
      direction,
      symbol,
      timeframe,
      entry,
      stopLoss,
      takeProfit,
    } = req.body as {
      source?: 'deriv' | 'tradingview';
      session?: 'asian' | 'london' | 'newyork';
      direction?: 'buy' | 'sell';
      symbol?: string;
      timeframe?: string;
      entry?: number;
      stopLoss?: number;
      takeProfit?: number;
    };

    if (!source || (source !== 'deriv' && source !== 'tradingview')) {
      return res.status(400).json({ error: 'Valid source is required' });
    }

    if (!session || !['asian', 'london', 'newyork'].includes(session)) {
      return res.status(400).json({ error: 'Valid session is required' });
    }

    if (!direction || (direction !== 'buy' && direction !== 'sell')) {
      return res.status(400).json({ error: 'Valid direction is required' });
    }

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'symbol is required' });
    }

    if (!timeframe || typeof timeframe !== 'string') {
      return res.status(400).json({ error: 'timeframe is required' });
    }

    for (const value of [entry, stopLoss, takeProfit]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return res.status(400).json({ error: 'entry, stopLoss, and takeProfit must be valid numbers' });
      }
    }

    const sent = await sendPushToUser(req.user.id, {
      title: `${symbol} ${direction.toUpperCase()} signal`,
      body: `${session.toUpperCase()} · ${timeframe} · Entry ${entry} · SL ${stopLoss} · TP ${takeProfit}`,
      tag: `signals-${source}-${session}-${symbol}-${timeframe}`,
      url: source === 'tradingview' ? '/dashboard/tradingview' : '/dashboard/signals',
    });

    return res.json({ success: true, sent });
  } catch (error: any) {
    console.error('[Push] Signal notification error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to send signal notification' });
  }
};
