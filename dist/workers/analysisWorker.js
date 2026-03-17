"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAnalysisWorker = void 0;
const bullmq_1 = require("bullmq");
const config_1 = require("../config");
const analysisQueue_1 = require("../queues/analysisQueue");
const chartVision_1 = require("../services/imageProcessing/chartVision");
const marketStructure_1 = require("../services/structureEngine/marketStructure");
const reasoningEngine_1 = require("../services/aiEngine/reasoningEngine");
const supabase_1 = require("../lib/supabase");
const startAnalysisWorker = () => {
    const worker = new bullmq_1.Worker(config_1.config.analysis.queueName, async (job) => {
        const { analysisId, pair, timeframe, filePath, userId } = job.data;
        await (0, supabase_1.updateAnalysis)(analysisId, {
            status: 'PROCESSING',
            progress: 15,
            currentStage: 'Scanning chart...',
        });
        const layer1 = await (0, chartVision_1.analyzeChartVision)(filePath, pair);
        await (0, supabase_1.updateAnalysis)(analysisId, {
            progress: 35,
            currentStage: 'Detecting market structure...',
            layer1Output: layer1,
        });
        const layer2 = (0, marketStructure_1.deriveMarketStructure)(layer1, pair);
        await (0, supabase_1.updateAnalysis)(analysisId, {
            progress: 60,
            currentStage: 'Analyzing liquidity zones...',
            layer2Output: layer2,
            structure: layer2.smcSignals,
            strategy: `${layer2.marketBias.toUpperCase()} ${layer2.tradeSetup.type.toUpperCase()} setup`,
        });
        const reasoning = await (0, reasoningEngine_1.generateTradeReasoning)(pair, timeframe, layer1, layer2);
        await (0, supabase_1.updateAnalysis)(analysisId, {
            status: 'COMPLETED',
            progress: 100,
            currentStage: 'Generating AI reasoning...',
            assetClass: layer1.assetClass,
            bias: reasoning.bias.toUpperCase(),
            entry: reasoning.entry,
            stopLoss: reasoning.stopLoss,
            tp1: reasoning.tp1,
            tp2: reasoning.tp2,
            takeProfits: [reasoning.tp1, reasoning.tp2],
            confidence: reasoning.confidence,
            explanation: reasoning.explanation,
            analysisText: reasoning.explanation,
            rawResponse: reasoning,
            waitConditions: layer2.marketBias === 'neutral'
                ? 'Wait for a clear break of range or a sweep-and-reclaim at a major zone.'
                : `Wait for confirmation inside the ${layer2.tradeSetup.type} entry zone before executing.`,
            errorMessage: null,
        });
        await (0, supabase_1.incrementUserDailyUsage)(userId);
        return { analysisId };
    }, { connection: analysisQueue_1.analysisQueueConnection });
    worker.on('completed', (job) => {
        console.log(`[analysis-worker] completed job ${job.id}`);
    });
    worker.on('failed', async (job, error) => {
        console.error('[analysis-worker] job failed:', job?.id, error);
        if (job?.data.analysisId) {
            await (0, supabase_1.updateAnalysis)(job.data.analysisId, {
                status: 'FAILED',
                progress: 100,
                currentStage: 'Analysis failed',
                errorMessage: error.message,
            }).catch((updateError) => {
                console.error('[analysis-worker] failed to update analysis failure state:', updateError);
            });
        }
    });
    return worker;
};
exports.startAnalysisWorker = startAnalysisWorker;
if (require.main === module) {
    (0, exports.startAnalysisWorker)();
}
//# sourceMappingURL=analysisWorker.js.map