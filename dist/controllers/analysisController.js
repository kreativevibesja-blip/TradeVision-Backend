"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalysisById = exports.getAnalyses = exports.analyzeChartController = exports.uploadChart = void 0;
const database_1 = __importDefault(require("../config/database"));
const config_1 = require("../config");
const aiService_1 = require("../services/aiService");
const imageService_1 = require("../services/imageService");
const uploadChart = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No chart image uploaded' });
        }
        const { pair, timeframe } = req.body;
        if (!pair || !timeframe) {
            return res.status(400).json({ error: 'Pair and timeframe are required' });
        }
        // Check daily usage limits
        const user = await database_1.default.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        const now = new Date();
        const lastReset = new Date(user.lastUsageReset);
        const isNewDay = now.toDateString() !== lastReset.toDateString();
        let currentUsage = user.dailyUsage;
        if (isNewDay) {
            currentUsage = 0;
            await database_1.default.user.update({
                where: { id: user.id },
                data: { dailyUsage: 0, lastUsageReset: now },
            });
        }
        const limit = user.subscription === 'PRO' ? config_1.config.limits.proDaily : config_1.config.limits.freeDaily;
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
    }
    catch (error) {
        console.error('Upload error:', error);
        return res.status(500).json({ error: 'Upload failed' });
    }
};
exports.uploadChart = uploadChart;
const analyzeChartController = async (req, res) => {
    try {
        const { imageUrl, pair, timeframe } = req.body;
        if (!imageUrl || !pair || !timeframe) {
            return res.status(400).json({ error: 'imageUrl, pair, and timeframe are required' });
        }
        const filePath = imageUrl.startsWith('/uploads/')
            ? `${process.cwd()}${imageUrl.replace(/\//g, require('path').sep)}`
            : imageUrl;
        // Process image for better AI analysis
        let processedPath;
        try {
            processedPath = await (0, imageService_1.processChartImage)(filePath);
        }
        catch {
            processedPath = filePath;
        }
        // Run AI analysis
        const analysis = await (0, aiService_1.analyzeChart)(processedPath, pair, timeframe);
        // Save analysis to database
        const saved = await database_1.default.analysis.create({
            data: {
                userId: req.user.id,
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
                rawResponse: analysis,
            },
        });
        // Increment daily usage
        await database_1.default.user.update({
            where: { id: req.user.id },
            data: { dailyUsage: { increment: 1 } },
        });
        return res.json({ analysis: { ...analysis, id: saved.id, imageUrl } });
    }
    catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({ error: 'Analysis failed. Please try again.' });
    }
};
exports.analyzeChartController = analyzeChartController;
const getAnalyses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const skip = (page - 1) * limit;
        const [analyses, total] = await Promise.all([
            database_1.default.analysis.findMany({
                where: { userId: req.user.id },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            database_1.default.analysis.count({ where: { userId: req.user.id } }),
        ]);
        return res.json({ analyses, total, page, pages: Math.ceil(total / limit) });
    }
    catch (error) {
        console.error('Get analyses error:', error);
        return res.status(500).json({ error: 'Failed to retrieve analyses' });
    }
};
exports.getAnalyses = getAnalyses;
const getAnalysisById = async (req, res) => {
    try {
        const analysis = await database_1.default.analysis.findFirst({
            where: { id: req.params.id, userId: req.user.id },
        });
        if (!analysis) {
            return res.status(404).json({ error: 'Analysis not found' });
        }
        return res.json({ analysis });
    }
    catch (error) {
        console.error('Get analysis error:', error);
        return res.status(500).json({ error: 'Failed to retrieve analysis' });
    }
};
exports.getAnalysisById = getAnalysisById;
//# sourceMappingURL=analysisController.js.map