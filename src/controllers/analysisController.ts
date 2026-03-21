import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config';
import { inferAssetClass } from '../utils/volatilityDetector';
import {
  createAnalysis,
  getAnalysisByIdForUser,
  getUserById,
  listAnalysesForUser,
  updateUser,
} from '../lib/supabase';
import { runAnalysisPipeline } from '../services/analysis/runAnalysisPipeline';

const needsUsageReset = (date: string | Date) => new Date().toDateString() !== new Date(date).toDateString();

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

const hydrateUsageCounter = async (userId: string) => {
  const user = await getUserById(userId);
  if (!user) {
    return null;
  }

  if (needsUsageReset(user.lastUsageReset)) {
    return updateUser(user.id, { dailyUsage: 0, lastUsageReset: new Date().toISOString() });
  }

  return user;
};

const serializeAnalysis = (analysis: any) => ({
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
  try {
    const { pair, timeframe } = req.body;
    const currentPrice = parseCurrentPrice(req.body.currentPrice);
    const chartMinPrice = parseOptionalPrice(req.body.chartMinPrice);
    const chartMaxPrice = parseOptionalPrice(req.body.chartMaxPrice);

    if (!pair || !timeframe) {
      return res.status(400).json({ error: 'Pair and timeframe are required' });
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

    const user = await hydrateUsageCounter(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (chart2File && user.subscription !== 'PRO') {
      return res.status(403).json({ error: 'Dual-chart analysis is a Pro feature' });
    }

    const limit = user.subscription === 'PRO' ? config.limits.proDaily : config.limits.freeDaily;
    if (user.dailyUsage >= limit) {
      return res.status(429).json({
        error: 'Daily analysis limit reached',
        limit,
        usage: user.dailyUsage,
      });
    }

    const imageUrl = chartFile ? `/uploads/${chartFile.filename}` : 'inline-upload';
    const analysisId = randomUUID();

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

    const primaryImage = chartFile
      ? {
          base64Image: (await fs.readFile(path.join(process.cwd(), config.upload.dir, chartFile.filename))).toString('base64'),
          mimeType: chartFile.mimetype || 'image/jpeg',
        }
      : {
          base64Image: inlineImage!.base64Image,
          mimeType: inlineImage!.mimeType,
        };

    // Build secondary image data if present
    const secondaryImage = chart2File
      ? {
          base64Image: (await fs.readFile(path.join(process.cwd(), config.upload.dir, chart2File.filename))).toString('base64'),
          mimeType: chart2File.mimetype || 'image/jpeg',
          imageUrl: `/uploads/${chart2File.filename}`,
          timeframe: timeframe2!,
        }
      : null;

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
  } catch (error) {
    console.error('Analyze chart error:', error);
    return res.status(500).json({ error: 'Failed to analyze chart' });
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
