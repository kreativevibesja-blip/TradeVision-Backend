import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { getSystemSetting, type SubscriptionTier } from '../lib/supabase';

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

export interface SMCCounterTrendPlan {
  action: 'enter' | 'wait' | 'avoid';
  bias: 'buy' | 'sell' | 'none';
  entryType: 'instant' | 'confirmation' | 'none';
  entryZone: SMCZone | null;
  confirmation: 'CHoCH' | 'BOS' | 'rejection' | 'none';
  reason: string;
  warning: string;
  invalidationLevel: number | null;
  invalidationReason: string;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  confidence: number;
}

export interface SMCRiskManagement {
  invalidationLevel: number | null;
  invalidationReason: string;
}

export interface SMCQuality {
  setupRating: 'A+' | 'B' | 'avoid';
  confidence: number;
}

export interface SMCFinalVerdict {
  action: 'enter' | 'wait' | 'avoid';
  message: string;
}

export type MarketCondition = 'trending' | 'ranging' | 'breakout' | 'consolidation';
export type PrimaryStrategy = 'SMC' | 'Supply & Demand' | 'S&R' | 'Pattern';

export interface VisionAnalysisResult {
  trend: 'bullish' | 'bearish' | 'ranging';
  marketCondition?: MarketCondition;
  primaryStrategy?: PrimaryStrategy | null;
  confirmations?: string[];
  structure: SMCStructure;
  liquidity: SMCLiquidity;
  zones: SMCZones;
  pricePosition: SMCPricePosition;
  entryPlan: SMCEntryPlan;
  counterTrendPlan?: SMCCounterTrendPlan | null;
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

type VisionProvider = 'gemini' | 'openai';

export interface VisionModelMetadata {
  provider: VisionProvider;
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

const normalizeCounterTrendPlan = (value: unknown): SMCCounterTrendPlan | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const action = normalizeFinalAction(record.action);
  const bias = normalizeBias(record.bias);
  const entryType = normalizeEntryType(record.entry_type);
  const entryZone = normalizeZone(record.entry_zone);
  const confirmation = normalizeConfirmation(record.confirmation);

  if (bias === 'none' && action !== 'enter' && entryType === 'none' && !entryZone) {
    return null;
  }

  return {
    action,
    bias,
    entryType,
    entryZone,
    confirmation,
    reason: normalizeText(record.reason, 'No clean counter-trend setup is justified against the primary trend right now.'),
    warning: normalizeText(record.warning, 'Counter-trend trades are aggressive, lower probability, and should be managed faster than the main trend setup.'),
    invalidationLevel: normalizeNumeric(record.invalidation_level),
    invalidationReason: normalizeText(record.invalidation_reason, 'The counter-trend idea fails if price breaks the rejection structure supporting it.'),
    stopLoss: normalizeNumeric(record.stop_loss),
    takeProfit1: normalizeNumeric(record.take_profit_1),
    takeProfit2: normalizeNumeric(record.take_profit_2),
    takeProfit3: normalizeNumeric(record.take_profit_3),
    confidence: normalizeConfidence(record.confidence),
  };
};

const normalizeSetupRating = (value: unknown): SMCQuality['setupRating'] => {
  if (typeof value !== 'string') {
    return 'avoid';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'A+' || normalized === 'B') {
    return normalized;
  }
  if (normalized === 'A') {
    return 'A+';
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

const normalizeMarketCondition = (value: unknown): MarketCondition => {
  if (typeof value !== 'string') {
    return 'ranging';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'trending' || normalized === 'ranging' || normalized === 'breakout' || normalized === 'consolidation') {
    return normalized;
  }

  return 'ranging';
};

const normalizePrimaryStrategy = (value: unknown): PrimaryStrategy | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'smc') {
    return 'SMC';
  }
  if (normalized === 'supply & demand' || normalized === 'supply and demand' || normalized === 'supply/demand') {
    return 'Supply & Demand';
  }
  if (normalized === 's&r' || normalized === 'support & resistance' || normalized === 'support and resistance') {
    return 'S&R';
  }
  if (normalized === 'pattern' || normalized === 'chart pattern') {
    return 'Pattern';
  }

  return null;
};

const normalizeConfirmations = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
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

const normalizeOpenAiModelName = (modelName: string) => modelName.trim();

const getGeminiModelForSubscription = (subscription: SubscriptionTier) =>
  normalizeGeminiModelName(subscription === 'PRO' ? config.gemini.proModel : config.gemini.freeModel);

const getOpenAiModelForSubscription = (subscription: SubscriptionTier) =>
  normalizeOpenAiModelName(subscription === 'PRO' ? config.openai.proModel : config.openai.freeModel);

const parseBooleanSetting = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return fallback;
};

