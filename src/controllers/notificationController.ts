import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { hasPaidSubscription, hasTopTierAccess } from '../lib/supabase';
import { isSupportedLiveChartTimeframe, resolveLiveChartSymbol } from '../services/marketData';
import { savePushSubscription, removePushSubscription, sendPushToUser } from '../services/pushService';
import { getSignalsWatchlist, saveSignalsWatchlist } from '../services/signalsMonitor';

const VALID_DERIV_TIMEFRAMES = new Set(['1m', '5m', '15m', '30m', '1H', '4H', '1D']);

const isSignalSource = (value: unknown): value is 'deriv' | 'tradingview' => value === 'deriv' || value === 'tradingview';

const hasSignalsAccess = (subscription: string, source: 'deriv' | 'tradingview') =>
  source === 'deriv' ? hasTopTierAccess(subscription) : hasPaidSubscription(subscription);

const isSupportedWatchlist = (source: 'deriv' | 'tradingview', symbol: string, timeframe: string) => {
  if (source === 'tradingview') {
    return Boolean(resolveLiveChartSymbol(symbol)) && isSupportedLiveChartTimeframe(timeframe);
  }

  return VALID_DERIV_TIMEFRAMES.has(timeframe);
};

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

export const getSignalWatchlist = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const source = req.query?.source;
    if (!isSignalSource(source)) {
      return res.status(400).json({ error: 'Valid source is required' });
    }

    const watchlist = await getSignalsWatchlist(req.user.id, source);
    return res.json({ watchlist });
  } catch (error: any) {
    console.error('[Push] Watchlist fetch error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to load signal watchlist' });
  }
};

export const updateSignalWatchlist = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const source = req.body?.source;
    const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim() : '';
    const timeframe = typeof req.body?.timeframe === 'string' ? req.body.timeframe.trim() : '';
    const symbolLabel = typeof req.body?.symbolLabel === 'string' ? req.body.symbolLabel.trim() : symbol;
    const assetClass = typeof req.body?.assetClass === 'string' ? req.body.assetClass.trim() : undefined;
    const enabled = req.body?.enabled !== false;

    if (!isSignalSource(source)) {
      return res.status(400).json({ error: 'Valid source is required' });
    }

    if (!hasSignalsAccess(req.user.subscription, source)) {
      return res.status(403).json({ error: 'Your current plan does not include this signals feed' });
    }

    if (!symbol || !timeframe || !isSupportedWatchlist(source, symbol, timeframe)) {
      return res.status(400).json({ error: 'Valid symbol and timeframe are required' });
    }

    const watchlist = await saveSignalsWatchlist(req.user.id, {
      source,
      symbol,
      timeframe,
      symbolLabel,
      assetClass,
      enabled,
      syncedAt: new Date().toISOString(),
    });

    return res.json({ watchlist });
  } catch (error: any) {
    console.error('[Push] Watchlist update error:', error);
    return res.status(500).json({ error: error?.message || 'Failed to save signal watchlist' });
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
