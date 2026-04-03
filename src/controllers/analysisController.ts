import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config';
import { inferAssetClass } from '../utils/volatilityDetector';
import {
  countAnalysesForUserSince,
  createAnalysis,
  getAnalysisByIdForUser,
  getUserById,
  listAnalysesForUser,
  releaseUserDailyUsageReservation,
  reserveUserDailyUsage,
  createQueueJob,
  countActiveQueueJobs,
  countRecentQueueJobs,
} from '../lib/supabase';
import { runAnalysisPipeline } from '../services/analysis/runAnalysisPipeline';
import { getCachedCandles } from '../lib/db/saveCandles';
import { getDerivLiveChartSnapshot, isSupportedDerivGranularity } from '../services/derivMarketData';
import { fetchMarketDataForLiveChart, isSupportedLiveChartTimeframe, resolveLiveChartSymbol } from '../services/marketData';
import { runLiveChartAnalysisPipeline } from '../services/analysis/runLiveChartAnalysisPipeline';

const parseCurrentPrice = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = Number(value.replace(/,/g, '').trim());
    if (Number.isFinite(normalized) && normalized > 0) {
      return normalized;
    }
  }

  return null;
};

const parseOptionalPrice = (value: unknown) => {
  const parsed = parseCurrentPrice(value);
  return parsed === null ? null : parsed;
};

const parseDerivCandles = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const record = item as Record<string, unknown>;
      const timeValue = typeof record.time === 'number' ? record.time : Number(String(record.time ?? '').trim());
      const open = parseCurrentPrice(record.open);
      const high = parseCurrentPrice(record.high);
      const low = parseCurrentPrice(record.low);
      const close = parseCurrentPrice(record.close);

      if (!Number.isFinite(timeValue) || open === null || high === null || low === null || close === null) {
        return null;
      }

      return {
        timestamp: new Date(timeValue * 1000).toISOString(),
        open,
        high,
        low,
        close,
      };
    })
    .filter((candle): candle is { timestamp: string; open: number; high: number; low: number; close: number } => candle !== null);
};

const parseInlineImage = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const dataUrlMatch = trimmed.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      base64Image: dataUrlMatch[2],
    };
  }

  return {
    mimeType: 'image/jpeg',
    base64Image: trimmed,
  };
};

const getMonthStartIso = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
};

export const serializeAnalysis = (analysis: any) => ({
  ...(analysis.rawResponse && typeof analysis.rawResponse === 'object' ? analysis.rawResponse : {}),
  ...analysis,
  reasoning:
    analysis.rawResponse && typeof analysis.rawResponse === 'object' && typeof analysis.rawResponse.reasoning === 'string'
      ? analysis.rawResponse.reasoning
      : analysis.explanation || analysis.analysisText || null,
  riskReward:
    analysis.rawResponse && typeof analysis.rawResponse === 'object' && typeof analysis.rawResponse.riskReward === 'string'
      ? analysis.rawResponse.riskReward
      : null,
  recommendation:
    analysis.rawResponse && typeof analysis.rawResponse === 'object' && typeof analysis.rawResponse.recommendation === 'string'
      ? analysis.rawResponse.recommendation
      : null,
  takeProfits:
    Array.isArray(analysis.takeProfits) && analysis.takeProfits.length > 0
      ? analysis.takeProfits
      : analysis.rawResponse && typeof analysis.rawResponse === 'object' && Array.isArray(analysis.rawResponse.takeProfits)
        ? analysis.rawResponse.takeProfits
      : [analysis.tp1, analysis.tp2].filter((value) => typeof value === 'number'),
});

