import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { listClientEgressMetrics, recordClientEgressMetric } from '../lib/clientEgressMetrics';

export const ingestClientEgressMetrics = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const tabId = typeof req.body?.tabId === 'string' ? req.body.tabId.trim() : '';
    const route = typeof req.body?.route === 'string' ? req.body.route.trim() : '';
    const metrics = req.body?.metrics;

    if (!tabId || !route || !metrics || typeof metrics !== 'object') {
      return res.status(400).json({ error: 'Invalid metrics payload' });
    }

    const row = recordClientEgressMetric({
      userId: req.user.id,
      tabId,
      route,
      metrics: {
        authRefreshCount: Number(metrics.authRefreshCount) || 0,
        sessionFetchCount: Number(metrics.sessionFetchCount) || 0,
        listenerCount: Number(metrics.listenerCount) || 0,
        pollingCount: Number(metrics.pollingCount) || 0,
        activeChannels: Number(metrics.activeChannels) || 0,
      },
    });

    return res.json({ recorded: true, row });
  } catch (error) {
    console.error('Client egress ingest error:', error);
    return res.status(500).json({ error: 'Failed to record client egress metrics' });
  }
};

export const getClientEgressMetrics = async (req: Request, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 250;
    return res.json({ rows: listClientEgressMetrics(limit) });
  } catch (error) {
    console.error('Client egress fetch error:', error);
    return res.status(500).json({ error: 'Failed to load client egress metrics' });
  }
};
