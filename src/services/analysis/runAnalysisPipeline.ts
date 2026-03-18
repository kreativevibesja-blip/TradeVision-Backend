import { incrementUserDailyUsage, updateAnalysis } from '../../lib/supabase';
import { analyzeVisionStructure } from '../visionAnalysis';
import { anchorTradeLevels } from '../priceAnchor';
import { buildTradeSignal } from '../signalEngine';

interface RunAnalysisPipelineInput {
  analysisId: string;
  userId: string;
  pair: string;
  timeframe: string;
  currentPrice: number;
  base64Image: string;
  mimeType: string;
}

export async function runAnalysisPipeline({ analysisId, userId, pair, timeframe, currentPrice, base64Image, mimeType }: RunAnalysisPipelineInput) {
  try {
    await updateAnalysis(analysisId, {
      status: 'PROCESSING',
      progress: 15,
      currentStage: 'Analyzing market structure...',
      errorMessage: null,
    });

    const vision = await analyzeVisionStructure(base64Image, mimeType, pair, timeframe);

    await updateAnalysis(analysisId, {
      progress: 45,
      currentStage: 'Anchoring prices to live context...',
      layer1Output: vision,
    });

    const anchoredLevels = anchorTradeLevels(currentPrice, pair, vision);

    await updateAnalysis(analysisId, {
      progress: 75,
      currentStage: 'Building final trade signal...',
      layer2Output: anchoredLevels,
    });

    const signal = buildTradeSignal(pair, vision, anchoredLevels);

    const analysis = await updateAnalysis(analysisId, {
      status: 'COMPLETED',
      progress: 100,
      currentStage: 'Finalizing trade plan...',
      bias: signal.bias.toUpperCase(),
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      tp1: signal.takeProfits[0] ?? null,
      tp2: signal.takeProfits[1] ?? null,
      takeProfits: signal.takeProfits,
      confidence: signal.confidence,
      explanation: signal.reasoning,
      analysisText: signal.reasoning,
      rawResponse: signal,
      structure: signal.structure,
      strategy: `${signal.bias.toUpperCase()} ${signal.entryType.toUpperCase()} setup`,
      waitConditions:
        signal.recommendation === 'wait'
          ? 'Wait for clearer confirmation before executing this setup.'
          : 'Use the anchored entry only if price confirms the expected structure.',
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