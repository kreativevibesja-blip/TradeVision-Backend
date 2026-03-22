import { updateAnalysis } from '../../lib/supabase';
import { analyzeVisionStructure, analyzeHTFVisionStructure, analyzeLTFVisionStructure } from '../visionAnalysis';
import { generateFinalSignal } from '../signalEngine';
import { drawChartMarkup, drawHTFChartMarkup, drawLTFChartMarkup, isChartMarkupEnabledForPlan } from '../chartMarkup';
import type { SubscriptionTier } from '../../lib/supabase';
import type { VisionAnalysisResult, VisionModelMetadata } from '../visionAnalysis';

interface SecondaryChartInput {
  base64Image: string;
  mimeType: string;
  imageUrl: string;
  timeframe: string;
}

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
  secondaryChart: SecondaryChartInput | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isVisionModelMetadata = (value: unknown): value is VisionModelMetadata =>
  isRecord(value) &&
  typeof value.provider === 'string' &&
  typeof value.primaryModel === 'string' &&
  typeof value.actualModel === 'string';

const extractVisionMetadataFromError = (error: unknown) => {
  if (!isRecord(error)) {
    return null;
  }

  const metadata = error.metadata;
  return isRecord(metadata) ? metadata : null;
};

const formatZone = (zone: { min: number | null; max: number | null } | null) => {
  if (!zone || typeof zone.min !== 'number' || typeof zone.max !== 'number') {
    return null;
  }

  return `${zone.min.toFixed(2)}-${zone.max.toFixed(2)}`;
};

const buildDualReasoning = (
  htfVision: VisionAnalysisResult,
  ltfVision: VisionAnalysisResult,
  htfTimeframe: string,
  ltfTimeframe: string
) => {
  const htfDemand = formatZone(htfVision.zones.demand);
  const htfSupply = formatZone(htfVision.zones.supply);
  const ltfEntry = formatZone(ltfVision.entryPlan.entryZone);
  const ltfStopLoss = typeof ltfVision.stopLoss === 'number' ? ltfVision.stopLoss.toFixed(2) : null;
  const ltfTp1 = typeof ltfVision.takeProfit1 === 'number' ? ltfVision.takeProfit1.toFixed(2) : null;

  const htfLine = [
    `HTF ${htfTimeframe}: ${htfVision.trend} ${htfVision.structure.state}.`,
    htfVision.structure.bos !== 'none' ? `BOS ${htfVision.structure.bos}.` : null,
    `Price in ${htfVision.pricePosition.location}.`,
    htfDemand ? `Demand ${htfDemand}.` : null,
    htfSupply ? `Supply ${htfSupply}.` : null,
  ].filter(Boolean).join(' ');

  const ltfLine = [
    `LTF ${ltfTimeframe}: bias ${ltfVision.entryPlan.bias}.`,
    ltfEntry ? `Entry ${ltfEntry}.` : null,
    ltfVision.entryPlan.confirmation !== 'none' ? `Wait for ${ltfVision.entryPlan.confirmation}.` : null,
    ltfStopLoss ? `SL ${ltfStopLoss}.` : null,
    ltfTp1 ? `TP1 ${ltfTp1}.` : null,
  ].filter(Boolean).join(' ');

  return `${htfLine}\n${ltfLine}`;
};

const toMarkupAnalysis = (vision: VisionAnalysisResult, currentPrice: number) => ({
  zones: {
    supplyZone: vision.zones.supply,
    demandZone: vision.zones.demand,
  },
  entryPlan: {
    entryZone: vision.entryPlan.entryZone,
  },
  liquidity: vision.liquidity,
  invalidationLevel: vision.riskManagement.invalidationLevel,
  currentPrice,
  visiblePriceRange: vision.visiblePriceRange,
  stopLoss: vision.stopLoss,
  takeProfit1: vision.takeProfit1,
  takeProfit2: vision.takeProfit2,
  takeProfit3: vision.takeProfit3,
});