export const analyzeChart = async (req: AuthRequest, res: Response) => {
  let usageReserved = false;

  try {
    const liveChartSource = req.body.source === 'tradingview-live' || req.body.source === 'deriv-live';
    const derivLiveSource = req.body.source === 'deriv-live';
    const requestedSymbol = typeof req.body.symbol === 'string' ? req.body.symbol.trim() : '';
    const pair = liveChartSource ? requestedSymbol : req.body.pair;
    const timeframe = typeof req.body.timeframe === 'string' ? req.body.timeframe.trim() : '';
    const currentPrice = parseCurrentPrice(req.body.currentPrice);
    const chartMinPrice = parseOptionalPrice(req.body.chartMinPrice);
    const chartMaxPrice = parseOptionalPrice(req.body.chartMaxPrice);

    const runLiveAnalysisImmediately = async (input: {
      analysisId: string;
      pair: string;
      timeframe: string;
      currentPrice: number;
      imageUrl: string;
      candles: Array<{ timestamp: string; open: number; high: number; low: number; close: number }>;
    }) => {
      await createAnalysis({
        id: input.analysisId,
        jobId: input.analysisId,
        userId: req.user!.id,
        imageUrl: input.imageUrl,
        pair: input.pair,
        timeframe: input.timeframe,
        assetClass: inferAssetClass(input.pair),
        status: 'PROCESSING',
        progress: 5,
        currentStage: 'Preparing live analysis...',
      });

      const analysis = await runLiveChartAnalysisPipeline({
        analysisId: input.analysisId,
        pair: input.pair,
        timeframe: input.timeframe,
        currentPrice: input.currentPrice,
        candles: input.candles,
      });

      return res.json({ analysis: serializeAnalysis(analysis) });
    };

    if (!pair || !timeframe) {
      return res.status(400).json({ error: 'Pair and timeframe are required' });
    }

    const user = await getUserById(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (liveChartSource) {
      if (user.subscription === 'FREE') {
        return res.status(403).json({ error: 'Live chart analysis is available on paid plans' });
      }

      if (!derivLiveSource && (!resolveLiveChartSymbol(pair) || !isSupportedLiveChartTimeframe(timeframe))) {
        return res.status(400).json({ error: 'Unsupported symbol or timeframe for live chart analysis' });
      }

      const derivCandles = derivLiveSource ? parseDerivCandles(req.body.candles) : null;
      if (derivLiveSource && (!derivCandles || derivCandles.length < 50)) {
        return res.status(400).json({ error: 'At least 50 Deriv candles are required for persisted live analysis' });
      }

      const monthlyUsage = await countAnalysesForUserSince(req.user!.id, getMonthStartIso());
      if (monthlyUsage >= config.limits.proMonthly) {
        return res.status(429).json({
          error: 'Monthly fair use limit reached',
          limit: config.limits.proMonthly,
          usage: monthlyUsage,
        });
      }

      const analysisId = randomUUID();
      const queueInput = derivLiveSource
        ? {
            source: 'deriv-live' as const,
            analysisId,
            pair,
            timeframe,
            candles: derivCandles!,
          }
        : {
            source: 'tradingview-live' as const,
            analysisId,
            pair,
            timeframe,
          };

      try {
        const job = await createQueueJob({
          userId: req.user!.id,
          priority: 2,
          inputData: queueInput,
          analysisId,
        });

        return res.json({
          queued: true,
          jobId: job.id,
          analysisId,
          message: 'Your live chart analysis has been queued. You can track its progress.',
        });
      } catch (queueError) {
        console.error('Live chart queue creation failed, falling back to immediate analysis:', queueError);

        if (derivLiveSource) {
          const liveCandles = derivCandles!;
          const latestCandle = liveCandles[liveCandles.length - 1];

          return runLiveAnalysisImmediately({
            analysisId,
            pair,
            timeframe,
            currentPrice: latestCandle.close,
            imageUrl: 'deriv-live',
            candles: liveCandles,
          });
        }

        const marketData = await fetchMarketDataForLiveChart(pair, timeframe);

        return runLiveAnalysisImmediately({
          analysisId,
          pair: marketData.symbol,
          timeframe,
          currentPrice: marketData.currentPrice,
          imageUrl: 'tradingview-live',
          candles: marketData.candles,
        });
      }
    }

    if (currentPrice === null) {
      return res.status(400).json({ error: 'Current price is required and must be a positive number' });
    }

    // Handle both single and multi-file uploads
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const chartFile = files?.chart?.[0] ?? req.file;
    const chart2File = files?.chart2?.[0];
    const inlineImage = parseInlineImage(req.body.image);

    if (!chartFile && !inlineImage) {
      return res.status(400).json({ error: 'Chart image is required' });
    }

    // Dual-chart is PRO only
    const timeframe2 = chart2File ? (req.body.timeframe2 || timeframe) : null;

    if (chart2File && user.subscription === 'FREE') {
      return res.status(403).json({ error: 'Dual-chart analysis is available on paid plans' });
    }

    // Read image data up-front (needed for both instant and queued paths)
    const primaryImage = chartFile
      ? {
          base64Image: (await fs.readFile(path.join(process.cwd(), config.upload.dir, chartFile.filename))).toString('base64'),
          mimeType: chartFile.mimetype || 'image/jpeg',
        }
      : {
          base64Image: inlineImage!.base64Image,
          mimeType: inlineImage!.mimeType,
        };

    const imageUrl = chartFile ? `/uploads/${chartFile.filename}` : 'inline-upload';
    const analysisId = randomUUID();

    // Build secondary image data if present
    const secondaryImage = chart2File
      ? {
          base64Image: (await fs.readFile(path.join(process.cwd(), config.upload.dir, chart2File.filename))).toString('base64'),
          mimeType: chart2File.mimetype || 'image/jpeg',
          imageUrl: `/uploads/${chart2File.filename}`,
          timeframe: timeframe2!,
        }
      : null;

    // ── PRO PATH: process instantly (no queue) ──────────────────────
    if (user.subscription !== 'FREE') {
      const monthlyUsage = await countAnalysesForUserSince(req.user!.id, getMonthStartIso());
      if (monthlyUsage >= config.limits.proMonthly) {
        return res.status(429).json({
          error: 'Monthly fair use limit reached',
          limit: config.limits.proMonthly,
          usage: monthlyUsage,
        });
      }

      await createAnalysis({
        id: analysisId,
        jobId: analysisId,
        userId: req.user!.id,
        imageUrl,
        pair,
        timeframe,
        assetClass: inferAssetClass(pair),
        status: 'PROCESSING',
        progress: 5,
        currentStage: 'Preparing analysis...',
      });

      const analysis = await runAnalysisPipeline({
        analysisId,
        userId: req.user!.id,
        pair,
        timeframe,
        subscription: user.subscription,
        currentPrice,
        chartMinPrice,
        chartMaxPrice,
        imageUrl,
        ...primaryImage,
        secondaryChart: secondaryImage,
      });

      return res.json({ analysis: serializeAnalysis(analysis) });
    }

    // ── FREE PATH: queue the job ────────────────────────────────────

    // Rate limit: max 1 active job at a time
    const activeJobs = await countActiveQueueJobs(req.user!.id);
    if (activeJobs >= 1) {
      return res.status(429).json({ error: 'You already have a pending analysis. Please wait for it to complete.' });
    }

    // Rate limit: max 5 jobs per hour
    const recentJobs = await countRecentQueueJobs(req.user!.id, 60);
    if (recentJobs >= 5) {
      return res.status(429).json({ error: 'Hourly analysis limit reached. Upgrade to Pro for unlimited instant analysis.' });
    }

    // Reserve daily usage
    const usageReservation = await reserveUserDailyUsage(req.user!.id, config.limits.freeDaily);
    if (!usageReservation.allowed) {
      return res.status(429).json({
        error: 'Daily analysis limit reached',
        limit: config.limits.freeDaily,
        usage: usageReservation.user.dailyUsage,
      });
    }
    usageReserved = true;

    // Create queue job
    const job = await createQueueJob({
      userId: req.user!.id,
      priority: 0,
      inputData: {
        analysisId,
        pair,
        timeframe,
        currentPrice,
        chartMinPrice,
        chartMaxPrice,
        imageUrl,
        base64Image: primaryImage.base64Image,
        mimeType: primaryImage.mimeType,
        secondaryChart: secondaryImage,
      },
    });

    return res.json({
      queued: true,
      jobId: job.id,
      analysisId,
      message: 'Your analysis has been queued. You can track its progress.',
    });
  } catch (error) {
    if (usageReserved && req.user?.id) {
      await releaseUserDailyUsageReservation(req.user.id).catch((releaseError) => {
        console.error('Failed to release reserved daily usage:', releaseError);
      });
    }

    console.error('Analyze chart error:', error);
    return res.status(500).json({ error: 'Failed to analyze chart' });
  }
};

export const getLiveChartMarketData = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.subscription === 'FREE') {
      return res.status(403).json({ error: 'Live chart market data is available on paid plans' });
    }

    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe.trim() : '';

    if (!resolveLiveChartSymbol(symbol) || !isSupportedLiveChartTimeframe(timeframe)) {
      return res.status(400).json({ error: 'Unsupported symbol or timeframe for live chart market data' });
    }

    const cachedCandles = await getCachedCandles(symbol.trim().toUpperCase(), timeframe, 500);

    const marketData = cachedCandles.length >= 50
      ? {
          symbol,
          timeframe,
          candles: cachedCandles.map((candle) => ({
            timestamp: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })),
          currentPrice: cachedCandles[cachedCandles.length - 1]?.close ?? 0,
        }
      : await fetchMarketDataForLiveChart(symbol, timeframe);

    return res.json({ marketData });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to fetch live chart market data.' });
  }
};

