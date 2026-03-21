import { incrementUserDailyUsage, updateAnalysis } from '../../lib/supabase';
import { analyzeVisionStructure } from '../visionAnalysis';
import { generateFinalSignal } from '../signalEngine';
import { drawChartMarkup, isChartMarkupEnabledForPlan } from '../chartMarkup';
import type { SubscriptionTier } from '../../lib/supabase';

interface RunAnalysisPipelineInput {
  analysisId: string;
  userId: string;
  pair: string;
  timeframe: string;
  subscription: SubscriptionTier;
  currentPrice: number;
  chartMinPrice: number | null;
  chartMaxPrice: number | null;
  imageUrl: string;
  base64Image: string;
  mimeType: string;
}

export async function runAnalysisPipeline({ analysisId, userId, pair, timeframe, subscription, currentPrice, chartMinPrice, chartMaxPrice, imageUrl, base64Image, mimeType }: RunAnalysisPipelineInput) {
  try {
    await updateAnalysis(analysisId, {
      status: 'PROCESSING',
      progress: 15,
      currentStage: 'Analyzing market structure...',
      errorMessage: null,
    });

    const vision = await analyzeVisionStructure(base64Image, mimeType, pair, timeframe, subscription);

    await updateAnalysis(analysisId, {
      progress: 45,
      currentStage: 'Interpreting SMC structure...',
      layer1Output: vision,
    });

    await updateAnalysis(analysisId, {
      progress: 75,
      currentStage: 'Validating entry conditions...',
      layer2Output: vision,
    });

    const signal = generateFinalSignal(vision, currentPrice);
    const markupEnabled = await isChartMarkupEnabledForPlan(subscription);
    const markup = markupEnabled
      ? await drawChartMarkup(Buffer.from(base64Image, 'base64'), signal, {
          minPrice: chartMinPrice,
          maxPrice: chartMaxPrice,
        })
      : { markedImageUrl: null, chartBounds: null, hasMarkup: false };

    const enrichedSignal = {
      ...signal,
      originalImageUrl: imageUrl,
      markedImageUrl: markup.markedImageUrl,
      hasMarkup: markup.hasMarkup,
      chartBounds: markup.chartBounds,
    };

    const bias = signal.trend === 'bullish' ? 'BULLISH' : signal.trend === 'bearish' ? 'BEARISH' : 'NEUTRAL';

    const analysis = await updateAnalysis(analysisId, {
      status: 'COMPLETED',
      progress: 100,
      currentStage: 'Preparing final SMC signal...',
      bias,
      entry: null,
      stopLoss: enrichedSignal.stopLoss,
      tp1: enrichedSignal.takeProfit1,
      tp2: enrichedSignal.takeProfit2,
      takeProfits: [enrichedSignal.takeProfit1, enrichedSignal.takeProfit2, enrichedSignal.takeProfit3].filter((v): v is number => v !== null),
      confidence: enrichedSignal.confidence,
      explanation: enrichedSignal.reasoning,
      analysisText: enrichedSignal.reasoning,
      rawResponse: enrichedSignal,
      structure: enrichedSignal.structure,
      strategy: `${enrichedSignal.trend.toUpperCase()} ${enrichedSignal.entryLogic.type.toUpperCase()} SMC setup`,
      waitConditions: enrichedSignal.message,
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