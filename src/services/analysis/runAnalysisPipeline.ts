import { updateAnalysis } from '../../lib/supabase';
import { analyzeVisionStructure, analyzeHTFVisionStructure, analyzeLTFVisionStructure } from '../visionAnalysis';
import { generateFinalSignal } from '../signalEngine';
import { drawChartMarkup, drawHTFChartMarkup, drawLTFChartMarkup, isChartMarkupEnabledForPlan } from '../chartMarkup';
import type { SubscriptionTier } from '../../lib/supabase';
import type { VisionAnalysisResult, VisionModelMetadata } from '../visionAnalysis';
import type { TradingAnalysis } from '../../lib/ai/validators/tradingAnalysisValidator';
import { classifySetup } from '../../lib/ai/playbooks/classifySetup';

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

const deriveTradingAnalysis = (vision: VisionAnalysisResult): TradingAnalysis => {
  const direction = vision.entryPlan.bias;
  const entryReadiness = direction === 'none'
    ? 'no_trade'
    : vision.finalVerdict.action === 'enter'
      ? 'ready'
      : 'waiting';
  const setupType = entryReadiness === 'no_trade'
    ? 'no_trade'
    : vision.entryPlan.entryType === 'confirmation'
      ? 'pullback'
      : vision.structure.choch !== 'none'
        ? 'reversal'
        : vision.structure.bos !== 'none'
          ? 'continuation'
          : 'range';
  const entryZone = vision.entryPlan.entryZone;
  const takeProfits = [vision.takeProfit1, vision.takeProfit2, vision.takeProfit3].filter((value): value is number => value !== null);
  const keyLevels: TradingAnalysis['keyLevels'] = [];

  if (vision.zones.supply) {
    keyLevels.push({ type: 'supply', price: vision.zones.supply.max, description: vision.zones.supply.reason });
  }
  if (vision.zones.demand) {
    keyLevels.push({ type: 'demand', price: vision.zones.demand.min, description: vision.zones.demand.reason });
  }
  if (vision.liquidity.type !== 'none') {
    keyLevels.push({ type: 'liquidity', price: null, description: vision.liquidity.description });
  }

  return {
    marketBias: vision.trend === 'bullish' || vision.trend === 'bearish' ? vision.trend : 'neutral',
    marketCondition: vision.marketCondition === 'trending' || vision.marketCondition === 'ranging' ? vision.marketCondition : 'unclear',
    setupType,
    entryReadiness,
    confidence: vision.quality.confidence,
    setupQuality: vision.quality.setupRating === 'A+' ? 'A+' : vision.quality.setupRating === 'B' ? 'B' : 'avoid',
    direction,
    entryZone: {
      from: entryZone?.min ?? null,
      to: entryZone?.max ?? null,
    },
    stopLoss: vision.stopLoss,
    takeProfits,
    invalidation: vision.riskManagement.invalidationReason,
    riskReward: null,
    keyLevels,
    whatToWaitFor: vision.finalVerdict.message,
    tradeRadarRecommendation: {
      sendToRadar: entryReadiness === 'waiting' && direction !== 'none',
      reason: entryReadiness === 'waiting'
        ? 'Setup has a condition to monitor before entry.'
        : 'No waiting setup is ready for monitoring.',
    },
    summary: vision.reasoning,
    mentorNotes: vision.confirmations?.length ? vision.confirmations : [vision.entryPlan.reason],
  };
};

