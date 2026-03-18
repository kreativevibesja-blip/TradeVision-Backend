import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';

export interface GeminiAnalysisResult {
  bias: 'bullish' | 'bearish' | 'neutral';
  structureSummary: string;
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  liquidityZones: string[];
  recommendation: string;
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

const normalizeBias = (value: unknown): GeminiAnalysisResult['bias'] => {
  if (typeof value !== 'string') {
    return 'neutral';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish') {
    return normalized;
  }

  return 'neutral';
};

const normalizeStringList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];

export async function analyzeWithGemini(base64Image: string, mimeType: string, pair: string, timeframe: string): Promise<GeminiAnalysisResult> {
  if (!config.gemini.apiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const model = genAI.getGenerativeModel({ model: config.gemini.model });

  const prompt = `You are a Smart Money Concepts trader.

Analyze THIS trading chart image carefully.

Trading pair/index: ${pair}
Timeframe: ${timeframe}

Return ONLY valid JSON with this exact schema:
{
  "bias": "bullish | bearish | neutral",
  "structure_summary": "short description",
  "entry": "price or null",
  "stop_loss": "price or null",
  "take_profits": ["tp1", "tp2"],
  "liquidity_zones": ["levels"],
  "recommendation": "enter now | wait"
}

Rules:
- No markdown
- No extra text
- Base the answer only on the image
- Keep structure_summary short and specific
- If an exact price is unclear, return null instead of guessing`;

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

  return {
    bias: normalizeBias(parsed.bias),
    structureSummary:
      typeof parsed.structure_summary === 'string' && parsed.structure_summary.trim()
        ? parsed.structure_summary.trim()
        : 'Gemini identified a chart structure but did not provide a detailed summary.',
    entry: parseNumber(parsed.entry),
    stopLoss: parseNumber(parsed.stop_loss),
    takeProfits: normalizeStringList(parsed.take_profits).map((target) => parseNumber(target)).filter((value): value is number => value !== null),
    liquidityZones: normalizeStringList(parsed.liquidity_zones),
    recommendation:
      typeof parsed.recommendation === 'string' && parsed.recommendation.trim()
        ? parsed.recommendation.trim().toLowerCase()
        : 'wait',
  };
}