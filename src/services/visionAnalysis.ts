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
- Treat equal highs and equal lows as liquidity pools when relevant.
- Distinguish inducement from the main or external liquidity objective.
- Separate external structure from internal structure.
- Prioritize the best structure-aligned zone among order blocks, breaker blocks, mitigation blocks, and fair value gaps.
- Judge premium, discount, and equilibrium from the active dealing range / impulse leg controlling current price.`;

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
9. Zone min and max must be tight.
10. Read the visible price range directly from the right-side Y-axis.`;

  const freeGoal = `
========================================
GOAL
========================================

Provide a useful overview of the chart's market structure and key levels.
Keep reasoning concise in 2-3 short sentences.
Do not include stop loss or take profit levels.

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

  const proPrompt = `You are an elite multi-strategy trading analyst.

You are given ONE chart image for timeframe ${timeframe} on ${pair}.

If only one chart is uploaded, analyze ONLY the uploaded timeframe and choose the cleanest single strategy setup from that timeframe.

${advancedSmcGuidance}

================================
STEP 1 - MARKET ANALYSIS
================================

Using ONLY the uploaded chart (${timeframe}):
- Identify market condition: trending, ranging, breakout, or consolidation
- Determine directional bias: ONE ONLY, bullish or bearish, when structure supports it
- Identify key areas: supply and demand zones, premium/discount zones, and major liquidity pools

================================
STEP 2 - PRIMARY STRATEGY SELECTION
================================

Select ONE primary strategy based on the chart condition:
- SMC
- Supply & Demand
- S&R
- Pattern

Do NOT mix strategies.

================================
STEP 3 - ENTRY ANALYSIS
================================

- Entry must come from a valid POI
- A valid trade must include at least 2 confirmations
- Confirmations can include liquidity sweep, CHoCH, BOS, FVG, rejection, or clear pattern confirmation

================================
STEP 4 - EXECUTION RULES
================================

- Prefer LIMIT entries over market entries
- Minimum risk-to-reward = 1:2 for take_profit_1
- Do NOT force trades

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
  "risk_management": {
    "invalidation_level": number | null,
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
- Do NOT force trades
- If no strong setup exists, return a no-trade outcome using wait or avoid
- Be concise and structured
- Read the Y-axis carefully for visible_price_range
- Supply and demand zones must be tight and justified

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
// Focus: Market structure, supply/demand zones, premium/discount
// ============================================

export async function analyzeHTFVisionStructure(
  base64Image: string,
  mimeType: string,
  pair: string,
  timeframe: string
): Promise<VisionAnalysisResult> {
  const prompt = `You are an elite multi-strategy trading analyst.

You are given TWO chart images:
- Image 1 = HIGHER TIMEFRAME (HTF): ${timeframe}
- Image 2 = LOWER TIMEFRAME (LTF): provided separately

You MUST strictly follow a top-down approach:
HTF defines bias and key zones.
LTF is ONLY used for entry execution.

Do NOT mix roles.

Using ONLY Image 1 (${timeframe}) on ${pair}:

================================
STEP 1 - HTF MARKET ANALYSIS
================================

1. Identify market condition:
- Trending (bullish or bearish)
- Ranging
- Breakout or consolidation

2. Determine directional bias:
- ONE ONLY: bullish or bearish

3. Identify key areas:
- Supply and demand zones
- Premium and discount zones
- Major liquidity pools:
  - equal highs/lows
  - previous highs/lows

================================
STEP 2 - PRIMARY STRATEGY SELECTION
================================

Select ONE primary strategy based on HTF condition:
- SMC
- Supply & Demand
- S&R
- Pattern

Do NOT mix strategies.

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
  "risk_management": {
    "invalidation_level": number | null,
    "invalidation_reason": "The HTF level that breaks the bias"
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
  const prompt = `You are an elite multi-strategy trading analyst.

You are given TWO chart images:
- Image 1 = HIGHER TIMEFRAME (HTF): ${context.higherTimeframe}
- Image 2 = LOWER TIMEFRAME (LTF): ${timeframe}

You MUST strictly follow a top-down approach:
HTF defines bias and key zones.
LTF is ONLY used for entry execution.

Do NOT mix roles.

Chart context:
- Trading pair/index: ${pair}
- Higher timeframe directional bias: ${context.higherTimeframeBias}
- Higher timeframe supply zone: ${formatZoneRange(context.higherTimeframeSupplyZone)}
- Higher timeframe demand zone: ${formatZoneRange(context.higherTimeframeDemandZone)}
- Higher timeframe price position: ${context.higherTimeframePricePosition}

${advancedSmcGuidance}

================================
STEP 3 - LTF ENTRY ANALYSIS
================================

Using ONLY Image 2 (${timeframe}):
- ONLY look for trades in HTF bias direction
- Price MUST be at or near an HTF key zone (POI)
- Identify liquidity sweep
- Identify CHoCH or BOS confirmation
- Identify FVG and pattern confirmation if applicable

================================
STEP 4 - CONFIRMATION SYSTEM
================================

A valid trade MUST include at least 2 confirmations.
If confirmations are weak, return no valid trade setup.

================================
STEP 5 - TRADE EXECUTION RULES
================================

- Prefer LIMIT entries over market entries
- Entry must be at POI
- Minimum risk-to-reward = 1:2
- Do NOT force trades

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
  "risk_management": {
    "invalidation_level": number | null,
    "invalidation_reason": "The exact structural level that invalidates this entry"
  },
  "quality": {
    "setup_rating": "A | B | C | avoid",
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
- Do NOT give trades without confirmations
- If no strong setup exists, return wait or avoid
- Be concise and structured
- The entry_plan.reason must mention POI and confirmations

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;

  try {
    const { parsed, metadata } = await executeVisionJsonGeneration('ltf', 'PRO', prompt, base64Image, mimeType);
    const structure = parsed.structure as Record<string, unknown> | undefined;
    const liquidity = parsed.liquidity as Record<string, unknown> | undefined;
    const zones = parsed.zones as Record<string, unknown> | undefined;
    const pricePosition = parsed.price_position as Record<string, unknown> | undefined;
    const entryPlan = parsed.entry_plan as Record<string, unknown> | undefined;
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
