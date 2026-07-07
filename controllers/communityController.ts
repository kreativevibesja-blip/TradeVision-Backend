import { randomUUID } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { supabase } from '../lib/supabase';

type Agreement = 'agrees' | 'partially_agrees' | 'disagrees' | 'unclear';
type RecommendedAction = 'enter_now' | 'wait_for_confirmation' | 'send_to_trade_radar' | 'avoid_trade';

type FeedPostRow = {
  id: string;
  user_id: string;
  body: string;
  market_tag: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  ai_summary: string | null;
  post_type: string;
  hide_ai_compares?: boolean | null;
};

type AiCompareResult = {
  bias: string;
  marketStructure: string;
  liquidity: string;
  keyLevels: string[];
  tradeIdea: string;
  confidence: number;
  riskNotes: string;
  agreementWithPost: Agreement;
  recommendedAction: RecommendedAction;
  mentorFeedback: string;
};

const settingValue = async (key: string) => {
  const { data } = await supabase.from('SystemSettings').select('value').eq('key', key).maybeSingle();
  return data?.value;
};

const numberSetting = async (key: string, fallback: number) => {
  const raw = await settingValue(key);
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const isAiCompareEnabled = async () => {
  const raw = await settingValue('ai_compare.enabled');
  if (raw === undefined || raw === null) return true;
  if (typeof raw === 'boolean') return raw;
  return !['false', '0', 'off', 'disabled'].includes(String(raw).toLowerCase());
};

const planLimit = async (subscription: string) => {
  if (subscription === 'FREE') {
    return { limit: await numberSetting('ai_compare.limit.FREE', 1), period: 'day' as const };
  }
  if (subscription === 'PRO') {
    return { limit: await numberSetting('ai_compare.limit.PRO', 10), period: 'week' as const };
  }
  return { limit: await numberSetting(`ai_compare.limit.${subscription}`, 100), period: 'month' as const };
};

const periodBounds = (period: 'day' | 'week' | 'month') => {
  const now = new Date();
  const start = new Date(now);

  if (period === 'day') {
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  if (period === 'week') {
    const day = start.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setUTCDate(start.getUTCDate() - diff);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
  }

  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
};

const buildCompareResult = (post: FeedPostRow): AiCompareResult => {
  const text = `${post.body || ''} ${post.ai_summary || ''} ${post.market_tag || ''}`.toLowerCase();
  const bullish = /bull|buy|long|demand|support|breakout/.test(text);
  const bearish = /bear|sell|short|supply|resistance|rejection/.test(text);
  const confidence = post.ai_summary ? 78 : post.image_url ? 70 : 62;
  const agreement: Agreement = bullish || bearish ? 'partially_agrees' : 'unclear';
  const action: RecommendedAction = confidence >= 76 ? 'wait_for_confirmation' : 'send_to_trade_radar';
  const bias = bullish && !bearish ? 'Bullish with confirmation required' : bearish && !bullish ? 'Bearish with confirmation required' : 'Neutral until structure confirms';

  return {
    bias,
    marketStructure: 'Orion sees a chart idea that needs structure confirmation before it becomes a high-quality setup. The posted view has educational value, but confirmation should lead the decision.',
    liquidity: 'Watch the nearest swing high/low and the zone around the posted entry idea. A sweep into liquidity followed by displacement would improve quality.',
    keyLevels: [
      post.market_tag || 'Posted market zone',
      bullish ? 'Demand/support reaction area' : bearish ? 'Supply/resistance reaction area' : 'Recent swing range',
      'Invalidation beyond the opposite side of the setup zone',
    ],
    tradeIdea: 'Orion’s independent view is to use the post as a watchlist idea, then wait for confirmation rather than entering only because the chart was shared.',
    confidence,
    riskNotes: 'Avoid oversized entries before confirmation. If price invalidates the posted zone, archive the idea instead of forcing a trade.',
    agreementWithPost: agreement,
    recommendedAction: action,
    mentorFeedback: 'Orion partially agrees with the idea, but the entry appears early. Structure has not fully confirmed yet. A cleaner approach would be to monitor the zone until confirmation forms.',
  };
};

const getPost = async (postId: string) => {
  const { data, error } = await supabase
    .from('feed_posts')
    .select('id,user_id,body,market_tag,image_url,thumbnail_url,ai_summary,post_type,hide_ai_compares')
    .eq('id', postId)
    .eq('is_hidden', false)
    .maybeSingle();

  if (error) throw error;
  return data as FeedPostRow | null;
};

const getUsage = async (userId: string, plan: string) => {
  const limits = await planLimit(plan);
  const bounds = periodBounds(limits.period);
  const periodStart = bounds.start.toISOString();
  const periodEnd = bounds.end.toISOString();

  const { data: existing, error: existingError } = await supabase
    .from('ai_compare_usage')
    .select('id,user_id,period_start,period_end,used_count,limit_count,plan')
    .eq('user_id', userId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .eq('plan', plan)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing as any;

  const { data, error } = await supabase
    .from('ai_compare_usage')
    .insert({
      user_id: userId,
      period_start: periodStart,
      period_end: periodEnd,
      used_count: 0,
      limit_count: limits.limit,
      plan,
    })
    .select('id,user_id,period_start,period_end,used_count,limit_count,plan')
    .single();

  if (error) throw error;
  return data as any;
};

export const runAiCompare = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const postId = req.params.postId;
    const forceRerun = req.body?.rerun === true;

    if (!(await isAiCompareEnabled())) {
      return res.status(403).json({ error: 'AI Compare is currently disabled.' });
    }

    const post = await getPost(postId);
    if (!post) return res.status(404).json({ error: 'Feed post not found' });

    const chartImageUrl = post.image_url || post.thumbnail_url;
    if (!chartImageUrl) {
      return res.status(400).json({ error: 'AI Compare requires a chart image on the post.' });
    }

    const { data: cached, error: cachedError } = await supabase
      .from('ai_compare_results')
      .select('id,post_id,user_id,chart_image_url,result_json,agreement,confidence,visibility,created_at')
      .eq('post_id', postId)
      .eq('user_id', userId)
      .maybeSingle();

    if (cachedError) throw cachedError;
    if (cached && !forceRerun) {
      const usage = await getUsage(userId, req.user!.subscription);
      return res.json({ compare: cached, usage, cached: true });
    }

    const usage = await getUsage(userId, req.user!.subscription);
    if ((usage.used_count || 0) >= (usage.limit_count || 0)) {
      return res.status(403).json({ error: 'AI Compare quota reached for this plan period.', usage });
    }

    const result = buildCompareResult(post);

    const payload = {
      post_id: postId,
      user_id: userId,
      chart_image_url: chartImageUrl,
      result_json: result,
      agreement: result.agreementWithPost,
      confidence: result.confidence,
      visibility: 'private',
      updated_at: new Date().toISOString(),
    };

    const { data: compare, error: compareError } = await supabase
      .from('ai_compare_results')
      .upsert(payload, { onConflict: 'post_id,user_id' })
      .select('id,post_id,user_id,chart_image_url,result_json,agreement,confidence,visibility,created_at')
      .single();

    if (compareError) throw compareError;

    const { data: nextUsage, error: usageError } = await supabase
      .from('ai_compare_usage')
      .update({ used_count: (usage.used_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', usage.id)
      .select('id,user_id,period_start,period_end,used_count,limit_count,plan')
      .single();

    if (usageError) throw usageError;
    return res.json({ compare, usage: nextUsage, cached: false });
  } catch (error) {
    console.error('AI Compare error:', error);
    return res.status(500).json({ error: 'Failed to run AI Compare' });
  }
};

export const getPostAiCompares = async (req: AuthRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('ai_compare_results')
      .select('id,post_id,user_id,chart_image_url,result_json,agreement,confidence,visibility,created_at')
      .eq('post_id', req.params.postId)
      .eq('visibility', 'public_comment')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return res.json({ compares: data || [] });
  } catch (error) {
    console.error('Get AI Compares error:', error);
    return res.status(500).json({ error: 'Failed to load AI Compares' });
  }
};

export const publishAiCompare = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const compareId = req.params.compareId;

    const { data: compare, error: compareError } = await supabase
      .from('ai_compare_results')
      .select('id,post_id,user_id,result_json,published_comment_id')
      .eq('id', compareId)
      .eq('user_id', userId)
      .maybeSingle();

    if (compareError) throw compareError;
    if (!compare) return res.status(404).json({ error: 'AI Compare result not found' });

    const post = await getPost(compare.post_id);
    if (!post) return res.status(404).json({ error: 'Feed post not found' });
    if (post.hide_ai_compares) return res.status(403).json({ error: 'The original poster has hidden AI Compares on this post.' });

    const result = compare.result_json as AiCompareResult;
    const body = `Orion AI Compare: ${result.mentorFeedback}`;

    let commentId = compare.published_comment_id as string | null;
    if (!commentId) {
      const { data: comment, error: commentError } = await supabase
        .from('feed_comments')
        .insert({
          post_id: compare.post_id,
          user_id: userId,
          body,
          comment_type: 'orion_ai_compare',
          ai_compare_result_id: compareId,
        })
        .select('id')
        .single();

      if (commentError) throw commentError;
      commentId = comment.id;
    }

    const { data: updated, error: updateError } = await supabase
      .from('ai_compare_results')
      .update({ visibility: 'public_comment', published_comment_id: commentId, updated_at: new Date().toISOString() })
      .eq('id', compareId)
      .select('id,post_id,user_id,chart_image_url,result_json,agreement,confidence,visibility,created_at')
      .single();

    if (updateError) throw updateError;

    if (post.user_id !== userId) {
      await supabase.from('notifications').insert({
        user_id: post.user_id,
        type: 'ai_compare_published',
        title: 'Orion AI Compare',
        body: 'Orion AI added an independent view to your setup.',
        href: '/dashboard/feed',
      });
    }

    return res.json({ compare: updated, commentId });
  } catch (error) {
    console.error('Publish AI Compare error:', error);
    return res.status(500).json({ error: 'Failed to publish AI Compare' });
  }
};

export const saveAiCompareToJournal = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { data: compare, error } = await supabase
      .from('ai_compare_results')
      .select('id,post_id,user_id,chart_image_url,result_json')
      .eq('id', req.params.compareId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!compare) return res.status(404).json({ error: 'AI Compare result not found' });

    const result = compare.result_json as AiCompareResult;
    const { data: journal, error: journalError } = await supabase
      .from('journal_entries')
      .insert({
        user_id: userId,
        symbol: 'Community post',
        outcome: 'open',
        chart_url: compare.chart_image_url,
        notes: `Orion’s independent view: ${result.mentorFeedback}`,
        orion_insights: result,
      })
      .select('id')
      .single();

    if (journalError) throw journalError;
    return res.json({ journal });
  } catch (error) {
    console.error('Save AI Compare journal error:', error);
    return res.status(500).json({ error: 'Failed to save AI Compare to journal' });
  }
};

export const sendAiCompareToRadar = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { data: compare, error } = await supabase
      .from('ai_compare_results')
      .select('id,post_id,user_id,result_json')
      .eq('id', req.params.compareId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;
    if (!compare) return res.status(404).json({ error: 'AI Compare result not found' });

    const result = compare.result_json as AiCompareResult;
    const { data: setup, error: setupError } = await supabase
      .from('trade_radar_setups')
      .insert({
        user_id: userId,
        analysis_id: compare.id,
        symbol: 'Community post',
        timeframe: 'Shared chart',
        status: result.recommendedAction === 'avoid_trade' ? 'archived' : 'watching',
        confidence: result.confidence,
        distance_to_entry: 'Waiting for confirmation',
        entry_zone: { source: 'ai_compare', keyLevels: result.keyLevels },
        invalidation: result.riskNotes,
        timeline: [{ status: 'created_from_ai_compare', note: result.mentorFeedback, at: new Date().toISOString() }],
      })
      .select('id')
      .single();

    if (setupError) throw setupError;
    return res.json({ setup });
  } catch (error) {
    console.error('Send AI Compare radar error:', error);
    return res.status(500).json({ error: 'Failed to send AI Compare to Trade Radar' });
  }
};
