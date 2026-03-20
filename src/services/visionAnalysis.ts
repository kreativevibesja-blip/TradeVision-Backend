import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import type { SubscriptionTier } from '../lib/supabase';

export interface SMCZone {
  min: number | null;
  max: number | null;
}

export interface SMCStructure {
  bos: 'bullish' | 'bearish' | 'none';
  choch: 'bullish' | 'bearish' | 'none';
}

export interface SMCLiquidity {
  sweep: 'above highs' | 'below lows' | 'none';
  liquidityZones: string[];
}

export interface SMCZones {
  supplyZone: SMCZone | null;
  demandZone: SMCZone | null;
}

export interface SMCEntryLogic {
  type: 'reversal' | 'continuation' | 'none';
  entryZone: SMCZone | null;
  confirmationRequired: boolean;
  confirmationType: 'bos' | 'choch' | 'rejection' | 'none';
}

export interface VisionAnalysisResult {
  trend: 'bullish' | 'bearish' | 'ranging';
  structure: SMCStructure;
  liquidity: SMCLiquidity;
  zones: SMCZones;
  currentPricePosition: 'premium' | 'discount' | 'equilibrium';
  entryLogic: SMCEntryLogic;
  setupQuality: 'high' | 'medium' | 'low';
  signalType: 'instant' | 'pending' | 'wait';
  reasoning: string;
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

const normalizeTrend = (value: unknown): VisionAnalysisResult['trend'] => {
  if (typeof value !== 'string') {
    return 'ranging';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish') {
    return normalized;
  }

  return 'ranging';
};

const normalizeBosOrChoch = (value: unknown): SMCStructure['bos'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bullish' || normalized === 'bearish') {
    return normalized;
  }

  return 'none';
};

const normalizeSweep = (value: unknown): SMCLiquidity['sweep'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'above highs' || normalized === 'below lows') {
    return normalized;
  }

  return 'none';
};

const normalizeSignalType = (value: unknown): VisionAnalysisResult['signalType'] => {
  if (typeof value !== 'string') {
    return 'wait';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'instant' || normalized === 'pending') {
    return normalized;
  }

  return 'wait';
};

const normalizeCurrentPricePosition = (value: unknown): VisionAnalysisResult['currentPricePosition'] => {
  if (typeof value !== 'string') {
    return 'equilibrium';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'premium' || normalized === 'discount') {
    return normalized;
  }

  return 'equilibrium';
};

const normalizeEntryType = (value: unknown): VisionAnalysisResult['entryLogic']['type'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'reversal' || normalized === 'continuation') {
    return normalized;
  }

  return 'none';
};

const normalizeConfirmationType = (value: unknown): VisionAnalysisResult['entryLogic']['confirmationType'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bos' || normalized === 'choch' || normalized === 'rejection') {
    return normalized;
  }

  return 'none';
};

const normalizeText = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

const normalizeBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallback;
};

const normalizeSetupQuality = (value: unknown): VisionAnalysisResult['setupQuality'] => {
  if (typeof value !== 'string') {
    return 'low';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'high' || normalized === 'medium') {
    return normalized;
  }

  return 'low';
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
};

const normalizeNumeric = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numeric = Number(value.replace(/,/g, '').trim());
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
};

const normalizeZone = (value: unknown): SMCZone | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const min = normalizeNumeric(record.min);
  const max = normalizeNumeric(record.max);

  if (min === null || max === null) {
    return null;
  }

  return min <= max ? { min, max } : { min: max, max: min };
};

const normalizeGeminiModelName = (modelName: string) => {
  const normalized = modelName.trim();
  const withoutPrefix = normalized.replace(/^models\//i, '');
  const lower = withoutPrefix.toLowerCase();

  if (lower === 'gemini-3-flash') {
    return 'gemini-3-flash-preview';
  }

  return withoutPrefix;
};

const getGeminiModelForSubscription = (subscription: SubscriptionTier) =>
  normalizeGeminiModelName(subscription === 'PRO' ? config.gemini.proModel : config.gemini.freeModel);

const isUnsupportedModelError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return message.includes('not found') || message.includes('not supported for generatecontent') || message.includes('models/');
};

