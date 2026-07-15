import { updateAnalysis } from '../../lib/supabase';
import { generateFinalSignal } from '../signalEngine';
import type { VisionModelMetadata } from '../visionAnalysis';
import type { MarketCandle } from '../marketData';
import { analyzeLiveChartCandles } from '../liveChartAnalysis';
import type { VisionAnalysisResult } from '../visionAnalysis';
import type { TradingAnalysis } from '../../lib/ai/validators/tradingAnalysisValidator';
import type { AnalysisMode } from '../../lib/ai/validators/tradingAnalysisValidator';
import { classifySetup } from '../../lib/ai/playbooks/classifySetup';

interface RunLiveChartAnalysisPipelineInput {
  analysisId: string;
  pair: string;
  timeframe: string;
  currentPrice: number;
  candles: MarketCandle[];
  analysisMode?: AnalysisMode;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isVisionModelMetadata = (value: unknown): value is VisionModelMetadata =>
  isRecord(value) && typeof value.provider === 'string' && typeof value.primaryModel === 'string' && typeof value.actualModel === 'string';

const deriveTradingAnalysis = (vision: VisionAnalysisResult): TradingAnalysis => {
  const direction = vision.entryPlan.bias;
  const entryReadiness = direction === 'none'
    ? 'no_trade'
    : vision.finalVerdict.action === 'enter'
      ? 'ready'
      : 'waiting';
  const setupType = entryReadiness === 'no_trade'
    ? 'no_trade'
    : vision.structure.choch !== 'none'
      ? 'reversal'
      : vision.structure.bos !== 'none'
        ? 'continuation'
        : vision.entryPlan.entryType === 'confirmation'
        ? 'pullback'
        : 'range';
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
    analysisMode: 'balanced',
    entryTiming: entryReadiness === 'ready' ? 'ENTER NOW' : entryReadiness === 'waiting' ? 'WAIT 1 CANDLE' : 'WATCH ONLY',
    confidence: vision.quality.confidence,
    setupQuality: vision.quality.setupRating === 'A+' ? 'A+' : vision.quality.setupRating === 'B' ? 'B' : 'avoid',
    tradeQuality: vision.quality.confidence >= 85 ? 'Excellent' : vision.quality.confidence >= 75 ? 'Strong' : vision.quality.confidence >= 60 ? 'Moderate' : 'Weak',
    riskLevel: vision.marketCondition === 'ranging' ? 'high' : vision.quality.confidence >= 80 ? 'low' : 'medium',
    direction,
    entryZone: { from: vision.entryPlan.entryZone?.min ?? null, to: vision.entryPlan.entryZone?.max ?? null },
    stopLoss: vision.stopLoss,
    takeProfits: [vision.takeProfit1, vision.takeProfit2, vision.takeProfit3].filter((value): value is number => value !== null),
    invalidation: vision.riskManagement.invalidationReason,
    riskReward: null,
    keyLevels,
    whatToWaitFor: vision.finalVerdict.message,
    tradeRadarRecommendation: {
      sendToRadar: entryReadiness === 'waiting' && direction !== 'none',
      reason: entryReadiness === 'waiting' ? 'Live setup has a condition to monitor before entry.' : 'No waiting live setup is ready for monitoring.',
    },
    summary: vision.reasoning,
    mentorNotes: vision.confirmations?.length ? vision.confirmations : [vision.entryPlan.reason],
  };
};

export async function runLiveChartAnalysisPipeline({ analysisId, pair, timeframe, currentPrice, candles, analysisMode = 'balanced' }: RunLiveChartAnalysisPipelineInput) {
  await updateAnalysis(analysisId, {
    status: 'PROCESSING',
    progress: 10,
    currentStage: 'Fetching live market structure...',
    errorMessage: null,
  });

  const vision = await analyzeLiveChartCandles(pair, timeframe, candles, analysisMode);
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
  const tradingAnalysis = signal.tradingAnalysis ?? deriveTradingAnalysis(vision);
  const enrichedSignal = {
    ...signal,
    tradingAnalysis,
    internalPlaybook: signal.internalPlaybook ?? classifySetup(tradingAnalysis),
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
}
