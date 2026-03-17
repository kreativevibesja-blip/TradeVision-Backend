import path from 'path';
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
  ...analysis,
  takeProfits:
    Array.isArray(analysis.takeProfits) && analysis.takeProfits.length > 0
      ? analysis.takeProfits
      : [analysis.tp1, analysis.tp2].filter((value) => typeof value === 'number'),
});

export const analyzeChart = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Chart image is required' });
    }

    const { pair, timeframe } = req.body;

    if (!pair || !timeframe) {
      return res.status(400).json({ error: 'Pair and timeframe are required' });
    }

    const user = await hydrateUsageCounter(req.user!.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const limit = user.subscription === 'PRO' ? config.limits.proDaily : config.limits.freeDaily;
    if (user.dailyUsage >= limit) {
      return res.status(429).json({
        error: 'Daily analysis limit reached',
        limit,
        usage: user.dailyUsage,
      });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
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

    const analysis = await runAnalysisPipeline({
      analysisId,
      userId: req.user!.id,
      filePath: path.join(process.cwd(), config.upload.dir, req.file.filename),
      pair,
      timeframe,
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