export const getDerivLiveChartMarketData = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.subscription === 'FREE') {
      return res.status(403).json({ error: 'Live chart market data is available on paid plans' });
    }

    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : '';
    const granularity = Number(req.query.granularity);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 2), 5000);

    if (!symbol || !Number.isFinite(granularity) || !isSupportedDerivGranularity(granularity)) {
      return res.status(400).json({ error: 'Unsupported symbol or granularity for Deriv live chart market data' });
    }

    const marketData = await getDerivLiveChartSnapshot(symbol, granularity, limit);
    return res.json({ marketData });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Unable to fetch Deriv live chart market data.' });
  }
};

export const getAnalyses = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const analyses = await listAnalysesForUser(req.user!.id, page, limit);

    return res.json({ analyses: analyses.analyses.map(serializeAnalysis), total: analyses.total, page, pages: Math.ceil(analyses.total / limit) });
  } catch (error) {
    console.error('Get analyses error:', error);
    return res.status(500).json({ error: 'Failed to retrieve analyses' });
  }
};

export const getAnalysisById = async (req: AuthRequest, res: Response) => {
  try {
    const analysis = await getAnalysisByIdForUser(req.params.id, req.user!.id);

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    return res.json({ analysis: serializeAnalysis(analysis) });
  } catch (error) {
    console.error('Get analysis error:', error);
    return res.status(500).json({ error: 'Failed to retrieve analysis' });
  }
};
