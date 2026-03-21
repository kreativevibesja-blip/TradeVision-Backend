import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import type { SubscriptionTier } from '../lib/supabase';

export interface SMCZone {
  min: number | null;
  max: number | null;
}

export interface SMCQualifiedZone extends SMCZone {
  reason: 'order block' | 'imbalance' | 'previous structure';
}

export interface SMCStructure {
  state: 'higher highs' | 'lower lows' | 'transition';
  bos: 'bullish' | 'bearish' | 'none';
  choch: 'bullish' | 'bearish' | 'none';
}

export interface SMCLiquidity {
  type: 'buy-side' | 'sell-side' | 'none';
  description: string;
}

export interface SMCZones {
  supply: SMCQualifiedZone | null;
  demand: SMCQualifiedZone | null;
}

export interface SMCPricePosition {
  location: 'premium' | 'discount' | 'equilibrium';
  explanation: string;
}

export interface SMCEntryPlan {
  bias: 'buy' | 'sell' | 'none';
  entryType: 'instant' | 'confirmation' | 'none';
  entryZone: SMCZone | null;
  confirmation: 'CHoCH' | 'BOS' | 'rejection' | 'none';
  reason: string;
}

export interface SMCRiskManagement {
  invalidationLevel: number | null;
  invalidationReason: string;
}

export interface SMCQuality {
  setupRating: 'A' | 'B' | 'C' | 'avoid';
  confidence: number;
}

export interface SMCFinalVerdict {
  action: 'enter' | 'wait' | 'avoid';
  message: string;
}

export interface VisionAnalysisResult {
  trend: 'bullish' | 'bearish' | 'ranging';
  structure: SMCStructure;
  liquidity: SMCLiquidity;
  zones: SMCZones;
  pricePosition: SMCPricePosition;
  entryPlan: SMCEntryPlan;
  riskManagement: SMCRiskManagement;
  quality: SMCQuality;
  finalVerdict: SMCFinalVerdict;
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

const normalizeText = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;

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

const normalizeStructureState = (value: unknown): SMCStructure['state'] => {
  if (typeof value !== 'string') {
    return 'transition';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'higher highs' || normalized === 'lower lows') {
    return normalized;
  }

  return 'transition';
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

const normalizeLiquidityType = (value: unknown): SMCLiquidity['type'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'buy-side' || normalized === 'sell-side') {
    return normalized;
  }

  return 'none';
};

const normalizeReason = (value: unknown): SMCQualifiedZone['reason'] => {
  if (typeof value !== 'string') {
    return 'previous structure';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'order block' || normalized === 'imbalance') {
    return normalized;
  }

  return 'previous structure';
};

const normalizePriceLocation = (value: unknown): SMCPricePosition['location'] => {
  if (typeof value !== 'string') {
    return 'equilibrium';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'premium' || normalized === 'discount') {
    return normalized;
  }

  return 'equilibrium';
};

const normalizeBias = (value: unknown): SMCEntryPlan['bias'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'buy' || normalized === 'sell') {
    return normalized;
  }

  return 'none';
};

const normalizeEntryType = (value: unknown): SMCEntryPlan['entryType'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'instant' || normalized === 'confirmation') {
    return normalized;
  }

  return 'none';
};

const normalizeConfirmation = (value: unknown): SMCEntryPlan['confirmation'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'choch') {
    return 'CHoCH';
  }
  if (normalized === 'bos') {
    return 'BOS';
  }
  if (normalized === 'rejection') {
    return 'rejection';
  }

  return 'none';
};

const normalizeSetupRating = (value: unknown): SMCQuality['setupRating'] => {
  if (typeof value !== 'string') {
    return 'avoid';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'A' || normalized === 'B' || normalized === 'C') {
    return normalized;
  }

  return 'avoid';
};

