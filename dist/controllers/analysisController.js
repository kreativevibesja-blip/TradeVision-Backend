"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalysisById = exports.getAnalyses = exports.analyzeChart = void 0;
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const config_1 = require("../config");
const volatilityDetector_1 = require("../utils/volatilityDetector");
const supabase_1 = require("../lib/supabase");
const runAnalysisPipeline_1 = require("../services/analysis/runAnalysisPipeline");
const needsUsageReset = (date) => new Date().toDateString() !== new Date(date).toDateString();
const hydrateUsageCounter = async (userId) => {
    const user = await (0, supabase_1.getUserById)(userId);
    if (!user) {
        return null;
    }
    if (needsUsageReset(user.lastUsageReset)) {
        return (0, supabase_1.updateUser)(user.id, { dailyUsage: 0, lastUsageReset: new Date().toISOString() });
    }
    return user;
};
const serializeAnalysis = (analysis) => ({
    ...analysis,
    takeProfits: Array.isArray(analysis.takeProfits) && analysis.takeProfits.length > 0
        ? analysis.takeProfits
        : [analysis.tp1, analysis.tp2].filter((value) => typeof value === 'number'),
});
const analyzeChart = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Chart image is required' });
        }
        const { pair, timeframe } = req.body;
        if (!pair || !timeframe) {
            return res.status(400).json({ error: 'Pair and timeframe are required' });
        }
        const user = await hydrateUsageCounter(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const limit = user.subscription === 'PRO' ? config_1.config.limits.proDaily : config_1.config.limits.freeDaily;
        if (user.dailyUsage >= limit) {
            return res.status(429).json({
                error: 'Daily analysis limit reached',
                limit,
                usage: user.dailyUsage,
            });
        }
        const imageUrl = `/uploads/${req.file.filename}`;
        const analysisId = (0, crypto_1.randomUUID)();
        await (0, supabase_1.createAnalysis)({
            id: analysisId,
            jobId: analysisId,
            userId: req.user.id,
            imageUrl,
            pair,
            timeframe,
            assetClass: (0, volatilityDetector_1.inferAssetClass)(pair),
            status: 'PROCESSING',
            progress: 5,
            currentStage: 'Preparing analysis...',
        });
        const analysis = await (0, runAnalysisPipeline_1.runAnalysisPipeline)({
            analysisId,
            userId: req.user.id,
            filePath: path_1.default.join(process.cwd(), config_1.config.upload.dir, req.file.filename),
            pair,
            timeframe,
        });
        return res.json({ analysis: serializeAnalysis(analysis) });
    }
    catch (error) {
        console.error('Analyze chart error:', error);
        return res.status(500).json({ error: 'Failed to analyze chart' });
    }
};
exports.analyzeChart = analyzeChart;
const getAnalyses = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const analyses = await (0, supabase_1.listAnalysesForUser)(req.user.id, page, limit);
        return res.json({ analyses: analyses.analyses.map(serializeAnalysis), total: analyses.total, page, pages: Math.ceil(analyses.total / limit) });
    }
    catch (error) {
        console.error('Get analyses error:', error);
        return res.status(500).json({ error: 'Failed to retrieve analyses' });
    }
};
exports.getAnalyses = getAnalyses;
const getAnalysisById = async (req, res) => {
    try {
        const analysis = await (0, supabase_1.getAnalysisByIdForUser)(req.params.id, req.user.id);
        if (!analysis) {
            return res.status(404).json({ error: 'Analysis not found' });
        }
        return res.json({ analysis: serializeAnalysis(analysis) });
    }
    catch (error) {
        console.error('Get analysis error:', error);
        return res.status(500).json({ error: 'Failed to retrieve analysis' });
    }
};
exports.getAnalysisById = getAnalysisById;
//# sourceMappingURL=analysisController.js.map