interface VisionProviderCandidate {
  provider: VisionProvider;
  modelName: string;
}

const getProviderSettingKey = (provider: VisionProvider, subscription: SubscriptionTier) =>
  `ai_model_${provider}_${subscription.toLowerCase()}_enabled`;

const getVisionProviderCandidates = async (subscription: SubscriptionTier): Promise<VisionProviderCandidate[]> => {
  const [geminiSetting, openAiSetting] = await Promise.all([
    getSystemSetting(getProviderSettingKey('gemini', subscription)),
    getSystemSetting(getProviderSettingKey('openai', subscription)),
  ]);

  const geminiEnabled = parseBooleanSetting(geminiSetting?.value, true);
  const openAiEnabled = parseBooleanSetting(openAiSetting?.value, false);
  const candidates: VisionProviderCandidate[] = [];

  if (geminiEnabled && config.gemini.apiKey.trim()) {
    candidates.push({ provider: 'gemini', modelName: getGeminiModelForSubscription(subscription) });
  }

  if (openAiEnabled && config.openai.apiKey.trim()) {
    candidates.push({ provider: 'openai', modelName: getOpenAiModelForSubscription(subscription) });
  }

  if (!candidates.length) {
    throw new Error(`No AI providers are enabled or configured for the ${subscription} plan`);
  }

  return candidates;
};

interface LTFPromptContext {
  higherTimeframe: string;
  higherTimeframeBias: 'bullish' | 'bearish' | 'ranging';
  higherTimeframeSupplyZone: SMCQualifiedZone | null;
  higherTimeframeDemandZone: SMCQualifiedZone | null;
  higherTimeframePricePosition: SMCPricePosition['location'];
}

const formatZoneRange = (zone: SMCQualifiedZone | null) => {
  if (!zone || zone.min === null || zone.max === null) {
    return 'none identified';
  }

  return `${zone.min} - ${zone.max} (${zone.reason})`;
};

const advancedSmcGuidance = `
ADVANCED SMC CONCEPTS YOU MUST APPLY WHEN CLEARLY VISIBLE
- Start with higher-timeframe or broader visible structure before thinking about entries.
- If the broader chart shows lower highs and lower lows, default to bearish context unless price clearly invalidates that structure.
- If the broader chart shows higher highs and higher lows, default to bullish context unless price clearly invalidates that structure.
- Identify external highs and lows, protected highs and lows, and the liquidity resting around them.
- Respect protected highs/lows: the trade idea remains valid until that protected swing is actually broken.
- Treat BOS and CHoCH as valid only when price closes through structure, not when a wick briefly pokes through.
- A strong model setup often looks like: structure break, liquidity sweep or inducement, return into a clean POI such as an order block or FVG, then continuation in the dominant direction.
- Treat an order block retest after displacement or BOS as stronger than a random touch of a zone.
- If liquidity or IDM is swept and price sharply reclaims or rejects from the POI, that increases setup quality.
- Treat equal highs and equal lows as liquidity pools when relevant.
- Distinguish inducement from the main or external liquidity objective.
- Separate external structure from internal structure.
- Use the active dealing range to judge premium, discount, and equilibrium, with the 50% area as the core divider and OTE as the preferred retracement location.
- In bearish conditions, shorts should come from premium/OTE, not discount; in bullish conditions, longs should come from discount/OTE, not premium.
- Prioritize the best structure-aligned zone among order blocks, breaker blocks, mitigation blocks, and fair value gaps.
- Give extra weight when higher-timeframe and lower-timeframe FVGs overlap or sit inside the same POI.
- Treat fair value gaps as areas of interest, not blind entry signals, and require confluence with structure and location.
- Pre-plan targets at prior highs/lows, equal highs/lows, and obvious liquidity pools before approving an entry.
- Target 1 should usually be the nearest logical structure target; Target 2 should usually be the next deeper liquidity objective if continuation is likely.
- Stops must sit at structural invalidation, not at arbitrary distances.`;

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