export async function runAnalysisPipeline({ analysisId, userId, pair, timeframe, subscription, currentPrice, chartMinPrice, chartMaxPrice, imageUrl, base64Image, mimeType, secondaryChart }: RunAnalysisPipelineInput) {
  try {
    const isDualChart = secondaryChart !== null;
    let analysisMeta: Record<string, unknown> | null = null;

    await updateAnalysis(analysisId, {
      status: 'PROCESSING',
      progress: 10,
      currentStage: isDualChart ? 'Analyzing higher timeframe structure...' : 'Analyzing market structure...',
      errorMessage: null,
    });

    let vision;
    let htfVision: VisionAnalysisResult | null = null;
    let ltfVision: VisionAnalysisResult | null = null;

    if (isDualChart) {
      // Dual-chart mode: analyze HTF first so LTF can use the actual HTF bias and POIs.
      htfVision = await analyzeHTFVisionStructure(base64Image, mimeType, pair, timeframe);

      await updateAnalysis(analysisId, {
        progress: 30,
        currentStage: 'Analyzing lower timeframe entry logic...',
      });

      ltfVision = await analyzeLTFVisionStructure(
        secondaryChart.base64Image,
        secondaryChart.mimeType,
        pair,
        secondaryChart.timeframe,
        {
          higherTimeframe: timeframe,
          higherTimeframeBias: htfVision.trend,
          higherTimeframeSupplyZone: htfVision.zones.supply,
          higherTimeframeDemandZone: htfVision.zones.demand,
          higherTimeframePricePosition: htfVision.pricePosition.location,
        }
      );

      await updateAnalysis(analysisId, {
        progress: 50,
        currentStage: 'Combining multi-timeframe analysis...',
      });

      // Merge: HTF provides structure/zones/trend/pricePosition, LTF provides entry/SL/TP/liquidity
      vision = {
        marketCondition: htfVision.marketCondition ?? ltfVision.marketCondition,
        primaryStrategy: htfVision.primaryStrategy ?? ltfVision.primaryStrategy ?? null,
        confirmations: ltfVision.confirmations ?? [],
        trend: htfVision.trend,
        structure: htfVision.structure,
        liquidity: ltfVision.liquidity,
        zones: htfVision.zones,
        pricePosition: htfVision.pricePosition,
        entryPlan: ltfVision.entryPlan,
        counterTrendPlan: ltfVision.counterTrendPlan ?? null,
        leftSidePlan: ltfVision.leftSidePlan ?? null,
        riskManagement: ltfVision.riskManagement,
        quality: {
          setupRating: htfVision.quality.setupRating,
          confidence: Math.round((htfVision.quality.confidence + ltfVision.quality.confidence) / 2),
        },
        finalVerdict: ltfVision.finalVerdict,
        reasoning: `**Higher Timeframe (${timeframe}):** ${htfVision.reasoning}\n\n**Lower Timeframe (${secondaryChart.timeframe}):** ${ltfVision.reasoning}`,
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
      currentStage: 'Interpreting market structure...',
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
        if (!htfVision || !ltfVision || !secondaryChart) {
          throw new Error('Dual-chart markup could not be prepared because the chart analyses are incomplete');
        }

        const htfMarkupAnalysis = {
          zones: {
            supplyZone: htfVision.zones.supply,
            demandZone: htfVision.zones.demand,
          },
          liquidity: htfVision.liquidity,
          visiblePriceRange: htfVision.visiblePriceRange,
          currentPrice,
        };

        const ltfMarkupAnalysis = {
          zones: {
            supplyZone: ltfVision.zones.supply,
            demandZone: ltfVision.zones.demand,
          },
          entryPlan: ltfVision.entryPlan,
          entryZone: ltfVision.entryPlan.entryZone,
          liquidity: ltfVision.liquidity,
          invalidationLevel: ltfVision.riskManagement.invalidationLevel,
          currentPrice,
          visiblePriceRange: ltfVision.visiblePriceRange,
          stopLoss: ltfVision.stopLoss,
          takeProfit1: ltfVision.takeProfit1,
          takeProfit2: ltfVision.takeProfit2,
          takeProfit3: ltfVision.takeProfit3,
        };

        // Generate separate markups for HTF and LTF charts
        const [htfResult, ltfResult] = await Promise.all([
          drawHTFChartMarkup(Buffer.from(base64Image, 'base64'), htfMarkupAnalysis, { minPrice: chartMinPrice, maxPrice: chartMaxPrice }),
          drawLTFChartMarkup(Buffer.from(secondaryChart.base64Image, 'base64'), ltfMarkupAnalysis, { minPrice: null, maxPrice: null }),
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

    const tradingAnalysis = signal.tradingAnalysis ?? deriveTradingAnalysis(vision);
    const enrichedSignal = {
      ...signal,
      tradingAnalysis,
      internalPlaybook: signal.internalPlaybook ?? classifySetup(tradingAnalysis),
      analysisMeta,
      originalImageUrl: imageUrl,
      markedImageUrl: markup.markedImageUrl,
      hasMarkup: markup.hasMarkup,
      chartBounds: markup.chartBounds,
      // Dual-chart specific fields
      ...(isDualChart ? {
        isDualChart: true,
        htfTimeframe: timeframe,
        ltfTimeframe: secondaryChart.timeframe,
        htfOriginalImageUrl: imageUrl,
        ltfOriginalImageUrl: secondaryChart.imageUrl,
        htfMarkedImageUrl: htfMarkup.markedImageUrl,
        ltfMarkedImageUrl: ltfMarkup.markedImageUrl,
        htfChartBounds: htfMarkup.chartBounds,
        ltfChartBounds: ltfMarkup.chartBounds,
      } : {}),
    };

    const bias = signal.trend === 'bullish' ? 'BULLISH' : signal.trend === 'bearish' ? 'BEARISH' : 'NEUTRAL';

    const analysis = await updateAnalysis(analysisId, {
      status: 'COMPLETED',
      progress: 100,
      currentStage: 'Preparing market analysis...',
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
      marketBias: enrichedSignal.tradingAnalysis?.marketBias ?? null,
      marketCondition: enrichedSignal.tradingAnalysis?.marketCondition ?? enrichedSignal.marketCondition ?? null,
      setupType: enrichedSignal.tradingAnalysis?.setupType ?? null,
      entryReadiness: enrichedSignal.tradingAnalysis?.entryReadiness ?? null,
      setupQuality: enrichedSignal.tradingAnalysis?.setupQuality ?? enrichedSignal.setupQuality ?? null,
      direction: enrichedSignal.tradingAnalysis?.direction ?? enrichedSignal.entryPlan?.bias ?? null,
      entryZone: enrichedSignal.tradingAnalysis?.entryZone ?? enrichedSignal.entryZone ?? null,
      keyLevels: enrichedSignal.tradingAnalysis?.keyLevels ?? null,
      whatToWaitFor: enrichedSignal.tradingAnalysis?.whatToWaitFor ?? enrichedSignal.message,
      tradeRadarRecommendation: enrichedSignal.tradingAnalysis?.tradeRadarRecommendation ?? null,
      internalPlaybook: enrichedSignal.internalPlaybook ?? null,
      rawAiJson: enrichedSignal.rawAiJson ?? null,
      structure: enrichedSignal.structure,
      strategy: enrichedSignal.primaryStrategy ?? 'Market Read',
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
