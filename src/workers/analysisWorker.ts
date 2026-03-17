import { Worker } from 'bullmq';
import { config } from '../config';
import { analysisQueueConnection, type AnalysisJobData } from '../queues/analysisQueue';
import { analyzeChartVision } from '../services/imageProcessing/chartVision';
import { deriveMarketStructure } from '../services/structureEngine/marketStructure';
import { generateTradeReasoning } from '../services/aiEngine/reasoningEngine';
import { incrementUserDailyUsage, updateAnalysis } from '../lib/supabase';

export const startAnalysisWorker = () => {
  const worker = new Worker<AnalysisJobData>(
    config.analysis.queueName,
    async (job) => {
      const { analysisId, pair, timeframe, filePath, userId } = job.data;

      await updateAnalysis(analysisId, {
        status: 'PROCESSING',
        progress: 15,
        currentStage: 'Scanning chart...',
      });

      const layer1 = await analyzeChartVision(filePath, pair);

      await updateAnalysis(analysisId, {
        progress: 35,
        currentStage: 'Detecting market structure...',
        layer1Output: layer1,
      });

      const layer2 = deriveMarketStructure(layer1, pair);

      await updateAnalysis(analysisId, {
        progress: 60,
        currentStage: 'Analyzing liquidity zones...',
        layer2Output: layer2,
        structure: layer2.smcSignals,
        strategy: `${layer2.marketBias.toUpperCase()} ${layer2.tradeSetup.type.toUpperCase()} setup`,
      });

      const reasoning = await generateTradeReasoning(pair, timeframe, layer1, layer2);

      await updateAnalysis(analysisId, {
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
        waitConditions:
          layer2.marketBias === 'neutral'
            ? 'Wait for a clear break of range or a sweep-and-reclaim at a major zone.'
            : `Wait for confirmation inside the ${layer2.tradeSetup.type} entry zone before executing.`,
        errorMessage: null,
      });

      await incrementUserDailyUsage(userId);

      return { analysisId };
    },
    { connection: analysisQueueConnection }
  );

  worker.on('completed', (job) => {
    console.log(`[analysis-worker] completed job ${job.id}`);
  });

  worker.on('failed', async (job, error) => {
    console.error('[analysis-worker] job failed:', job?.id, error);

    if (job?.data.analysisId) {
      await updateAnalysis(job.data.analysisId, {
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

if (require.main === module) {
  startAnalysisWorker();
}