const generateOpenAiVisionResponse = async (
  modelName: string,
  prompt: string,
  base64Image: string,
  mimeType: string
) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: modelName,
      response_format: { type: 'json_object' },
      max_completion_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => null) as any;

  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed with status ${response.status}`);
  }

  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === 'string' && content.trim()) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .filter((item) => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
      .trim();

    if (text) {
      return text;
    }
  }

  throw new Error('OpenAI did not return a valid text completion');
};

const createVisionModelMetadata = (
  mode: VisionModelMetadata['mode'],
  primaryModel: string,
  fallbackModel: string | null,
  actualModel: string,
  provider: VisionProvider
): VisionModelMetadata => ({
  provider,
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

const executeVisionJsonGeneration = async (
  mode: VisionModelMetadata['mode'],
  subscription: SubscriptionTier,
  prompt: string,
  base64Image: string,
  mimeType: string
) => {
  const candidates = await getVisionProviderCandidates(subscription);
  const primaryModel = candidates[0].modelName;
  const fallbackModel = candidates[1]?.modelName ?? null;
  let lastError: unknown = null;
  let lastCandidate = candidates[0];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    try {
      const responseText = candidate.provider === 'gemini'
        ? await generateVisionResponse(new GoogleGenerativeAI(config.gemini.apiKey), candidate.modelName, prompt, base64Image, mimeType).then((result) => result.response.text())
        : await generateOpenAiVisionResponse(candidate.modelName, prompt, base64Image, mimeType);

      return {
        parsed: parseJsonObject(responseText),
        metadata: createVisionModelMetadata(mode, primaryModel, fallbackModel, candidate.modelName, candidate.provider),
      };
    } catch (error) {
      lastError = error;
      lastCandidate = candidate;

      const nextCandidate = candidates[index + 1];
      if (nextCandidate) {
        console.warn(
          `[visionAnalysis] ${candidate.provider} model "${candidate.modelName}" failed for ${mode}. Falling back to ${nextCandidate.provider} "${nextCandidate.modelName}".`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  throw toVisionAnalysisError(
    lastError,
    createVisionModelMetadata(mode, primaryModel, fallbackModel, lastCandidate.modelName, lastCandidate.provider)
  );
};

export async function analyzeVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string,
  subscription: SubscriptionTier
): Promise<VisionAnalysisResult> {
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
  "counter_trend_plan": {
    "action": "enter | wait | avoid",
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": { "min": number | null, "max": number | null },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Brief reason for the aggressive counter-trend idea",
    "warning": "Explicit warning that this setup is aggressive and lower probability",
    "invalidation_level": number | null,
    "invalidation_reason": "What breaks the counter-trend idea",
    "stop_loss": number | null,
    "take_profit_1": number | null,
    "take_profit_2": number | null,
    "take_profit_3": number | null,
    "confidence": 1-100
  },
  "risk_management": {
    "invalidation_level": number,
    "invalidation_reason": "What breaks the setup"
  },
  "quality": {
    "setup_rating": "A+ | B | avoid",
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

  const freeRules = `
========================================
STRICT RULES (DO NOT BREAK)
========================================

1. DO NOT force trades.
2. If no clear setup exists, action MUST be "wait" or "avoid".
3. Mention equal highs or equal lows when clearly relevant.
4. Distinguish inducement from the main liquidity target when visible.
5. Justify supply and demand zones.
6. Include an invalidation level.
7. If price is not in a key zone, entry_type MUST be "none".
8. If structure is unclear, setup_rating MUST be "avoid".
9. setup_rating must be "A+" for strong confluence, "B" for weaker but valid structure, otherwise "avoid".
10. Zone min and max must be tight.
11. BOS and CHoCH require a real candle close through structure, not a wick.
12. Use structural invalidation, not arbitrary stop placement.
13. Read the visible price range directly from the right-side Y-axis.`;

  const freeGoal = `
========================================
GOAL
========================================

Provide a useful overview of the chart's market structure and key levels.
Keep reasoning concise in 2-3 short sentences.
Do not include stop loss or take profit levels.

You may also include an optional counter_trend_plan object only when a clean aggressive support/resistance rejection setup exists against the main trend.
If used, it must include: action, bias, entry_type, entry_zone, confirmation, reason, warning, invalidation_level, invalidation_reason, stop_loss, take_profit_1, take_profit_2, take_profit_3, confidence.
The warning must explicitly say the setup is aggressive, lower probability, and should be managed quickly.

Return STRICT JSON ONLY.
Do not use markdown.
Do not add commentary outside the JSON.`;

  const freePromptHeader = `You are an institutional-level Smart Money Concepts (SMC) trading analyst.

Your job is to analyze the provided chart like a professional trader, not a signal generator.

You MUST think in terms of:
- Market structure
- Liquidity
- Order flow
- Premium vs Discount
- Confirmation-based entries

${advancedSmcGuidance}

Trading pair/index: ${pair}
Timeframe: ${timeframe}`;

  const proPrompt = `You are an advanced trading analyst.

Your job is NOT to find trades, but to FILTER OUT low-probability setups and only return high-quality opportunities.

You are given ONE chart image for timeframe ${timeframe} on ${pair}.

If only one chart is uploaded, analyze ONLY the uploaded timeframe and choose the cleanest single strategy setup from that timeframe.

${advancedSmcGuidance}

Use multi-strategy confluence including:
- Market structure (HH, HL, LH, LL)
- Supply & Demand
- Fair Value Gaps (FVG)
- Liquidity (equal highs/lows, stop hunts)
- Momentum / displacement
- Price behavior inside zones

