import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { config } from '../config';
import { analyzeChart } from '../services/aiService';
import { processChartImage } from '../services/imageService';

export const uploadChart = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No chart image uploaded' });
    }

    const { pair, timeframe } = req.body;
    if (!pair || !timeframe) {
      return res.status(400).json({ error: 'Pair and timeframe are required' });
    }

    // Check daily usage limits
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = new Date();
    const lastReset = new Date(user.lastUsageReset);
    const isNewDay = now.toDateString() !== lastReset.toDateString();

    let currentUsage = user.dailyUsage;
    if (isNewDay) {
      currentUsage = 0;
      await prisma.user.update({
        where: { id: user.id },
        data: { dailyUsage: 0, lastUsageReset: now },
      });
    }

    const limit = user.subscription === 'PRO' ? config.limits.proDaily : config.limits.freeDaily;
    if (currentUsage >= limit) {
      return res.status(429).json({
        error: 'Daily analysis limit reached',
        limit,
        usage: currentUsage,
      });
    }

    const imageUrl = `/uploads/${req.file.filename}`;

    return res.json({
      imageUrl,
      filename: req.file.filename,
      pair,
      timeframe,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Upload failed' });
  }
};

export const analyzeChartController = async (req: AuthRequest, res: Response) => {
  try {
    const { imageUrl, pair, timeframe } = req.body;
    if (!imageUrl || !pair || !timeframe) {
      return res.status(400).json({ error: 'imageUrl, pair, and timeframe are required' });
    }

    const filePath = imageUrl.startsWith('/uploads/')
      ? `${process.cwd()}${imageUrl.replace(/\//g, require('path').sep)}`
      : imageUrl;

    // Process image for better AI analysis
    let processedPath: string;
    try {
      processedPath = await processChartImage(filePath);
    } catch {
      processedPath = filePath;
    }

    // Run AI analysis
    const analysis = await analyzeChart(processedPath, pair, timeframe);

    // Save analysis to database
    const saved = await prisma.analysis.create({
      data: {
        userId: req.user!.id,
        imageUrl,
        pair,
        timeframe,
        bias: analysis.bias,
        entry: analysis.entry,
        stopLoss: analysis.stopLoss,
        takeProfits: analysis.takeProfits,
        confidence: analysis.confidence,
        analysisText: analysis.analysisText,
        strategy: analysis.strategy,
        structure: analysis.structure,
        waitConditions: analysis.waitConditions,
        rawResponse: analysis as any,
      },
    });

    // Increment daily usage
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { dailyUsage: { increment: 1 } },
    });

    return res.json({ analysis: { ...analysis, id: saved.id, imageUrl } });
  } catch (error) {
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
};

export const getAnalyses = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const skip = (page - 1) * limit;

    const [analyses, total] = await Promise.all([
      prisma.analysis.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.analysis.count({ where: { userId: req.user!.id } }),
    ]);

    return res.json({ analyses, total, page, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get analyses error:', error);
    return res.status(500).json({ error: 'Failed to retrieve analyses' });
  }
};

export const getAnalysisById = async (req: AuthRequest, res: Response) => {
  try {
    const analysis = await prisma.analysis.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!analysis) {
      return res.status(404).json({ error: 'Analysis not found' });
    }

    return res.json({ analysis });
  } catch (error) {
    console.error('Get analysis error:', error);
    return res.status(500).json({ error: 'Failed to retrieve analysis' });
  }
};
