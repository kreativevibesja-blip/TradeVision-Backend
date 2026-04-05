import { updateAnalysis } from '../../lib/supabase';
import { generateFinalSignal } from '../signalEngine';
import type { VisionModelMetadata } from '../visionAnalysis';
import type { MarketCandle } from '../marketData';
import { analyzeLiveChartCandles } from '../liveChartAnalysis';

interface RunLiveChartAnalysisPipelineInput {
  analysisId: string;
  pair: string;
  timeframe: string;
  currentPrice: number;
  candles: MarketCandle[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isVisionModelMetadata = (value: unknown): value is VisionModelMetadata =>
  isRecord(value) && typeof value.provider === 'string' && typeof value.primaryModel === 'string' && typeof value.actualModel === 'string';

export async function runLiveChartAnalysisPipeline({ analysisId, pair, timeframe, currentPrice, candles }: RunLiveChartAnalysisPipelineInput) {
  await updateAnalysis(analysisId, {
    status: 'PROCESSING',
    progress: 10,
    currentStage: 'Fetching live market structure...',
    errorMessage: null,
  });

  const vision = await analyzeLiveChartCandles(pair, timeframe, candles);
  const metadata = isVisionModelMetadata(vision.analysisMeta) ? vision.analysisMeta : null;

  await updateAnalysis(analysisId, {
    progress: 55,
    currentStage: 'Interpreting live chart structure...',
    layer1Output: {
      ...vision,
      marketData: {
        candleCount: candles.length,
        lastCandleAt: candles[candles.length - 1]?.timestamp ?? null,
      },
    },
  });

  const signal = generateFinalSignal(vision, currentPrice);
  const enrichedSignal = {
    ...signal,
    analysisMeta: metadata,
    originalImageUrl: null,
    markedImageUrl: null,
    hasMarkup: false,
    chartBounds: null,
    marketData: {
      symbol: pair,
      timeframe,
      candleCount: candles.length,
      lastCandleAt: candles[candles.length - 1]?.timestamp ?? null,
    },
  };

  const bias = signal.trend === 'bullish' ? 'BULLISH' : signal.trend === 'bearish' ? 'BEARISH' : 'NEUTRAL';

  return updateAnalysis(analysisId, {
    status: 'COMPLETED',
    progress: 100,
    currentStage: 'Preparing live chart result...',
    bias,
    entry: null,
    stopLoss: enrichedSignal.stopLoss,
    tp1: enrichedSignal.takeProfit1,
    tp2: enrichedSignal.takeProfit2,
    takeProfits: [enrichedSignal.takeProfit1, enrichedSignal.takeProfit2, enrichedSignal.takeProfit3].filter((value): value is number => value !== null),
    confidence: enrichedSignal.confidence,
    explanation: enrichedSignal.reasoning,
    analysisText: enrichedSignal.reasoning,
    rawResponse: enrichedSignal,
    structure: enrichedSignal.structure,
    strategy: enrichedSignal.primaryStrategy ?? `${enrichedSignal.trend.toUpperCase()} ${enrichedSignal.entryLogic.type.toUpperCase()} SMC setup`,
    waitConditions: enrichedSignal.message,
    errorMessage: null,
  });
}