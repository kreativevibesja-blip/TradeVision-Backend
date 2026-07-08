import { Response } from 'express';
import { supabase, hasTopTierAccess } from '../lib/supabase';
import { AuthRequest } from '../middleware/auth';
import { sendPushToUser } from '../services/pushService';
import { generateInstantSignal, InstantSignalAssetClass, InstantSignalCandle } from '../services/instantSignalEngine';

const ACTIVE_STATUSES = ['entry_now', 'active'];
const FINAL_STATUSES = ['tp_hit', 'sl_hit', 'expired', 'cancelled'];

const toCamelSignal = (row: any) => ({
  id: row.id,
  userId: row.user_id,
  market: row.market,
  assetClass: row.asset_class,
  source: row.source,
  timeframe: row.timeframe,
  direction: row.direction,
  status: row.status,
  entry: row.entry == null ? null : Number(row.entry),
  stopLoss: row.stop_loss == null ? null : Number(row.stop_loss),
  takeProfit: row.take_profit == null ? null : Number(row.take_profit),
  riskReward: row.risk_reward == null ? null : Number(row.risk_reward),
  confidence: row.confidence == null ? 0 : Number(row.confidence),
  confirmationRequired: row.confirmation_required ?? 0,
  confirmationText: row.confirmation_text,
  chartSnapshotUrl: row.chart_snapshot_url,
  result: row.result,
  resultPrice: row.result_price == null ? null : Number(row.result_price),
  resultAt: row.result_at,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  user: row.User ?? row.user ?? null,
});

const requireInstantSignalAccess = (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }

  if (!hasTopTierAccess(req.user.subscription)) {
    res.status(403).json({
      error: 'PRO+ plan required for Instant Signal',
      feature: 'instant_signal',
      requiredPlan: 'TOP_TIER',
      currentPlan: req.user.subscription,
    });
    return false;
  }

  return true;
};

const normalizeCandles = (value: unknown): InstantSignalCandle[] =>
  Array.isArray(value)
    ? value
        .map((candle) => ({
          time: Number((candle as any).time ?? Math.floor(new Date((candle as any).timestamp ?? 0).getTime() / 1000)),
          timestamp: typeof (candle as any).timestamp === 'string' ? (candle as any).timestamp : undefined,
          open: Number((candle as any).open),
          high: Number((candle as any).high),
          low: Number((candle as any).low),
          close: Number((candle as any).close),
        }))
        .filter((candle) => [candle.open, candle.high, candle.low, candle.close].every(Number.isFinite))
    : [];

const findActiveSignal = async (userId: string, market: string) => {
  const { data, error } = await supabase
    .from('instant_signals')
    .select('id,status')
    .eq('user_id', userId)
    .eq('market', market)
    .is('result', null)
    .in('status', ACTIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; status: string } | null;
};

const notifyUser = async (userId: string, title: string, body: string) => {
  try {
    await sendPushToUser(userId, { title, body, tag: 'instant-signal', url: '/dashboard/signals' });
  } catch (error) {
    console.warn('[instant-signal] push notification failed:', error);
  }
};

const createInstantSignal = async (req: AuthRequest, res: Response, assetClass: InstantSignalAssetClass) => {
  if (!requireInstantSignalAccess(req, res)) return;

  const symbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim().toUpperCase() : '';
  const timeframe = typeof req.body?.timeframe === 'string' ? req.body.timeframe.trim() : '';
  const candles = normalizeCandles(req.body?.candles);
  const currentPrice = Number(req.body?.currentPrice);
  const chartSnapshotUrl = typeof req.body?.chartSnapshotUrl === 'string' ? req.body.chartSnapshotUrl.trim() : null;

  if (!symbol || !timeframe || candles.length < 30) {
    return res.status(400).json({ error: 'symbol, timeframe, and at least 30 visible candles are required' });
  }

  try {
    const activeSignal = await findActiveSignal(req.user!.id, symbol);
    if (activeSignal) {
      return res.status(409).json({ error: 'ACTIVE_SIGNAL_EXISTS', signalId: activeSignal.id });
    }

    const signal = generateInstantSignal({
      market: symbol,
      assetClass,
      timeframe,
      candles,
      currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
    });

    const insert = {
      user_id: req.user!.id,
      market: signal.market,
      asset_class: signal.assetClass,
      source: assetClass === 'forex' ? 'tradingview-live' : 'deriv-live',
      timeframe: signal.timeframe,
      direction: signal.direction,
      status: signal.status,
      entry: signal.entry,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      risk_reward: signal.riskReward,
      confidence: signal.confidence,
      confirmation_required: signal.confirmationRequired,
      confirmation_text: signal.confirmationText,
      chart_snapshot_url: chartSnapshotUrl || null,
      expires_at: signal.expiresAt,
    };

    const { data, error } = await supabase.from('instant_signals').insert(insert).select('*').single();
    if (error) {
      throw new Error(error.message);
    }

      await notifyUser(req.user!.id, 'Instant signal generated', `${symbol} ${signal.direction === 'none' ? 'no signal' : `${signal.direction} signal active`}`);
    return res.status(201).json({ signal: toCamelSignal(data) });
  } catch (error: any) {
    console.error('[instant-signal] create failed:', error);
    return res.status(500).json({ error: error?.message || 'Failed to generate instant signal' });
  }
};

export const createForexInstantSignal = (req: AuthRequest, res: Response) => createInstantSignal(req, res, 'forex');
export const createDerivInstantSignal = (req: AuthRequest, res: Response) => createInstantSignal(req, res, 'deriv');

