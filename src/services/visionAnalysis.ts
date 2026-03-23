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
  visiblePriceRange: { min: number; max: number } | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  analysisMeta?: VisionAnalysisMetadata;
}

export interface VisionDualModelMetadata {
  mode: 'dual';
  charts: VisionModelMetadata[];
}

export type VisionAnalysisMetadata = VisionModelMetadata | VisionDualModelMetadata;

export interface VisionModelMetadata {
  provider: 'gemini';
  mode: 'single' | 'htf' | 'ltf';
  primaryModel: string;
  fallbackModel: string | null;
  actualModel: string;
  usedFallback: boolean;
}

export class VisionAnalysisError extends Error {
  metadata: VisionModelMetadata;

  constructor(message: string, metadata: VisionModelMetadata) {
    super(message);
    this.name = 'VisionAnalysisError';
    this.metadata = metadata;
  }
}

const parseJsonObject = (value: string) => {
  const trimmed = value.trim();
  const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('TradeVision analysis service did not return valid JSON');
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

const normalizeVisiblePriceRange = (value: unknown): { min: number; max: number } | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const min = normalizeNumeric(record.min);
  const max = normalizeNumeric(record.max);

  if (min === null || max === null || max <= min) {
    return null;
  }

  return { min, max };
};

const normalizeGeminiModelName = (modelName: string) => {
  const normalized = modelName.trim();
  const withoutPrefix = normalized.replace(/^models\//i, '');
  const lower = withoutPrefix.toLowerCase();

  if (lower === 'gemini-3.1-flash-lite') {
    return 'gemini-3.1-flash-lite-preview';
  }

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

const createVisionModelMetadata = (
  mode: VisionModelMetadata['mode'],
  primaryModel: string,
  fallbackModel: string | null,
  actualModel: string
): VisionModelMetadata => ({
  provider: 'gemini',
  mode,
  primaryModel,
  fallbackModel,
  actualModel,
  usedFallback: Boolean(fallbackModel && actualModel === fallbackModel),
});

const withVisionModelMetadata = (
  result: Omit<VisionAnalysisResult, 'analysisMeta'>,
  metadata: VisionModelMetadata
): VisionAnalysisResult => ({
  ...result,
  analysisMeta: metadata,
});

const toVisionAnalysisError = (error: unknown, metadata: VisionModelMetadata) => {
  if (error instanceof VisionAnalysisError) {
    return error;
  }

  return new VisionAnalysisError(error instanceof Error ? error.message : 'Vision analysis failed', metadata);
};

export async function analyzeVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string,
  subscription: SubscriptionTier
): Promise<VisionAnalysisResult> {
  if (!config.gemini.apiKey) {
    throw new Error('TradeVision AI is not configured correctly');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const primaryModel = getGeminiModelForSubscription(subscription);
  const fallbackModel = normalizeGeminiModelName(config.gemini.freeModel);
  const resolvedFallbackModel = primaryModel !== fallbackModel ? fallbackModel : null;

  const basePromptHeader = `You are an institutional-level Smart Money Concepts (SMC) trading analyst.

Your job is to analyze the provided chart like a professional trader, not a signal generator.

You MUST think in terms of:
- Market structure
- Liquidity
- Order flow
- Premium vs Discount
- Confirmation-based entries

Trading pair/index: ${pair}
Timeframe: ${timeframe}`;

  const proJsonSchema = `
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
  "stop_loss": number | null,
  "take_profit_1": number | null,
  "take_profit_2": number | null,
  "take_profit_3": number | null,
  "reasoning": "Concise SMC explanation in 2-4 short sentences",
  "visible_price_range": {
    "min": "lowest price number visible on the right-side Y-axis",
    "max": "highest price number visible on the right-side Y-axis"
  }
}`;

  const freeJsonSchema = `
{
  "trend": "bullish | bearish | ranging",
  "structure": {
    "state": "higher highs | lower lows | transition",
    "bos": "bullish | bearish | none",
    "choch": "bullish | bearish | none"
  },
  "liquidity": {
    "type": "buy-side | sell-side | none",
    "description": "Brief description of liquidity conditions"
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
    "explanation": "Brief explanation of price position"
  },
  "entry_plan": {
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": {
      "min": number | null,
      "max": number | null
    },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Brief reason for this entry"
  },
  "risk_management": {
    "invalidation_level": number,
    "invalidation_reason": "What breaks the setup"
  },
  "quality": {
    "setup_rating": "A | B | C | avoid",
    "confidence": 1-100
  },
  "final_verdict": {
    "action": "enter | wait | avoid",
    "message": "Clear instruction for the user"
  },
  "reasoning": "Concise explanation of the setup using SMC logic",
  "visible_price_range": {
    "min": "lowest price number visible on the right-side Y-axis",
    "max": "highest price number visible on the right-side Y-axis"
  }
}`;

  const proRules = `
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

10. PRECISE ZONE BOUNDARIES
   - Read the Y-axis (right-side price scale) carefully
   - Zone min/max must be TIGHT — only the order block body or key candle range
   - Do NOT create wide supply/demand zones spanning large price ranges
   - A typical zone should span 0.5-2% of the visible price range

11. VISIBLE PRICE RANGE
   - Read the lowest and highest price labels on the right Y-axis of the chart
   - Return these exact numbers as visible_price_range min and max

12. STOP LOSS AND TAKE PROFIT RULES
   - If action is "enter" (immediate trade): provide DEFINITIVE stop_loss, take_profit_1, take_profit_2, and take_profit_3 with exact price levels
   - If action is "wait": provide POTENTIAL/PROJECTED stop_loss and take_profit levels based on where you expect the setup to complete
   - If action is "avoid": stop_loss and take_profits can be null
   - stop_loss MUST be at a logical structural level (below demand for buys, above supply for sells)
   - take_profit_1: conservative target (nearest structure level)
   - take_profit_2: moderate target (next key level)
   - take_profit_3: aggressive target (major structure or liquidity pool)
   - Risk:Reward ratio must be at least 1:2 for take_profit_1`;

  const freeRules = `
========================================
STRICT RULES (DO NOT BREAK)
========================================

1. DO NOT force trades
   - If no clear setup -> action MUST be "wait" or "avoid"

2. Identify general liquidity conditions briefly

3. Justify supply/demand zones

4. Include invalidation level

5. ENTRY DISCIPLINE
   - If price is NOT in a key zone -> entry_type MUST be "none"

6. STRUCTURE FIRST
   - If structure is unclear -> setup_rating MUST be "avoid"

7. REALISM OVER COMPLETION
   - It is better to say "no trade" than to give a bad trade

8. PRECISE ZONE BOUNDARIES
   - Zone min/max must be TIGHT — only the order block body or key candle range

9. VISIBLE PRICE RANGE
   - Read the lowest and highest price labels on the right Y-axis of the chart
   - Return these exact numbers as visible_price_range min and max`;

  const proGoal = `
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

Keep reasoning tight:
- maximum 2-4 short sentences
- roughly half the length of a normal full breakdown
- mention only the most important structure, liquidity, zone, and verdict points
- avoid repetition and filler

Return STRICT JSON ONLY.
Do not use markdown.
Do not add commentary outside the JSON.`;

  const freeGoal = `
========================================
GOAL
========================================

Provide a useful overview of the chart's market structure and key levels.
Keep your reasoning concise — 2-3 sentences max.
Do NOT include stop loss or take profit levels.

Return STRICT JSON ONLY.
Do not use markdown.
Do not add commentary outside the JSON.`;

  const prompt = subscription === 'PRO'
    ? `${basePromptHeader}\n\n========================================\nOUTPUT FORMAT (STRICT JSON ONLY)\n========================================\n${proJsonSchema}\n${proRules}\n${proGoal}`
    : `${basePromptHeader}\n\n========================================\nOUTPUT FORMAT (STRICT JSON ONLY)\n========================================\n${freeJsonSchema}\n${freeRules}\n${freeGoal}`;

  let result;
  let actualModel = primaryModel;

  try {
    try {
      result = await generateVisionResponse(genAI, primaryModel, prompt, base64Image, mimeType);
    } catch (error) {
      if (subscription === 'PRO' && resolvedFallbackModel && isUnsupportedModelError(error)) {
        console.warn(`[visionAnalysis] Pro model "${primaryModel}" is unavailable. Falling back to "${resolvedFallbackModel}".`);
        actualModel = resolvedFallbackModel;
        result = await generateVisionResponse(genAI, resolvedFallbackModel, prompt, base64Image, mimeType);
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
    const metadata = createVisionModelMetadata('single', primaryModel, resolvedFallbackModel, actualModel);

    return withVisionModelMetadata({
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
      visiblePriceRange: normalizeVisiblePriceRange(parsed.visible_price_range),
      stopLoss: normalizeNumeric(parsed.stop_loss),
      takeProfit1: normalizeNumeric(parsed.take_profit_1),
      takeProfit2: normalizeNumeric(parsed.take_profit_2),
      takeProfit3: normalizeNumeric(parsed.take_profit_3),
    }, metadata);
  } catch (error) {
    throw toVisionAnalysisError(error, createVisionModelMetadata('single', primaryModel, resolvedFallbackModel, actualModel));
  }
}

// ============================================
// Dual-Chart HTF Analysis (Higher Timeframe)
// Focus: Market structure, supply/demand zones, premium/discount
// ============================================

export async function analyzeHTFVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string
): Promise<VisionAnalysisResult> {
  if (!config.gemini.apiKey) {
    throw new Error('TradeVision AI is not configured correctly');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const primaryModel = normalizeGeminiModelName(config.gemini.proModel);
  const fallbackModel = normalizeGeminiModelName(config.gemini.freeModel);
  const resolvedFallbackModel = primaryModel !== fallbackModel ? fallbackModel : null;

  const prompt = `You are an elite institutional Smart Money Concepts (SMC) analyst reviewing A HIGHER TIMEFRAME chart.

Your role: Determine the MACRO BIAS and structural context. Think like a hedge fund desk — structure first, everything else follows.

Trading pair/index: ${pair}
Timeframe: ${timeframe} (HIGHER TIMEFRAME — this sets the directional bias)

========================================
YOUR FOCUS FOR THIS HIGHER TIMEFRAME CHART
========================================

1. **Market Structure** — Is price making higher highs/higher lows (bullish) or lower highs/lower lows (bearish)? Identify the MOST RECENT Break of Structure (BOS) or Change of Character (CHoCH).

2. **Supply & Demand Zones** — Mark the KEY institutional supply and demand zones that are most likely to cause a reaction. These are where large orders were placed (order blocks, imbalances, or major structural pivots). Be PRECISE with zone boundaries.

3. **Premium vs Discount** — Relative to the last major impulse leg, is current price in premium (top 50%), discount (bottom 50%), or equilibrium? This is CRITICAL for determining whether to look for buys or sells on the lower timeframe.

4. **Liquidity Pools** — Where are the obvious equal highs/lows or stop-loss clusters that smart money will target? Identify the nearest untouched liquidity pool.

5. **Overall Directional Bias** — What direction should the lower timeframe trader be looking? BUY from discount in bullish structure, SELL from premium in bearish structure.

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
    "description": "Where the nearest untouched liquidity pool sits and what it means for directional bias"
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
    "explanation": "Explain relative to the most recent impulse leg — this determines the LTF trading direction"
  },
  "entry_plan": {
    "bias": "buy | sell | none",
    "entry_type": "none",
    "entry_zone": null,
    "confirmation": "none",
    "reason": "HTF provides bias only — entry is determined by the lower timeframe"
  },
  "risk_management": {
    "invalidation_level": number,
    "invalidation_reason": "The structural level that invalidates the current HTF bias"
  },
  "quality": {
    "setup_rating": "A | B | C | avoid",
    "confidence": 1-100
  },
  "final_verdict": {
    "action": "enter | wait | avoid",
    "message": "Clear directional bias for the lower timeframe trader"
  },
  "stop_loss": null,
  "take_profit_1": null,
  "take_profit_2": null,
  "take_profit_3": null,
  "reasoning": "Concise higher timeframe bias explanation in 2-3 short sentences",
  "visible_price_range": {
    "min": "lowest price on right Y-axis",
    "max": "highest price on right Y-axis"
  }
}

========================================
STRICT RULES
========================================
1. This is the HIGHER TIMEFRAME — do NOT provide entry, SL, or TP levels. Those come from the lower timeframe.
2. Focus on STRUCTURE, ZONES, and BIAS only.
3. Zone boundaries must be TIGHT (0.5-2% of visible price range).
4. Read the Y-axis carefully for visible_price_range.
5. If structure is unclear, setup_rating = "avoid" and bias = "none".
6. Do NOT force a directional bias. If ranging, say ranging.
7. Mark the most significant supply zone (institutional selling area) AND demand zone (institutional buying area).
8. Premium/discount MUST be relative to the last major impulse leg, not the entire visible chart.
9. Keep reasoning concise: 2-3 short sentences, no long paragraph, no repeated points.

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;

  let result;
  let actualModel = primaryModel;

  try {
    try {
      result = await generateVisionResponse(genAI, primaryModel, prompt, base64Image, mimeType);
    } catch (error) {
      if (resolvedFallbackModel && isUnsupportedModelError(error)) {
        actualModel = resolvedFallbackModel;
        result = await generateVisionResponse(genAI, resolvedFallbackModel, prompt, base64Image, mimeType);
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
    const metadata = createVisionModelMetadata('htf', primaryModel, resolvedFallbackModel, actualModel);

    return withVisionModelMetadata({
      trend: normalizeTrend(parsed.trend),
      structure: {
        state: normalizeStructureState(structure?.state),
        bos: normalizeBosOrChoch(structure?.bos),
        choch: normalizeBosOrChoch(structure?.choch),
      },
      liquidity: {
        type: normalizeLiquidityType(liquidity?.type),
        description: normalizeText(liquidity?.description, 'No significant liquidity identified on the higher timeframe.'),
      },
      zones: {
        supply: normalizeQualifiedZone(zones?.supply),
        demand: normalizeQualifiedZone(zones?.demand),
      },
      pricePosition: {
        location: normalizePriceLocation(pricePosition?.location),
        explanation: normalizeText(pricePosition?.explanation, 'Price position relative to the impulse leg could not be determined.'),
      },
      entryPlan: {
        bias: normalizeBias(entryPlan?.bias),
        entryType: 'none',
        entryZone: null,
        confirmation: 'none',
        reason: normalizeText(entryPlan?.reason, 'HTF provides bias only — entry is determined by the lower timeframe.'),
      },
      riskManagement: {
        invalidationLevel: normalizeNumeric(riskManagement?.invalidation_level),
        invalidationReason: normalizeText(riskManagement?.invalidation_reason, 'HTF structural invalidation level.'),
      },
      quality: {
        setupRating: normalizeSetupRating(quality?.setup_rating),
        confidence: normalizeConfidence(quality?.confidence),
      },
      finalVerdict: {
        action: normalizeFinalAction(finalVerdict?.action),
        message: normalizeText(finalVerdict?.message, 'Review the lower timeframe for confirmation.'),
      },
      reasoning: normalizeText(parsed.reasoning, 'Higher timeframe analysis could not determine a clear structure.'),
      visiblePriceRange: normalizeVisiblePriceRange(parsed.visible_price_range),
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,
    }, metadata);
  } catch (error) {
    throw toVisionAnalysisError(error, createVisionModelMetadata('htf', primaryModel, resolvedFallbackModel, actualModel));
  }
}

// ============================================
// Dual-Chart LTF Analysis (Lower Timeframe)
// Focus: Entry, SL, TP, internal zones, liquidity sweeps
// ============================================

export async function analyzeLTFVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string
): Promise<VisionAnalysisResult> {
  if (!config.gemini.apiKey) {
    throw new Error('TradeVision AI is not configured correctly');
  }

  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const primaryModel = normalizeGeminiModelName(config.gemini.proModel);
  const fallbackModel = normalizeGeminiModelName(config.gemini.freeModel);
  const resolvedFallbackModel = primaryModel !== fallbackModel ? fallbackModel : null;

  const prompt = `You are an elite institutional Smart Money Concepts (SMC) execution analyst reviewing A LOWER TIMEFRAME chart.

Your role: Find the PRECISE ENTRY, stop loss, and take profit levels. Think like a prop firm trader executing off the desk's bias — precision is everything.

Trading pair/index: ${pair}
Timeframe: ${timeframe} (LOWER TIMEFRAME — this is where you find the sniper entry)

========================================
YOUR FOCUS FOR THIS LOWER TIMEFRAME CHART
========================================

1. **Internal Structure** — Identify the micro BOS/CHoCH within the lower timeframe. Where has internal structure shifted? This is your entry confirmation.

2. **Liquidity Sweeps** — Has price swept any recent internal highs or lows? A liquidity sweep followed by a structural shift is the highest probability entry.

3. **Order Blocks & Imbalances** — Find the most recent unmitigated order block or fair value gap where price is likely to react. This is your entry zone.

4. **Entry Level** — Provide the EXACT entry zone (min/max). This should be at an internal order block or imbalance AFTER a liquidity sweep and structural confirmation.

5. **Stop Loss** — Place it below/above the most recent structural low/high that would invalidate the entry. Must be logical, not arbitrary.

6. **Take Profit Levels** — TP1 (conservative, nearest internal structure), TP2 (moderate, next key level), TP3 (aggressive, major liquidity pool or HTF zone). Minimum 1:2 Risk:Reward for TP1.

7. **Confirmation Signal** — What specific confirmation do you see or need? CHoCH, BOS, rejection wick, engulfing candle at the order block.

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
    "description": "Describe the liquidity sweep — which highs/lows were taken, and how price reacted after the sweep"
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
    "explanation": "Where price sits relative to the internal structure range"
  },
  "entry_plan": {
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": {
      "min": number | null,
      "max": number | null
    },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Explain the specific price action that justifies this entry — reference the liquidity sweep, order block, and structural shift"
  },
  "risk_management": {
    "invalidation_level": number,
    "invalidation_reason": "The exact structural level that invalidates this entry"
  },
  "quality": {
    "setup_rating": "A | B | C | avoid",
    "confidence": 1-100
  },
  "final_verdict": {
    "action": "enter | wait | avoid",
    "message": "Precise execution instruction — what to do RIGHT NOW"
  },
  "stop_loss": number | null,
  "take_profit_1": number | null,
  "take_profit_2": number | null,
  "take_profit_3": number | null,
  "reasoning": "Concise execution explanation in 2-3 short sentences covering sweep, structure, entry, and risk",
  "visible_price_range": {
    "min": "lowest price on right Y-axis",
    "max": "highest price on right Y-axis"
  }
}

========================================
STRICT RULES
========================================
1. This is the LOWER TIMEFRAME — your job is to find the SNIPER ENTRY with precise SL and TP.
2. Entry MUST be at an internal order block or imbalance, not a random level.
3. A liquidity sweep BEFORE entry increases confidence significantly. If no sweep occurred, note this.
4. SL must be at a structural level that invalidates the trade, NOT an arbitrary distance.
5. TP1 must have at least 1:2 Risk:Reward ratio.
6. Zone boundaries must be TIGHT (the order block body or imbalance range only).
7. If no clean entry exists, action = "wait" and explain what price action you need to see.
8. Read the Y-axis carefully for visible_price_range.
9. DO NOT force an entry. If the lower timeframe doesn't confirm, action = "wait".
10. Keep reasoning concise: 2-3 short sentences max, with no filler or repeated explanation.
10. The entry_plan.reason must specifically reference: what was swept, what shifted, and where the entry sits.

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;

  let result;
  let actualModel = primaryModel;

  try {
    try {
      result = await generateVisionResponse(genAI, primaryModel, prompt, base64Image, mimeType);
    } catch (error) {
      if (resolvedFallbackModel && isUnsupportedModelError(error)) {
        actualModel = resolvedFallbackModel;
        result = await generateVisionResponse(genAI, resolvedFallbackModel, prompt, base64Image, mimeType);
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
    const metadata = createVisionModelMetadata('ltf', primaryModel, resolvedFallbackModel, actualModel);

    return withVisionModelMetadata({
      trend: normalizeTrend(parsed.trend),
      structure: {
        state: normalizeStructureState(structure?.state),
        bos: normalizeBosOrChoch(structure?.bos),
        choch: normalizeBosOrChoch(structure?.choch),
      },
      liquidity: {
        type: normalizeLiquidityType(liquidity?.type),
        description: normalizeText(liquidity?.description, 'No clear liquidity sweep was identified on the lower timeframe.'),
      },
      zones: {
        supply: normalizeQualifiedZone(zones?.supply),
        demand: normalizeQualifiedZone(zones?.demand),
      },
      pricePosition: {
        location: normalizePriceLocation(pricePosition?.location),
        explanation: normalizeText(pricePosition?.explanation, 'Internal price position could not be determined.'),
      },
      entryPlan: {
        bias: normalizeBias(entryPlan?.bias),
        entryType: normalizeEntryType(entryPlan?.entry_type),
        entryZone: normalizeZone(entryPlan?.entry_zone),
        confirmation: normalizeConfirmation(entryPlan?.confirmation),
        reason: normalizeText(entryPlan?.reason, 'No disciplined entry is justified until internal structure confirms.'),
      },
      riskManagement: {
        invalidationLevel: normalizeNumeric(riskManagement?.invalidation_level),
        invalidationReason: normalizeText(riskManagement?.invalidation_reason, 'The setup is invalidated if price breaks the structural level.'),
      },
      quality: {
        setupRating: normalizeSetupRating(quality?.setup_rating),
        confidence: normalizeConfidence(quality?.confidence),
      },
      finalVerdict: {
        action: normalizeFinalAction(finalVerdict?.action),
        message: normalizeText(finalVerdict?.message, 'Wait for internal structure to confirm before entering.'),
      },
      reasoning: normalizeText(parsed.reasoning, 'Lower timeframe does not present a confirmed entry yet.'),
      visiblePriceRange: normalizeVisiblePriceRange(parsed.visible_price_range),
      stopLoss: normalizeNumeric(parsed.stop_loss),
      takeProfit1: normalizeNumeric(parsed.take_profit_1),
      takeProfit2: normalizeNumeric(parsed.take_profit_2),
      takeProfit3: normalizeNumeric(parsed.take_profit_3),
    }, metadata);
  } catch (error) {
    throw toVisionAnalysisError(error, createVisionModelMetadata('ltf', primaryModel, resolvedFallbackModel, actualModel));
  }
}