export async function runAnalysisPipeline({ analysisId, userId, pair, timeframe, subscription, currentPrice, chartMinPrice, chartMaxPrice, imageUrl, base64Image, mimeType, secondaryChart }: RunAnalysisPipelineInput) {
  try {
    const isDualChart = secondaryChart !== null;
    let analysisMeta: Record<string, unknown> | null = null;
    let htfVision: VisionAnalysisResult | null = null;
    let ltfVision: VisionAnalysisResult | null = null;

    await updateAnalysis(analysisId, {
      status: 'PROCESSING',
      progress: 10,
      currentStage: isDualChart ? 'Analyzing higher timeframe structure...' : 'Analyzing market structure...',
      errorMessage: null,
    });

    let vision;

    if (isDualChart) {
      // Dual-chart mode: HTF (chart 1) for structure + LTF (chart 2) for entry
      [htfVision, ltfVision] = await Promise.all([
        analyzeHTFVisionStructure(base64Image, mimeType, pair, timeframe),
        analyzeLTFVisionStructure(secondaryChart.base64Image, secondaryChart.mimeType, pair, secondaryChart.timeframe),
      ]);

      await updateAnalysis(analysisId, {
        progress: 50,
        currentStage: 'Combining multi-timeframe analysis...',
      });

      // Merge: HTF provides structure/zones/trend/pricePosition, LTF provides entry/SL/TP/liquidity
      vision = {
        trend: htfVision.trend,
        structure: htfVision.structure,
        liquidity: ltfVision.liquidity,
        zones: htfVision.zones,
        pricePosition: htfVision.pricePosition,
        entryPlan: ltfVision.entryPlan,
        riskManagement: ltfVision.riskManagement,
        quality: {
          setupRating: htfVision.quality.setupRating,
          confidence: Math.round((htfVision.quality.confidence + ltfVision.quality.confidence) / 2),
        },
        finalVerdict: ltfVision.finalVerdict,
        reasoning: buildDualReasoning(htfVision, ltfVision, timeframe, secondaryChart.timeframe),
        visiblePriceRange: htfVision.visiblePriceRange,
        stopLoss: ltfVision.stopLoss,
        takeProfit1: ltfVision.takeProfit1,
        takeProfit2: ltfVision.takeProfit2,
        takeProfit3: ltfVision.takeProfit3,
        analysisMeta: {
          mode: 'dual' as const,
          charts: [htfVision.analysisMeta, ltfVision.analysisMeta].filter(
            (item): item is VisionModelMetadata => isVisionModelMetadata(item)
          ),
        },
      };

      analysisMeta = isRecord(vision.analysisMeta) ? vision.analysisMeta : null;
    } else {
      // Single chart mode (existing flow)
      vision = await analyzeVisionStructure(base64Image, mimeType, pair, timeframe, subscription);
      analysisMeta = isRecord(vision.analysisMeta) ? vision.analysisMeta : null;
    }

    await updateAnalysis(analysisId, {
      progress: isDualChart ? 60 : 45,
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

    let markup = { markedImageUrl: null as string | null, chartBounds: null as any, hasMarkup: false };
    let htfMarkup = { markedImageUrl: null as string | null, chartBounds: null as any, hasMarkup: false };
    let ltfMarkup = { markedImageUrl: null as string | null, chartBounds: null as any, hasMarkup: false };

    if (markupEnabled) {
      if (isDualChart) {
        if (!htfVision || !ltfVision) {
          throw new Error('Dual-chart analysis did not return both timeframe results');
        }

        const htfMarkupAnalysis = toMarkupAnalysis(htfVision, currentPrice);
        const ltfMarkupAnalysis = toMarkupAnalysis(ltfVision, currentPrice);

        // Generate separate markups for HTF and LTF charts
        const [htfResult, ltfResult] = await Promise.all([
          drawHTFChartMarkup(Buffer.from(base64Image, 'base64'), htfMarkupAnalysis, { minPrice: chartMinPrice, maxPrice: chartMaxPrice }),
          drawLTFChartMarkup(Buffer.from(secondaryChart.base64Image, 'base64'), ltfMarkupAnalysis, {
            minPrice: ltfVision.visiblePriceRange?.min ?? null,
            maxPrice: ltfVision.visiblePriceRange?.max ?? null,
          }),
        ]);
        htfMarkup = htfResult;
        ltfMarkup = ltfResult;
        // Use LTF as the primary marked image (shows entry/SL/TP)
        markup = ltfMarkup;
      } else {
        markup = await drawChartMarkup(Buffer.from(base64Image, 'base64'), signal, {
          minPrice: chartMinPrice,
          maxPrice: chartMaxPrice,
        });
      }
    }

    const dualChartContext = isDualChart && secondaryChart && htfVision && ltfVision ? {
      isDualChart: true,
      htfTimeframe: timeframe,
      ltfTimeframe: secondaryChart.timeframe,
      htfOriginalImageUrl: imageUrl,
      ltfOriginalImageUrl: secondaryChart.imageUrl,
      htfMarkedImageUrl: htfMarkup.markedImageUrl,
      ltfMarkedImageUrl: ltfMarkup.markedImageUrl,
      htfChartBounds: htfMarkup.chartBounds,
      ltfChartBounds: ltfMarkup.chartBounds,
      htfVisiblePriceRange: htfVision.visiblePriceRange,
      ltfVisiblePriceRange: ltfVision.visiblePriceRange,
    } : {};

    const enrichedSignal = {
      ...signal,
      analysisMeta,
      originalImageUrl: imageUrl,
      markedImageUrl: markup.markedImageUrl,
      hasMarkup: markup.hasMarkup,
      chartBounds: markup.chartBounds,
      ...dualChartContext,
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

    return analysis;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';
    const errorMetadata = extractVisionMetadataFromError(error);

    await updateAnalysis(analysisId, {
      status: 'FAILED',
      progress: 100,
      currentStage: 'Analysis failed',
      errorMessage: message,
      ...(errorMetadata ? { rawResponse: { analysisMeta: errorMetadata } } : {}),
    }).catch((updateError) => {
      console.error('[analysis-pipeline] failed to persist failure state:', updateError);
    });

    throw error;
  }
}