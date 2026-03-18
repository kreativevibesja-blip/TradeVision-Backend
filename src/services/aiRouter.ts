import { getUserById } from '../lib/supabase';
import type { ChartVisionOutput } from './imageProcessing/chartVision';
import type { MarketStructureOutput } from './structureEngine/marketStructure';
import { analyzeWithGemini, type GeminiAnalysisResult } from './geminiService';
import { buildOpenAIFallback, refineWithOpenAI } from './openaiService';

export interface AIAnalysisResult {
  bias: 'bullish' | 'bearish' | 'neutral';
  structureSummary: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  liquidityZones: string[];
  recommendation: string;
  confidence: number | null;
  reasoning: string;
  riskReward: string | null;
  isProFeatureLocked: boolean;
  provider: 'gemini' | 'gemini+openai';
}

interface AnalyzeChartAIInput {
  userId: string;
  base64Image: string;
  mimeType: string;
  pair: string;
  timeframe: string;
  layer1: ChartVisionOutput;
  layer2: MarketStructureOutput;
}

const normalizeTakeProfits = (values: Array<number | null | undefined>) =>
  values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

const calculateRiskReward = (entry: number | null, stopLoss: number | null, takeProfits: number[]) => {
  if (entry === null || stopLoss === null || takeProfits.length === 0) {
    return null;
  }

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(takeProfits[0] - entry);

  if (!risk || !reward) {
    return null;
  }

  return `1:${(reward / risk).toFixed(2)}`;
};

const buildFreeResponse = (geminiResult: GeminiAnalysisResult): AIAnalysisResult => ({
  bias: geminiResult.bias,
  structureSummary: geminiResult.structureSummary,
  entry: geminiResult.entry,
  stopLoss: geminiResult.stopLoss,
  takeProfits: geminiResult.takeProfits.slice(0, 1),
  liquidityZones: geminiResult.liquidityZones,
  recommendation: geminiResult.recommendation,
  confidence: null,
  reasoning: 'Upgrade to Pro to unlock detailed reasoning, confidence, and refined trade management.',
  riskReward: null,
  isProFeatureLocked: true,
  provider: 'gemini',
});

export async function analyzeChartAI({ userId, base64Image, mimeType, pair, timeframe, layer1, layer2 }: AnalyzeChartAIInput): Promise<AIAnalysisResult> {
  const user = await getUserById(userId);
  const plan = user?.subscription === 'PRO' ? 'pro' : 'free';

  const geminiResult = await analyzeWithGemini(base64Image, mimeType, pair, timeframe);

  if (plan === 'free') {
    return buildFreeResponse(geminiResult);
  }

  try {
    const refined = await refineWithOpenAI({
      pair,
      timeframe,
      gemini: geminiResult,
      layer1,
      layer2,
    });

    const takeProfits = normalizeTakeProfits(refined.takeProfits.length ? refined.takeProfits : geminiResult.takeProfits);

    return {
      bias: refined.bias || geminiResult.bias,
      structureSummary: geminiResult.structureSummary,
      entry: refined.entry ?? geminiResult.entry,
      stopLoss: refined.stopLoss ?? geminiResult.stopLoss,
      takeProfits,
      liquidityZones: geminiResult.liquidityZones,
      recommendation: refined.recommendation || geminiResult.recommendation,
      confidence: refined.confidence,
      reasoning: refined.reasoning,
      riskReward: refined.riskReward || calculateRiskReward(refined.entry ?? geminiResult.entry, refined.stopLoss ?? geminiResult.stopLoss, takeProfits),
      isProFeatureLocked: false,
      provider: 'gemini+openai',
    };
  } catch (error) {
    console.error('OpenAI refinement failed, returning Gemini result:', error);

    const fallback = buildOpenAIFallback(geminiResult);
    return {
      bias: fallback.bias,
      structureSummary: geminiResult.structureSummary,
      entry: fallback.entry,
      stopLoss: fallback.stopLoss,
      takeProfits: fallback.takeProfits,
      liquidityZones: geminiResult.liquidityZones,
      recommendation: fallback.recommendation,
      confidence: fallback.confidence,
      reasoning: fallback.reasoning,
      riskReward: calculateRiskReward(fallback.entry, fallback.stopLoss, fallback.takeProfits),
      isProFeatureLocked: false,
      provider: 'gemini',
    };
  }
}