COUNTER-TREND RULES
- The main trend-following plan remains the priority.
- You may include ONE secondary counter_trend_plan only if price is reacting at a clear support/resistance area against the main trend.
- Counter-trend ideas must rely on rejection and/or engulfing-style reaction and should preferably wait for confirmation rather than blindly enter.
- Counter-trend exits must be conservative and based on the nearest realistic reaction levels, not on full trend reversal assumptions.
- If no clean counter-trend setup exists, omit it or set bias to none and action to avoid.

================================
STEP 1 - DETERMINE CONTEXT FIRST
================================

Using ONLY the uploaded chart (${timeframe}):
- Identify current market condition: bullish trend, bearish trend, or range / consolidation
- Identify recent structure: higher highs / higher lows OR lower highs / lower lows
- Mark the most relevant external highs/lows or protected swing points visible on the chart
- Determine directional bias: ONE ONLY, bullish or bearish, when structure supports it
- If market is ranging, consolidating, or unclear, you MUST return a no-trade outcome
- Identify key areas: support/resistance zones, premium/discount zones, and major liquidity pools
- State whether the current price is approaching a premium short area or a discount long area, or neither

================================
STEP 2 - REQUIRE STRUCTURE CONFIRMATION
================================

- A break of structure or change of character is only valid when a candle CLOSES through structure
- Do not treat a wick through structure as confirmed BOS or CHoCH
- If direction is not confirmed by structure, return wait or avoid
- If the chart resembles a protected-high/protected-low situation, keep that structure in mind when choosing invalidation

================================
STEP 3 - DEFINE LOCATION
================================

- Detect supply zones, demand zones, and fair value gaps
- Classify zone quality internally as fresh, lightly mitigated, or heavily mitigated
- Ignore zones that are heavily mitigated or tapped multiple times
- Use the active dealing range to classify price as premium, discount, or equilibrium
- Prefer trades from OTE-like retracement areas inside premium/discount, not from random mid-range price
- If multiple FVGs from different visible structures/timeframes align in the same area, treat that overlap as stronger confluence
- If an order block, liquidity sweep, and FVG overlap in the same POI, treat that as premium confluence

================================
STEP 4 - FILTER BAD CONDITIONS
================================

- Do NOT allow a trade if price is consolidating inside the zone
- Do NOT allow a trade if multiple wicks appear inside the zone
- Do NOT allow a trade if there is no strong rejection or displacement
- Do NOT allow a trade if the zone has been tapped multiple times
- Do NOT allow a trade if structure is conflicting or direction is unclear
- Do NOT allow a trade if price has not interacted with a meaningful POI or liquidity-backed area of interest
- If any invalid condition exists, return a no-trade outcome

================================
STEP 5 - PRIMARY STRATEGY SELECTION
================================

Select ONE primary strategy based on the cleanest chart condition:
- SMC
- Supply & Demand
- S&R
- Pattern

Do NOT mix strategies.

================================
STEP 6 - CONFIRMATION LOGIC
================================

- Only consider a trade if ALL are true:
  - Zone is fresh or lightly mitigated
  - Price enters the zone and shows strong rejection OR clear displacement
  - Market structure aligns with direction
  - Momentum confirms direction
- A simple engulfing candle is NOT enough
- Require a clear momentum shift, displacement, or BOS/CHoCH confirmed by candle close
- Entry must come from a valid POI
- A valid trade must include at least 2 confirmations
- Confirmations can include liquidity sweep, CHoCH, BOS, FVG, rejection, or clear pattern confirmation
- Prefer setups where price returns into an OTE/premium-discount area and then confirms with a close-based CHoCH or BOS
- Ideal A+ setups usually combine at least 3 of these: liquidity sweep/IDM, order block or FVG retest, close-confirmed CHoCH/BOS, correct premium-discount location, and clean target path

================================
STEP 7 - EXECUTION RULES
================================

- Prefer LIMIT entries over market entries
- Stop loss must sit at the structural invalidation level that proves the idea wrong
- Plan targets at prior highs/lows, equal highs/lows, and obvious liquidity pools before approving the trade
- Minimum risk-to-reward = 1:3 for take_profit_1
- Do NOT force trades
- If the setup is not clear, clean, and high probability, return NO TRADE
- You are a filter, not a signal generator
- When two logical targets exist, take_profit_1 should map to the first clear structure target and take_profit_2 to the next obvious liquidity target
- Entry should preferably come from a return into the order block/FVG rather than chasing the displacement candle

