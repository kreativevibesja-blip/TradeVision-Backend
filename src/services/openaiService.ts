import OpenAI from 'openai';
import { config } from '../config';
import type { GeminiAnalysisResult } from './geminiService';

export interface OpenAIRefinedResult {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  recommendation: string;
  reasoning: string;
  riskReward: string | null;
}

const openai = new OpenAI({ apiKey: config.openai.apiKey || 'missing-api-key' });

const parseJsonObject = (value: string) => {
  const trimmed = value.trim();
  const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('OpenAI did not return JSON');
  }

  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
};

const normalizeBias = (value: unknown): OpenAIRefinedResult['bias'] => {
  if (typeof value !== 'string') {
    return 'neutral';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish') {
    return normalized;
  }

  return 'neutral';
};

const normalizeTakeProfits = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => parseNumber(item)).filter((item): item is number => item !== null)
    : [];

export async function refineWithOpenAI(data: Record<string, unknown>): Promise<OpenAIRefinedResult> {
  if (!config.openai.apiKey) {
    throw new Error('OpenAI API key is not configured');
  }

  const prompt = `You are a professional trading analyst.

Improve this structured analysis:

${JSON.stringify(data, null, 2)}

Return ONLY valid JSON with this exact schema:
{
  "bias": "bullish | bearish | neutral",
  "confidence": 0,
  "entry": 0,
  "stop_loss": 0,
  "take_profits": [0, 0, 0],
  "recommendation": "enter now | wait",
  "reasoning": "clear explanation",
  "risk_reward": "ratio"
}

Rules:
- Keep the response professional and non-generic
- Use numeric values for price fields
- Keep confidence between 0 and 100
- Use only the structured input provided`;

  const response = await openai.chat.completions.create({
    model: config.openai.analysisModel,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 700,
  });

  const parsed = parseJsonObject(response.choices[0]?.message?.content || '{}');

  return {
    bias: normalizeBias(parsed.bias),
    confidence: typeof parsed.confidence === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.confidence))) : parseNumber(parsed.confidence),
    entry: parseNumber(parsed.entry),
    stopLoss: parseNumber(parsed.stop_loss),
    takeProfits: normalizeTakeProfits(parsed.take_profits),
    recommendation:
      typeof parsed.recommendation === 'string' && parsed.recommendation.trim()
        ? parsed.recommendation.trim().toLowerCase()
        : 'wait',
    reasoning:
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'OpenAI returned an incomplete refinement response.',
    riskReward:
      typeof parsed.risk_reward === 'string' && parsed.risk_reward.trim()
        ? parsed.risk_reward.trim()
        : null,
  };
}

export const buildOpenAIFallback = (geminiResult: GeminiAnalysisResult): OpenAIRefinedResult => ({
  bias: geminiResult.bias,
  confidence: null,
  entry: geminiResult.entry,
  stopLoss: geminiResult.stopLoss,
  takeProfits: geminiResult.takeProfits,
  recommendation: geminiResult.recommendation,
  reasoning: geminiResult.structureSummary,
  riskReward: null,
});