const normalizeFinalAction = (value: unknown): SMCFinalVerdict['action'] => {
  if (typeof value !== 'string') {
    return 'wait';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'enter' || normalized === 'avoid') {
    return normalized;
  }

  return 'wait';
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

const normalizeConfidence = (value: unknown) => {
  const numeric = normalizeNumeric(value);
  if (numeric === null) {
    return 35;
  }

  return Math.min(100, Math.max(1, Math.round(numeric)));
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

const normalizeQualifiedZone = (value: unknown): SMCQualifiedZone | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const zone = normalizeZone(record);

  if (!zone) {
    return null;
  }

  return {
    ...zone,
    reason: normalizeReason(record.reason),
  };
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

  const prompt = `You are an institutional-level Smart Money Concepts (SMC) trading analyst.

Your job is to analyze the provided chart like a professional trader, not a signal generator.

You MUST think in terms of:
- Market structure
- Liquidity
- Order flow
- Premium vs Discount
- Confirmation-based entries

Trading pair/index: ${pair}
Timeframe: ${timeframe}

========================================
OUTPUT FORMAT (STRICT JSON ONLY)
========================================

{
  "trend": "bullish | bearish | ranging",
  "structure": {
    "state": "higher highs | lower lows | transition",
    "bos": "bullish | bearish | none",
    "choch": "bullish | bearish | none"
  },
  "liquidity": {
    "type": "buy-side | sell-side | none",
    "description": "Where liquidity was taken and how price reacted"
  },
  "zones": {
    "supply": {
      "min": number,
      "max": number,
      "reason": "order block | imbalance | previous structure"
    },
    "demand": {
      "min": number,
      "max": number,
      "reason": "order block | imbalance | previous structure"
    }
  },
  "price_position": {
    "location": "premium | discount | equilibrium",
    "explanation": "Explain relative to the most recent impulse leg"
  },
  "entry_plan": {
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": {
      "min": number | null,
      "max": number | null
    },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Why this entry makes sense based on structure"
  },
  "risk_management": {
    "invalidation_level": number,
    "invalidation_reason": "Explain what breaks the setup"
  },
  "quality": {
    "setup_rating": "A | B | C | avoid",
    "confidence": 1-100
  },
  "final_verdict": {
    "action": "enter | wait | avoid",
    "message": "Clear instruction for the user"
  },
  "reasoning": "Full professional explanation using SMC logic"
}

========================================
STRICT RULES (DO NOT BREAK)
========================================

1. DO NOT force trades
   - If no clear setup -> action MUST be "wait" or "avoid"

2. ALWAYS explain liquidity
   - Identify where stops were taken (above highs / below lows)

3. ALWAYS justify zones
   - You MUST explain WHY supply/demand exists
   - No guessing levels

4. ALWAYS include invalidation
   - Define the exact price level where the setup fails

5. ENTRY DISCIPLINE
   - If price is NOT in a key zone -> entry_type MUST be "none"
   - Prefer confirmation entries over instant entries

6. PREMIUM vs DISCOUNT LOGIC
   - In bearish markets -> prefer selling in premium
   - In bullish markets -> prefer buying in discount

7. NO MID-RANGE ENTRIES
   - If price is in equilibrium -> action MUST be "wait"

8. STRUCTURE FIRST
   - If structure is unclear -> setup_rating MUST be "avoid"

9. REALISM OVER COMPLETION
   - It is better to say "no trade" than to give a bad trade

========================================
GOAL
========================================

Your output must feel like:
- a professional trader's breakdown
- not a random AI opinion
- not a generic explanation

It must be:
- precise
- disciplined
- realistic
- trustworthy

Return STRICT JSON ONLY.
Do not use markdown.
Do not add commentary outside the JSON.`;

  let result;

  try {
    result = await generateVisionResponse(genAI, primaryModel, prompt, base64Image, mimeType);
  } catch (error) {
    if (subscription === 'PRO' && primaryModel !== fallbackModel && isUnsupportedModelError(error)) {
      console.warn(`[visionAnalysis] Pro model "${primaryModel}" is unavailable. Falling back to "${fallbackModel}".`);
      result = await generateVisionResponse(genAI, fallbackModel, prompt, base64Image, mimeType);
    } else {
      throw error;
    }
  }

  const parsed = parseJsonObject(result.response.text());
  const structure = parsed.structure as Record<string, unknown> | undefined;
  const liquidity = parsed.liquidity as Record<string, unknown> | undefined;
  const zones = parsed.zones as Record<string, unknown> | undefined;
  const pricePosition = parsed.price_position as Record<string, unknown> | undefined;
  const entryPlan = parsed.entry_plan as Record<string, unknown> | undefined;
  const riskManagement = parsed.risk_management as Record<string, unknown> | undefined;
  const quality = parsed.quality as Record<string, unknown> | undefined;
  const finalVerdict = parsed.final_verdict as Record<string, unknown> | undefined;

  return {
    trend: normalizeTrend(parsed.trend),
    structure: {
      state: normalizeStructureState(structure?.state),
      bos: normalizeBosOrChoch(structure?.bos),
      choch: normalizeBosOrChoch(structure?.choch),
    },
    liquidity: {
      type: normalizeLiquidityType(liquidity?.type),
      description: normalizeText(
        liquidity?.description,
        'No meaningful liquidity event was clearly validated from the chart.'
      ),
    },
    zones: {
      supply: normalizeQualifiedZone(zones?.supply),
      demand: normalizeQualifiedZone(zones?.demand),
    },
    pricePosition: {
      location: normalizePriceLocation(pricePosition?.location),
      explanation: normalizeText(
        pricePosition?.explanation,
        'Price is not clearly positioned in premium or discount relative to the latest impulse leg.'
      ),
    },
    entryPlan: {
      bias: normalizeBias(entryPlan?.bias),
      entryType: normalizeEntryType(entryPlan?.entry_type),
      entryZone: normalizeZone(entryPlan?.entry_zone),
      confirmation: normalizeConfirmation(entryPlan?.confirmation),
      reason: normalizeText(
        entryPlan?.reason,
        'No disciplined entry plan is justified until structure and location improve.'
      ),
    },
    riskManagement: {
      invalidationLevel: normalizeNumeric(riskManagement?.invalidation_level),
      invalidationReason: normalizeText(
        riskManagement?.invalidation_reason,
        'The setup is invalidated if price breaks the structural level that supports the current bias.'
      ),
    },
    quality: {
      setupRating: normalizeSetupRating(quality?.setup_rating),
      confidence: normalizeConfidence(quality?.confidence),
    },
    finalVerdict: {
      action: normalizeFinalAction(finalVerdict?.action),
      message: normalizeText(
        finalVerdict?.message,
        'Wait for a cleaner institutional setup before committing to a trade.'
      ),
    },
    reasoning: normalizeText(
      parsed.reasoning,
      'The chart does not present a clean Smart Money Concepts setup yet, so patience is preferred over forcing an entry.'
    ),
  };
}