========================================
OUTPUT FORMAT (STRICT JSON ONLY)
========================================
{
  "market_condition": "trending | ranging | breakout | consolidation",
  "primary_strategy": "SMC | Supply & Demand | S&R | Pattern",
  "confirmations": ["max 3 short bullet points"],
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
    "explanation": "Explain relative to the active impulse/dealing range"
  },
  "entry_plan": {
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": {
      "min": number | null,
      "max": number | null
    },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Explain the POI, the confirmations, and why the trade is valid"
  },
  "counter_trend_plan": {
    "action": "enter | wait | avoid",
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": { "min": number | null, "max": number | null },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Explain the support/resistance rejection logic behind the aggressive counter-trend idea",
    "warning": "Explicit warning that this counter-trend setup is aggressive and lower probability",
    "invalidation_level": number | null,
    "invalidation_reason": "Explain what breaks the counter-trend idea",
    "stop_loss": number | null,
    "take_profit_1": number | null,
    "take_profit_2": number | null,
    "take_profit_3": number | null,
    "confidence": 1-100
  },
  "risk_management": {
    "invalidation_level": number | null,
    "invalidation_reason": "Explain what breaks the setup"
  },
  "quality": {
    "setup_rating": "A+ | B | avoid",
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
  "reasoning": "Concise explanation in 2-4 short sentences",
  "visible_price_range": {
    "min": "lowest price number visible on the right-side Y-axis",
    "max": "highest price number visible on the right-side Y-axis"
  }
}

================================
STRICT RULES
================================

