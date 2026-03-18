import { getUserById } from '../lib/supabase';
import type { ChartVisionOutput } from './imageProcessing/chartVision';
import type { MarketStructureOutput } from './structureEngine/marketStructure';
import { analyzeWithGemini, type GeminiAnalysisResult } from './geminiService';

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
  provider: 'gemini';
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
  reasoning: 'Upgrade to Pro to unlock Gemini detailed reasoning, confidence, and full trade management.',
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

  const takeProfits = normalizeTakeProfits(geminiResult.takeProfits);

  return {
    bias: geminiResult.bias,
    structureSummary: geminiResult.structureSummary,
    entry: geminiResult.entry,
    stopLoss: geminiResult.stopLoss,
    takeProfits,
    liquidityZones: geminiResult.liquidityZones,
    recommendation: geminiResult.recommendation,
    confidence: geminiResult.confidence,
    reasoning: geminiResult.reasoning,
    riskReward: geminiResult.riskReward || calculateRiskReward(geminiResult.entry, geminiResult.stopLoss, takeProfits),
    isProFeatureLocked: false,
    provider: 'gemini',
  };
}