const generateVisionResponse = async (
  genAI: GoogleGenerativeAI,
  modelName: string,
  prompt: string,
  base64Image: string,
  mimeType: string
) => {
  const model = genAI.getGenerativeModel({ model: modelName });
  return model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);
};

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
  const primaryModel = getGeminiModelForSubscription(subscription);
  const fallbackModel = normalizeGeminiModelName(config.gemini.freeModel);

  const prompt = `Analyze this trading chart using Smart Money Concepts (SMC).

Trading pair/index: ${pair}
Timeframe: ${timeframe}

Return ONLY valid JSON with this exact schema:
{
  "trend": "bullish | bearish | ranging",
  "structure": {
    "bos": "bullish | bearish | none",
    "choch": "bullish | bearish | none"
  },
  "liquidity": {
    "sweep": "above highs | below lows | none",
    "liquidity_zones": ["string description"]
  },
  "zones": {
    "supply_zone": { "min": number, "max": number },
    "demand_zone": { "min": number, "max": number }
  },
  "current_price_position": "premium | discount | equilibrium",
  "entry_logic": {
    "type": "reversal | continuation | none",
    "entry_zone": { "min": number, "max": number },
    "confirmation_required": true,
    "confirmation_type": "bos | choch | rejection | none"
  },
  "setup_quality": "high | medium | low",
  "signal_type": "instant | pending | wait",
  "reasoning": "clear explanation using SMC concepts"
}

STRICT RULES:
- DO NOT guess exact entry prices
- DO NOT force trades
- If no clean structure, signal_type MUST be "wait"
- Identify liquidity sweeps BEFORE suggesting entries
- Prefer waiting for confirmation (BOS/CHoCH) over immediate entry
- Entry zones must be realistic and NOT near current price unless valid
- Use only JSON
- No markdown
- No extra text`;

  let result;

  try {
    result = await generateVisionResponse(genAI, primaryModel, prompt, base64Image, mimeType);
  } catch (error) {
    if (subscription === 'PRO' && primaryModel !== fallbackModel && isUnsupportedModelError(error)) {
      console.warn(`[visionAnalysis] Pro model \"${primaryModel}\" is unavailable. Falling back to \"${fallbackModel}\".`);
      result = await generateVisionResponse(genAI, fallbackModel, prompt, base64Image, mimeType);
    } else {
      throw error;
    }
  }

  const parsed = parseJsonObject(result.response.text());
  const trend = normalizeTrend(parsed.trend);
  const setupQuality = normalizeSetupQuality(parsed.setup_quality);
  const entryLogic = parsed.entry_logic as Record<string, unknown> | undefined;
  const liquidity = parsed.liquidity as Record<string, unknown> | undefined;
  const zones = parsed.zones as Record<string, unknown> | undefined;
  const signalType =
    setupQuality === 'low' || trend === 'ranging'
      ? 'wait'
      : normalizeSignalType(parsed.signal_type);

  return {
    trend,
    structure: {
      bos: normalizeBosOrChoch((parsed.structure as Record<string, unknown> | undefined)?.bos),
      choch: normalizeBosOrChoch((parsed.structure as Record<string, unknown> | undefined)?.choch),
    },
    liquidity: {
      sweep: normalizeSweep(liquidity?.sweep),
      liquidityZones: normalizeStringArray(liquidity?.liquidity_zones),
    },
    zones: {
      supplyZone: normalizeZone(zones?.supply_zone),
      demandZone: normalizeZone(zones?.demand_zone),
    },
    currentPricePosition: normalizeCurrentPricePosition(parsed.current_price_position),
    entryLogic: {
      type: normalizeEntryType(entryLogic?.type),
      entryZone: normalizeZone(entryLogic?.entry_zone),
      confirmationRequired: normalizeBoolean(entryLogic?.confirmation_required, true),
      confirmationType: normalizeConfirmationType(entryLogic?.confirmation_type),
    },
    setupQuality,
    signalType,
    reasoning: normalizeText(
      parsed.reasoning,
      'The chart does not present a clean Smart Money Concepts setup yet, so patience is preferred over forcing an entry.'
    ),
  };
}