- Do NOT use multiple primary strategies
- Do NOT give trades without at least 2 confirmations
- Do NOT give trades when the market is ranging, consolidating, or structurally unclear
- Do NOT use heavily mitigated or multi-tapped zones as the main entry zone
- Do NOT approve setups with weak zone behavior, internal chop, or repeated wicks inside the zone
- Do NOT accept an engulfing candle alone as confirmation
- Do NOT validate BOS or CHoCH from wick-only breaks
- Do NOT force trades
- If no strong setup exists, return a no-trade outcome using wait or avoid with bias = none
- setup_rating must be A+ for strong confluence, B for valid but weaker confirmation, otherwise avoid
- Be concise and structured
- Read the Y-axis carefully for visible_price_range
- Supply and demand zones must be tight and justified
- stop_loss must align with structural invalidation, not a random distance
- take_profit_1 should only be set when at least 3R is realistically available to a logical target
- If price is in the wrong half of the dealing range for the intended direction, bias should usually be none and action should usually be wait or avoid
- setup_rating should only be A+ when the setup resembles a clean textbook entry model with structure, location, liquidity, and execution all aligned
- counter_trend_plan, when present, must be clearly warned as aggressive and should target nearer exits than the main trend setup

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;

  const prompt = subscription === 'PRO'
    ? proPrompt
    : `${freePromptHeader}\n\n========================================\nOUTPUT FORMAT (STRICT JSON ONLY)\n========================================\n${freeJsonSchema}\n${freeRules}\n${freeGoal}`;

  try {
    const { parsed, metadata } = await executeVisionJsonGeneration('single', subscription, prompt, base64Image, mimeType);
    const structure = parsed.structure as Record<string, unknown> | undefined;
    const liquidity = parsed.liquidity as Record<string, unknown> | undefined;
    const zones = parsed.zones as Record<string, unknown> | undefined;
    const pricePosition = parsed.price_position as Record<string, unknown> | undefined;
    const entryPlan = parsed.entry_plan as Record<string, unknown> | undefined;
    const counterTrendPlan = normalizeCounterTrendPlan(parsed.counter_trend_plan);
    const riskManagement = parsed.risk_management as Record<string, unknown> | undefined;
    const quality = parsed.quality as Record<string, unknown> | undefined;
    const finalVerdict = parsed.final_verdict as Record<string, unknown> | undefined;

    return withVisionModelMetadata({
      trend: normalizeTrend(parsed.trend),
      marketCondition: normalizeMarketCondition(parsed.market_condition),
      primaryStrategy: normalizePrimaryStrategy(parsed.primary_strategy),
      confirmations: normalizeConfirmations(parsed.confirmations),
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
      counterTrendPlan,
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
    throw error;
  }
}

// ============================================
// Dual-Chart HTF Analysis (Higher Timeframe)
// Focus: structure, external liquidity, support/resistance zones, premium/discount
// ============================================

export async function analyzeHTFVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string
): Promise<VisionAnalysisResult> {
  const prompt = `You are an advanced trading analyst.

Your job is NOT to find trades, but to FILTER OUT low-probability setups and only return high-quality opportunities.

You are given TWO chart images:
- Image 1 = HIGHER TIMEFRAME (HTF): ${timeframe}
- Image 2 = LOWER TIMEFRAME (LTF): provided separately

You MUST strictly follow a top-down approach:
HTF defines bias and key zones.
LTF is ONLY used for entry execution.

Higher timeframe determines bias.
Lower timeframe is ONLY for entry precision.

Do NOT mix roles.

Using ONLY Image 1 (${timeframe}) on ${pair}:

================================
STEP 1 - DETERMINE CONTEXT
================================

1. Identify current market condition:
- Bullish trend
- Bearish trend
- Range / consolidation

2. Identify recent structure:
- Higher highs / higher lows OR
- Lower highs / lower lows

3. If market is ranging or unclear:
- Return a no-trade or non-actionable bias outcome

4. Identify key areas:
- Supply and demand zones
- Premium and discount zones
- Major liquidity pools:
  - equal highs/lows
  - previous highs/lows

5. Mark the most relevant external highs/lows and protected structure

6. BOS or CHoCH is only valid when a candle closes through structure, not when a wick only sweeps it

7. Note whether the current price is in premium or discount relative to the active dealing range and whether that location supports the HTF bias

================================
STEP 2 - IDENTIFY ZONES, BUT DO NOT TRUST THEM YET
================================

- Detect supply zones, demand zones, and fair value gaps
- Ignore heavily mitigated or multi-tapped zones
- Prefer zones that align with the active dealing range and the most meaningful external liquidity
- Give extra weight to zones/FVGs that would support an eventual OTE-style retracement entry on the lower timeframe
- Give extra weight to order blocks that caused displacement or a clear structural shift

================================
STEP 3 - PRIMARY STRATEGY SELECTION
================================

Select ONE primary strategy based on HTF condition:
- SMC
- Supply & Demand
- S&R
- Pattern

Do NOT mix strategies.

If you mention a counter_trend_plan on HTF, it must default to avoid/none because HTF alone does not execute aggressive counter-trend entries.

========================================
OUTPUT FORMAT (STRICT JSON ONLY)
========================================
{
  "market_condition": "trending | ranging | breakout | consolidation",
  "primary_strategy": "SMC | Supply & Demand | S&R | Pattern",
  "confirmations": [],
  "trend": "bullish | bearish | ranging",
  "structure": {
    "state": "higher highs | lower lows | transition",
    "bos": "bullish | bearish | none",
    "choch": "bullish | bearish | none"
  },
  "liquidity": {
    "type": "buy-side | sell-side | none",
    "description": "Describe the main HTF liquidity pool and directional implication"
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
    "explanation": "Explain relative to the active dealing range"
  },
  "entry_plan": {
    "bias": "buy | sell | none",
    "entry_type": "none",
    "entry_zone": null,
    "confirmation": "none",
    "reason": "HTF defines bias and POIs only"
  },
  "counter_trend_plan": {
    "action": "avoid",
    "bias": "none",
    "entry_type": "none",
    "entry_zone": null,
    "confirmation": "none",
    "reason": "HTF does not execute counter-trend trades on its own",
    "warning": "Counter-trend execution should be judged on the lower timeframe only",
    "invalidation_level": null,
    "invalidation_reason": "none",
    "stop_loss": null,
    "take_profit_1": null,
    "take_profit_2": null,
    "take_profit_3": null,
    "confidence": 0
  },
  "risk_management": {
    "invalidation_level": number | null,
    "invalidation_reason": "The HTF level that breaks the bias"
  },
  "quality": {
    "setup_rating": "A+ | B | avoid",
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
  "reasoning": "Concise higher timeframe explanation in 2-3 short sentences",
  "visible_price_range": {
    "min": "lowest price on right Y-axis",
    "max": "highest price on right Y-axis"
  }
}

STRICT RULES:
- Do NOT mix HTF and LTF roles
- Do NOT use multiple primary strategies
- Do NOT force a trade from HTF alone
- If HTF is ranging, consolidating, or unclear, bias should not be actionable
- Ignore heavily mitigated or repeatedly tapped HTF zones
- Do NOT validate BOS or CHoCH from wick-only breaks
- setup_rating must be A+ for very clean context, B for usable but weaker context, otherwise avoid
- Keep reasoning concise and structured
- Read the Y-axis carefully

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;

  try {
    const { parsed, metadata } = await executeVisionJsonGeneration('htf', 'PRO', prompt, base64Image, mimeType);
    const structure = parsed.structure as Record<string, unknown> | undefined;
    const liquidity = parsed.liquidity as Record<string, unknown> | undefined;
    const zones = parsed.zones as Record<string, unknown> | undefined;
    const pricePosition = parsed.price_position as Record<string, unknown> | undefined;
    const entryPlan = parsed.entry_plan as Record<string, unknown> | undefined;
    const counterTrendPlan = normalizeCounterTrendPlan(parsed.counter_trend_plan);
    const riskManagement = parsed.risk_management as Record<string, unknown> | undefined;
    const quality = parsed.quality as Record<string, unknown> | undefined;
    const finalVerdict = parsed.final_verdict as Record<string, unknown> | undefined;

    return withVisionModelMetadata({
      trend: normalizeTrend(parsed.trend),
      marketCondition: normalizeMarketCondition(parsed.market_condition),
      primaryStrategy: normalizePrimaryStrategy(parsed.primary_strategy),
      confirmations: normalizeConfirmations(parsed.confirmations),
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
      counterTrendPlan,
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
    throw error;
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
  timeframe: string,
  context: LTFPromptContext
): Promise<VisionAnalysisResult> {
  const prompt = `You are an advanced trading analyst.

Your job is NOT to find trades, but to FILTER OUT low-probability setups and only return high-quality opportunities.

You are given TWO chart images:
- Image 1 = HIGHER TIMEFRAME (HTF): ${context.higherTimeframe}
- Image 2 = LOWER TIMEFRAME (LTF): ${timeframe}

You MUST strictly follow a top-down approach:
HTF defines bias and key zones.
LTF is ONLY used for entry execution.

Higher timeframe determines bias.
Lower timeframe is ONLY for entry precision.

If lower timeframe contradicts higher timeframe:
DO NOT TRADE.

Do NOT mix roles.

Chart context:
- Trading pair/index: ${pair}
- Higher timeframe directional bias: ${context.higherTimeframeBias}
- Higher timeframe supply zone: ${formatZoneRange(context.higherTimeframeSupplyZone)}
- Higher timeframe demand zone: ${formatZoneRange(context.higherTimeframeDemandZone)}
- Higher timeframe price position: ${context.higherTimeframePricePosition}

${advancedSmcGuidance}

Use multi-strategy confluence including:
- Market structure (HH, HL, LH, LL)
- Supply & Demand
- Fair Value Gaps (FVG)
- Liquidity (equal highs/lows, stop hunts)
- Momentum / displacement
- Price behavior inside zones

COUNTER-TREND RULES
- The main HTF-aligned setup remains the priority.
- You may include ONE counter_trend_plan only when price is reacting sharply from a clear support/resistance area and a lower-timeframe rejection or engulfing-style reversal is plausible.
- Counter-trend ideas must have conservative exits and a clear warning that they are aggressive and lower probability.
- If no clean counter-trend setup exists, omit it or set bias to none and action to avoid.

================================
STEP 1 - DETERMINE CONTEXT
================================

Using ONLY Image 2 (${timeframe}):
- ONLY look for trades in HTF bias direction
- If LTF contradicts HTF bias or structure, return NO TRADE
- Price MUST be at or near an HTF key zone (POI)
- Identify recent structure and whether momentum aligns with HTF bias
- If market is ranging, consolidating, or unclear, return no-trade
- Wait for lower-timeframe confirmation at the POI rather than assuming the first touch is tradable
- Check whether price is also in the correct half of the dealing range for the intended direction before approving the setup

================================
STEP 2 - IDENTIFY ZONES, BUT DO NOT TRUST THEM YET
================================

- Detect supply zones, demand zones, and fair value gaps
- Ignore heavily mitigated or multi-tapped zones
- Prefer internal FVG/order-block/imbalance confluence that sits inside or near the HTF POI
- Give extra weight when an LTF FVG overlaps an HTF or 1h-style FVG in the same entry area
- Give extra weight when the entry forms after liquidity or IDM is taken and price returns into an order block

================================
STEP 3 - FILTER BAD CONDITIONS
================================

- Do NOT allow a trade if price is consolidating inside the zone
- Do NOT allow a trade if multiple wicks appear inside the zone
- Do NOT allow a trade if there is no strong rejection or displacement
- Do NOT allow a trade if the zone has been tapped multiple times
- Do NOT allow a trade if structure is conflicting with HTF direction
- Do NOT allow a trade if BOS or CHoCH is only a wick sweep without a closing break

================================
STEP 4 - CONFIRMATION SYSTEM
================================

- Only consider a trade if ALL are true:
  - Zone is fresh or lightly mitigated
  - Price enters the zone and shows strong rejection OR clear displacement
  - Market structure aligns with HTF direction
  - Momentum confirms direction
- A simple engulfing candle is NOT enough
- Require a clear momentum shift, CHoCH, BOS, or displacement confirmed by candle close
- A valid trade MUST include at least 2 confirmations
- If confirmations are weak, return no valid trade setup
- Prefer a clean close-confirmed LTF CHoCH as the entry trigger after price returns to the POI
- A+ setups on LTF should usually show a textbook sequence: liquidity taken, POI retest, close-confirmed CHoCH/BOS, then clean expansion away from the zone

================================
STEP 5 - TRADE EXECUTION RULES
================================

- Prefer LIMIT entries over market entries
- Entry must be at POI
- Stop loss must be placed at the structural invalidation swing that proves the setup wrong
- Targets must be mapped to prior highs/lows, equal highs/lows, or other obvious liquidity pools before approving entry
- Minimum risk-to-reward = 1:3
- Do NOT force trades
- If the setup is not clear, clean, and high probability, return NO TRADE
- You are a filter, not a signal generator
- When two logical downside or upside targets exist, take_profit_1 should be the nearer structure target and take_profit_2 the next liquidity sweep objective
- Prefer entries from the retest of the POI, not from chasing the impulse candle after confirmation

========================================
OUTPUT FORMAT (STRICT JSON ONLY)
========================================
{
  "market_condition": "trending | ranging | breakout | consolidation",
  "primary_strategy": "SMC | Supply & Demand | S&R | Pattern",
  "confirmations": ["max 3 short bullet points"],
  "trend": "bullish | bearish | ranging",
  "structure": {
    "state": "higher highs | lower lows | transition",
    "bos": "bullish | bearish | none",
    "choch": "bullish | bearish | none"
  },
  "liquidity": {
    "type": "buy-side | sell-side | none",
    "description": "Describe the liquidity sweep and how price reacted after it"
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
    "reason": "Explain the POI, the confirmations, and why the entry is valid"
  },
  "counter_trend_plan": {
    "action": "enter | wait | avoid",
    "bias": "buy | sell | none",
    "entry_type": "instant | confirmation | none",
    "entry_zone": { "min": number | null, "max": number | null },
    "confirmation": "CHoCH | BOS | rejection | none",
    "reason": "Explain the support/resistance rejection logic behind the aggressive counter-trend idea",
    "warning": "Explicit warning that this counter-trend setup is aggressive and lower probability",
    "invalidation_level": number | null,
    "invalidation_reason": "The exact structural level that invalidates the counter-trend idea",
    "stop_loss": number | null,
    "take_profit_1": number | null,
    "take_profit_2": number | null,
    "take_profit_3": number | null,
    "confidence": 1-100
  },
  "risk_management": {
    "invalidation_level": number | null,
    "invalidation_reason": "The exact structural level that invalidates this entry"
  },
  "quality": {
    "setup_rating": "A+ | B | avoid",
    "confidence": 1-100
  },
  "final_verdict": {
    "action": "enter | wait | avoid",
    "message": "Precise execution instruction"
  },
  "stop_loss": number | null,
  "take_profit_1": number | null,
  "take_profit_2": number | null,
  "take_profit_3": number | null,
  "reasoning": "Concise execution explanation in 2-3 short sentences",
  "visible_price_range": {
    "min": "lowest price on right Y-axis",
    "max": "highest price on right Y-axis"
  }
}

STRICT RULES:
- Do NOT mix HTF and LTF roles
- Do NOT give trades against HTF bias
- Do NOT give trades if LTF contradicts HTF bias or structure
- Do NOT give trades without confirmations
- Do NOT use heavily mitigated or repeatedly tapped zones as the entry zone
- Do NOT accept internal consolidation, repeated wicks, or weak rejection as valid zone behavior
- Do NOT accept an engulfing candle alone as confirmation
- Do NOT validate BOS or CHoCH from wick-only breaks
- If no strong setup exists, return wait or avoid with bias = none
- setup_rating must be A+ for strong confluence, B for valid but weaker confirmation, otherwise avoid
- Be concise and structured
- stop_loss must align with structural invalidation and take_profit_1 should only be set when at least 3R is realistic
- The entry_plan.reason must mention POI and confirmations
- counter_trend_plan, when present, must be explicitly warned as aggressive and should use nearer exits than the main trend trade

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;

  try {
    const { parsed, metadata } = await executeVisionJsonGeneration('ltf', 'PRO', prompt, base64Image, mimeType);
    const structure = parsed.structure as Record<string, unknown> | undefined;
    const liquidity = parsed.liquidity as Record<string, unknown> | undefined;
    const zones = parsed.zones as Record<string, unknown> | undefined;
    const pricePosition = parsed.price_position as Record<string, unknown> | undefined;
    const entryPlan = parsed.entry_plan as Record<string, unknown> | undefined;
    const counterTrendPlan = normalizeCounterTrendPlan(parsed.counter_trend_plan);
    const riskManagement = parsed.risk_management as Record<string, unknown> | undefined;
    const quality = parsed.quality as Record<string, unknown> | undefined;
    const finalVerdict = parsed.final_verdict as Record<string, unknown> | undefined;

    return withVisionModelMetadata({
      trend: normalizeTrend(parsed.trend),
      marketCondition: normalizeMarketCondition(parsed.market_condition),
      primaryStrategy: normalizePrimaryStrategy(parsed.primary_strategy),
      confirmations: normalizeConfirmations(parsed.confirmations),
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
      counterTrendPlan,
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
    throw error;
  }
}