export const getMyInstantSignals = async (req: AuthRequest, res: Response) => {
  if (!requireInstantSignalAccess(req, res)) return;

  try {
    await expireOldSignals(req.user!.id);
    const { data, error } = await supabase
      .from('instant_signals')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false })
      .limit(120);

    if (error) throw new Error(error.message);
    return res.json({ signals: (data ?? []).map(toCamelSignal) });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load instant signals' });
  }
};

export const getMyActiveInstantSignal = async (req: AuthRequest, res: Response) => {
  if (!requireInstantSignalAccess(req, res)) return;
  const market = typeof req.query.market === 'string' ? req.query.market.trim().toUpperCase() : '';
  if (!market) return res.status(400).json({ error: 'market is required' });

  try {
    await expireOldSignals(req.user!.id);
    const { data, error } = await supabase
      .from('instant_signals')
      .select('*')
      .eq('user_id', req.user!.id)
      .eq('market', market)
      .is('result', null)
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return res.json({ signal: data ? toCamelSignal(data) : null });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to check active signal' });
  }
};

export const refreshMyInstantSignals = async (req: AuthRequest, res: Response) => {
  if (!requireInstantSignalAccess(req, res)) return;
  const prices = req.body?.prices && typeof req.body.prices === 'object' ? req.body.prices as Record<string, number> : {};

  try {
    const updates = await updateSignalLifecycle(req.user!.id, prices);
    return res.json({ success: true, updates });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to refresh instant signals' });
  }
};

export const closeMyInstantSignal = async (req: AuthRequest, res: Response) => {
  if (!requireInstantSignalAccess(req, res)) return;
  const signalId = req.params.id;

  try {
    const { data, error } = await supabase
      .from('instant_signals')
      .update({ status: 'cancelled', result: 'cancelled', result_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', signalId)
      .eq('user_id', req.user!.id)
      .select('*')
      .single();

    if (error) throw new Error(error.message);
    await notifyUser(req.user!.id, 'Instant signal closed', `${data.market} signal manually closed`);
    return res.json({ signal: toCamelSignal(data) });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to close instant signal' });
  }
};

const expireOldSignals = async (userId?: string) => {
  let query = supabase
    .from('instant_signals')
    .update({ status: 'expired', result: 'expired', result_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .is('result', null)
    .in('status', ACTIVE_STATUSES)
    .lt('expires_at', new Date().toISOString());

  if (userId) {
    query = query.eq('user_id', userId);
  }

  await query;
};

const hitTarget = (direction: string, price: number, target: number) => direction === 'buy' ? price >= target : price <= target;
const hitStop = (direction: string, price: number, stop: number) => direction === 'buy' ? price <= stop : price >= stop;

const updateSignalLifecycle = async (userId: string, prices: Record<string, number>) => {
  await expireOldSignals(userId);

  const { data, error } = await supabase
    .from('instant_signals')
    .select('*')
    .eq('user_id', userId)
    .is('result', null)
    .in('status', ACTIVE_STATUSES);

  if (error) throw new Error(error.message);

  const updates: any[] = [];
  for (const signal of data ?? []) {
    const price = Number(prices[signal.market]);
    if (!Number.isFinite(price) || signal.direction === 'none') {
      continue;
    }

    let patch: Record<string, unknown> | null = null;
    if (signal.take_profit != null && hitTarget(signal.direction, price, Number(signal.take_profit))) {
      patch = { status: 'tp_hit', result: 'win', result_price: price, result_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    } else if (signal.stop_loss != null && hitStop(signal.direction, price, Number(signal.stop_loss))) {
      patch = { status: 'sl_hit', result: 'loss', result_price: price, result_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    }

    if (patch) {
      const { data: updated, error: updateError } = await supabase.from('instant_signals').update(patch).eq('id', signal.id).select('*').single();
      if (updateError) throw new Error(updateError.message);
      updates.push(toCamelSignal(updated));
      if (patch.status === 'tp_hit') await notifyUser(userId, 'TP hit', `${signal.market} signal hit take profit`);
      if (patch.status === 'sl_hit') await notifyUser(userId, 'SL hit', `${signal.market} signal hit stop loss`);
    }
  }

  return updates;
};

export const getAdminInstantSignals = async (req: AuthRequest, res: Response) => {
  const { user, market, result, from, to } = req.query;
  try {
    let query = supabase
      .from('instant_signals')
      .select('*, User:user_id(email,name,subscription)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(200);

    if (typeof user === 'string' && user.trim()) query = query.eq('user_id', user.trim());
    if (typeof market === 'string' && market.trim()) query = query.ilike('market', `%${market.trim()}%`);
    if (typeof result === 'string' && result.trim() && result !== 'all') query = query.eq('result', result.trim());
    if (typeof from === 'string' && from.trim()) query = query.gte('created_at', from.trim());
    if (typeof to === 'string' && to.trim()) query = query.lte('created_at', to.trim());

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return res.json({ signals: (data ?? []).map(toCamelSignal), total: count ?? 0 });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load admin instant signals' });
  }
};

export const adminUpdateInstantSignal = async (req: AuthRequest, res: Response) => {
  const signalId = req.params.id;
  const status = typeof req.body?.status === 'string' ? req.body.status : null;
  const result = typeof req.body?.result === 'string' ? req.body.result : null;
  const resultPrice = Number(req.body?.resultPrice);

  if (status && ![...ACTIVE_STATUSES, ...FINAL_STATUSES, 'no_signal'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) patch.status = status;
    if (result) patch.result = result;
    if (Number.isFinite(resultPrice)) patch.result_price = resultPrice;
    if (status && FINAL_STATUSES.includes(status)) patch.result_at = new Date().toISOString();

    const { data, error } = await supabase.from('instant_signals').update(patch).eq('id', signalId).select('*').single();
    if (error) throw new Error(error.message);
    return res.json({ signal: toCamelSignal(data) });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to update instant signal' });
  }
};
