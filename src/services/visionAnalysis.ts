import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import type { SubscriptionTier } from '../lib/supabase';

export interface VisionStructureZones {
  recentHighZone: string;
  recentLowZone: string;
}

export interface VisionAnalysisResult {
  bias: 'bullish' | 'bearish' | 'neutral';
  trendStrength: 'weak' | 'moderate' | 'strong';
  structure: VisionStructureZones;
  structureSummary: string;
  entryType: 'breakout' | 'pullback' | 'reversal';
  liquidityContext: string;
  recommendation: 'wait' | 'potential setup forming' | 'setup ready';
  clarity: 'clear' | 'mixed' | 'unclear';
}

const parseJsonObject = (value: string) => {
  const trimmed = value.trim();
  const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini did not return JSON');
  }

  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
};

const normalizeBias = (value: unknown): VisionAnalysisResult['bias'] => {
  if (typeof value !== 'string') {
    return 'neutral';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish') {
    return normalized;
  }

  return 'neutral';
};

const normalizeTrendStrength = (value: unknown): VisionAnalysisResult['trendStrength'] => {
  if (typeof value !== 'string') {
    return 'weak';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'moderate' || normalized === 'strong') {
    return normalized;
  }

  return 'weak';
};

const normalizeEntryType = (value: unknown): VisionAnalysisResult['entryType'] => {
  if (typeof value !== 'string') {
    return 'pullback';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'breakout' || normalized === 'reversal') {
    return normalized;
  }

  return 'pullback';
};

const normalizeRecommendation = (value: unknown): VisionAnalysisResult['recommendation'] => {
  if (typeof value !== 'string') {
    return 'wait';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'potential setup forming' || normalized === 'setup ready') {
    return normalized;
  }

  return 'wait';
};

const normalizeClarity = (value: unknown): VisionAnalysisResult['clarity'] => {
  if (typeof value !== 'string') {
    return 'unclear';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'clear' || normalized === 'mixed') {
    return normalized;
  }

  return 'unclear';
};

const normalizeText = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

const getGeminiModelForSubscription = (subscription: SubscriptionTier) =>
  subscription === 'PRO' ? config.gemini.proModel : config.gemini.freeModel;

export async function analyzeVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string,
  subscription: SubscriptionTier
): Promise<VisionAnalysisResult> {
  if (!config.gemini.apiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const model = genAI.getGenerativeModel({ model: getGeminiModelForSubscription(subscription) });

  const prompt = `You are a trading chart vision analyst.

Analyze this chart image visually.

Trading pair/index: ${pair}
Timeframe: ${timeframe}

Return ONLY valid JSON with this exact schema:
{
  "bias": "bullish | bearish | neutral",
  "trend_strength": "weak | moderate | strong",
  "structure": {
    "recent_high_zone": "descriptive top area only",
    "recent_low_zone": "descriptive bottom area only"
  },
  "structure_summary": "short structural explanation",
  "entry_type": "breakout | pullback | reversal",
  "liquidity_context": "above highs | below lows | balanced",
  "recommendation": "wait | potential setup forming | setup ready",
  "clarity": "clear | mixed | unclear"
}

Rules:
- Never output numeric prices or price guesses
- Describe only structure, positioning, momentum, and liquidity context
- If the chart is messy or unclear, set bias to neutral, recommendation to wait, and clarity to unclear
- No markdown
- No extra text`;

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const parsed = parseJsonObject(result.response.text());
  const clarity = normalizeClarity(parsed.clarity);
  const recommendation = clarity === 'unclear' ? 'wait' : normalizeRecommendation(parsed.recommendation);
  const bias = clarity === 'unclear' ? 'neutral' : normalizeBias(parsed.bias);

  return {
    bias,
    trendStrength: normalizeTrendStrength(parsed.trend_strength),
    structure: {
      recentHighZone: normalizeText((parsed.structure as Record<string, unknown> | undefined)?.recent_high_zone, 'Upper chart area'),
      recentLowZone: normalizeText((parsed.structure as Record<string, unknown> | undefined)?.recent_low_zone, 'Lower chart area'),
    },
    structureSummary: normalizeText(
      parsed.structure_summary,
      'Structure is visible, but the image did not provide enough clarity for a more detailed summary.'
    ),
    entryType: normalizeEntryType(parsed.entry_type),
    liquidityContext: normalizeText(parsed.liquidity_context, 'balanced'),
    recommendation,
    clarity,
  };
}