import { analyzeChartVision } from '../imageProcessing/chartVision';
import { deriveMarketStructure } from '../structureEngine/marketStructure';
import { generateTradeReasoning } from '../aiEngine/reasoningEngine';
import { incrementUserDailyUsage, updateAnalysis } from '../../lib/supabase';

interface RunAnalysisPipelineInput {
  analysisId: string;
  userId: string;
  pair: string;
  timeframe: string;
  filePath: string;
}

export async function runAnalysisPipeline({ analysisId, userId, pair, timeframe, filePath }: RunAnalysisPipelineInput) {
  try {
    await updateAnalysis(analysisId, {
      status: 'PROCESSING',
      progress: 15,
      currentStage: 'Scanning chart...',
      errorMessage: null,
    });

    const layer1 = await analyzeChartVision(filePath, pair);

    await updateAnalysis(analysisId, {
      progress: 35,
      currentStage: 'Detecting market structure...',
      layer1Output: layer1,
      assetClass: layer1.assetClass,
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

    const analysis = await updateAnalysis(analysisId, {
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

    return analysis;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';

    await updateAnalysis(analysisId, {
      status: 'FAILED',
      progress: 100,
      currentStage: 'Analysis failed',
      errorMessage: message,
    }).catch((updateError) => {
      console.error('[analysis-pipeline] failed to persist failure state:', updateError);
    });

    throw error;
  }
}