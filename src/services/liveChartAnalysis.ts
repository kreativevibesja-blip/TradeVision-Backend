import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import { getSystemSetting, type SubscriptionTier } from '../lib/supabase';
import type { MarketCandle } from './marketData';
import type { VisionAnalysisResult, VisionModelMetadata } from './visionAnalysis';

type VisionProvider = 'gemini' | 'openai';

interface ProviderCandidate {
  provider: VisionProvider;
  modelName: string;
}

const parseJsonObject = (value: string) => {
  const trimmed = value.trim();
  const fenced = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Live chart analysis did not return valid JSON');
  }

  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
};

const normalizeText = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const normalizeTrend = (value: unknown): VisionAnalysisResult['trend'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'bullish' || normalized === 'bearish' ? normalized : 'ranging';
};

const normalizeStructureState = (value: unknown): VisionAnalysisResult['structure']['state'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'higher highs' || normalized === 'lower lows' ? normalized : 'transition';
};

const normalizeBosOrChoch = (value: unknown): VisionAnalysisResult['structure']['bos'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'bullish' || normalized === 'bearish' ? normalized : 'none';
};

const normalizeLiquidityType = (value: unknown): VisionAnalysisResult['liquidity']['type'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'buy-side' || normalized === 'sell-side' ? normalized : 'none';
};

const normalizeReason = (value: unknown): NonNullable<VisionAnalysisResult['zones']['supply']>['reason'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'order block' || normalized === 'imbalance' ? normalized : 'previous structure';
};

const normalizePriceLocation = (value: unknown): VisionAnalysisResult['pricePosition']['location'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'premium' || normalized === 'discount' ? normalized : 'equilibrium';
};

const normalizeBias = (value: unknown): VisionAnalysisResult['entryPlan']['bias'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'buy' || normalized === 'sell' ? normalized : 'none';
};

const normalizeEntryType = (value: unknown): VisionAnalysisResult['entryPlan']['entryType'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'instant' || normalized === 'confirmation' ? normalized : 'none';
};

const normalizeConfirmation = (value: unknown): VisionAnalysisResult['entryPlan']['confirmation'] => {
  if (typeof value !== 'string') {
    return 'none';
  }

  const trimmed = value.trim();
  if (trimmed === 'CHoCH' || trimmed === 'BOS' || trimmed === 'rejection') {
    return trimmed;
  }

  return 'none';
};

const normalizeSetupRating = (value: unknown): VisionAnalysisResult['quality']['setupRating'] => {
  const trimmed = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (trimmed === 'A+' || trimmed === 'B') {
    return trimmed;
  }
  if (trimmed === 'A') {
    return 'A+';
  }
  return 'avoid';
};

const normalizeConfidence = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(100, Math.round(parsed)));
};

const normalizeFinalAction = (value: unknown): VisionAnalysisResult['finalVerdict']['action'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'enter' || normalized === 'avoid' ? normalized : 'wait';
};

const normalizeMarketCondition = (value: unknown): VisionAnalysisResult['marketCondition'] => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'trending' || normalized === 'ranging' || normalized === 'breakout' || normalized === 'consolidation'
    ? normalized as VisionAnalysisResult['marketCondition']
    : undefined;
};

const normalizePrimaryStrategy = (value: unknown): VisionAnalysisResult['primaryStrategy'] => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === 'SMC' || trimmed === 'Supply & Demand' || trimmed === 'S&R' || trimmed === 'Pattern'
    ? trimmed as VisionAnalysisResult['primaryStrategy']
    : null;
};

const normalizeConfirmations = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 3)
  : [];

const normalizeNumeric = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeZone = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const zone = value as Record<string, unknown>;
  const min = normalizeNumeric(zone.min);
  const max = normalizeNumeric(zone.max);

  if (min === null || max === null) {
    return null;
  }

  return { min, max };
};

const normalizeQualifiedZone = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const zone = value as Record<string, unknown>;
  const min = normalizeNumeric(zone.min);
  const max = normalizeNumeric(zone.max);

  if (min === null || max === null) {
    return null;
  }

  return {
    min,
    max,
    reason: normalizeReason(zone.reason),
  };
};

const normalizeVisiblePriceRange = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const min = normalizeNumeric(record.min);
  const max = normalizeNumeric(record.max);

  if (min === null || max === null) {
    return null;
  }

  return { min, max };
};

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

const getProviderSettingKey = (provider: VisionProvider, subscription: SubscriptionTier) =>
  `ai_model_${provider}_${subscription.toLowerCase()}_enabled`;

const getProviderCandidates = async (subscription: SubscriptionTier): Promise<ProviderCandidate[]> => {
  const [geminiSetting, openAiSetting] = await Promise.all([
    getSystemSetting(getProviderSettingKey('gemini', subscription)),
    getSystemSetting(getProviderSettingKey('openai', subscription)),
  ]);

  const candidates: ProviderCandidate[] = [];
  if (parseBooleanSetting(geminiSetting?.value, true) && config.gemini.apiKey.trim()) {
    candidates.push({ provider: 'gemini', modelName: config.gemini.proModel });
  }
  if (parseBooleanSetting(openAiSetting?.value, false) && config.openai.apiKey.trim()) {
    candidates.push({ provider: 'openai', modelName: config.openai.proModel });
  }

  if (!candidates.length) {
    throw new Error('No AI providers are enabled or configured for Pro live chart analysis');
  }

  return candidates;
};

const createMetadata = (
  primaryModel: string,
  fallbackModel: string | null,
  actualModel: string,
  provider: VisionProvider
): VisionModelMetadata => ({
  provider,
  mode: 'single',
  primaryModel,
  fallbackModel,
  actualModel,
  usedFallback: Boolean(fallbackModel && actualModel === fallbackModel),
});

const generateOpenAiResponse = async (modelName: string, prompt: string) => {
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
      messages: [{ role: 'user', content: prompt }],
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

  throw new Error('OpenAI did not return a valid text completion');
};

const generateGeminiResponse = async (modelName: string, prompt: string) => {
  const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const result = await model.generateContent([{ text: prompt }]);
  return result.response.text();
};

const advancedSmcGuidance = `
ADVANCED SMC CONCEPTS YOU MUST APPLY WHEN CLEARLY VISIBLE
- Start with the broader visible structure before thinking about entries.
- If the broader structure shows lower highs and lower lows, default to bearish context unless that structure is clearly invalidated.
- If the broader structure shows higher highs and higher lows, default to bullish context unless that structure is clearly invalidated.
- Identify external highs and lows, protected swing points, and the liquidity resting around them.
- Respect protected highs/lows: the trade idea remains valid until that protected swing is actually broken.
- Treat BOS and CHoCH as valid only when price closes through structure, not when a wick briefly pokes through.
- Treat equal highs and equal lows as liquidity pools when relevant.
- Distinguish inducement from the main or external liquidity objective.
- Separate external structure from internal structure.
- Use the active dealing range to judge premium, discount, and equilibrium, with the 50% area as the core divider and OTE as the preferred retracement location.
- In bearish conditions, shorts should come from premium/OTE, not discount; in bullish conditions, longs should come from discount/OTE, not premium.
- Prioritize the best structure-aligned zone among order blocks, breaker blocks, mitigation blocks, and fair value gaps.
- Give extra weight when multiple FVGs or imbalances align in the same POI.
- Treat fair value gaps as areas of interest, not blind entry signals, and require confluence with structure and location.
- Pre-plan targets at prior highs/lows, equal highs/lows, and obvious liquidity pools before approving an entry.
- Target 1 should usually be the nearest logical structure target; Target 2 should usually be the next deeper liquidity objective if continuation is likely.
- Stops must sit at structural invalidation, not at arbitrary distances.`;

const buildPrompt = (symbol: string, timeframe: string, candles: MarketCandle[]) => {
  const recentCandles = candles.slice(-120).map((candle) => ({
    t: candle.timestamp,
    o: candle.open,
    h: candle.high,
    l: candle.low,
    c: candle.close,
  }));

  return `You are an advanced trading analyst.

Your job is NOT to find trades, but to FILTER OUT low-probability setups and only return high-quality opportunities.

Analyze this live market dataset for ${symbol} on ${timeframe}.

CRITICAL DATA RULES:
- Use ONLY the provided OHLC candle data.
- Do NOT invent levels outside the candle range.
- All zones, invalidation, entries, and targets must align with the actual OHLC values.
- Do NOT guess unseen chart structure.

${advancedSmcGuidance}

Use multi-strategy confluence including:
- Market structure (HH, HL, LH, LL)
- Supply & Demand
- Fair Value Gaps (FVG)
- Liquidity (equal highs/lows, stop hunts)
- Momentum / displacement
- Price behavior inside zones

================================
STEP 1 - DETERMINE CONTEXT FIRST
================================
- Identify current market condition: bullish trend, bearish trend, or range / consolidation
- Identify recent structure: higher highs / higher lows OR lower highs / lower lows
- Mark the most relevant external highs/lows or protected swing points from the OHLC data
- Determine directional bias: bullish, bearish, or ranging
- If market is ranging, consolidating, or unclear, return a no-trade outcome
- Identify key supply and demand zones from actual OHLC values
- Identify liquidity pools and recent sweeps from the candle data
- State whether current price is approaching a premium short area or a discount long area, or neither

================================
STEP 2 - REQUIRE STRUCTURE CONFIRMATION
================================

- A break of structure or change of character is only valid when a candle CLOSES through structure
- Do not treat a wick through structure as confirmed BOS or CHoCH
- If direction is not confirmed by structure, return wait or avoid
- If the dataset suggests a protected-high/protected-low setup, use that to guide invalidation

================================
STEP 3 - DEFINE LOCATION
================================

- Detect supply zones, demand zones, and fair value gaps
- Ignore heavily mitigated or multi-tapped zones
- Use the active dealing range to classify price as premium, discount, or equilibrium
- Prefer trades from OTE-like retracement areas inside premium/discount, not from random mid-range price
- If multiple FVGs or imbalances align in one area, treat that overlap as stronger confluence

================================
STEP 4 - FILTER BAD CONDITIONS
================================

- Do NOT allow a trade if price is consolidating inside the zone
- Do NOT allow a trade if multiple wicks appear inside the zone
- Do NOT allow a trade if there is no strong rejection or displacement
- Do NOT allow a trade if the zone has been tapped multiple times
- Do NOT allow a trade if structure is conflicting or unclear
- Do NOT allow a trade if price has not interacted with a meaningful POI or liquidity-backed area of interest

================================
STEP 5 - PRIMARY STRATEGY SELECTION
================================
Select ONE primary strategy only:
- SMC
- Supply & Demand
- S&R
- Pattern

================================
STEP 6 - CONFIRMATION LOGIC
================================
- Only consider a trade if ALL are true:
  - Zone is fresh or lightly mitigated
  - Price enters the zone and shows strong rejection OR clear displacement
  - Market structure aligns with direction
  - Momentum confirms direction
- A simple engulfing candle is NOT enough
- Require a clear momentum shift, CHoCH, BOS, or displacement confirmed by candle close
- Entry must come from a valid POI supported by the candle data
- A valid trade must include at least 2 confirmations
- If the setup is weak, return wait or avoid instead of forcing a trade
- Stop loss must sit at the structural invalidation level that proves the idea wrong
- Plan targets at prior highs/lows, equal highs/lows, and obvious liquidity pools before approving the trade
- Minimum risk-to-reward must be 1:3 for take_profit_1
- If the setup is not clear, clean, and high probability, return NO TRADE
- You are a filter, not a signal generator
- Prefer setups where price returns into an OTE/premium-discount area and then confirms with a close-based CHoCH or BOS

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
    "explanation": "Explain relative to the active dealing range"
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
    "min": number,
    "max": number
  }
}

Dataset summary:
- Symbol: ${symbol}
- Timeframe: ${timeframe}
- Candle count: ${recentCandles.length}
- Latest close: ${recentCandles[recentCandles.length - 1]?.c ?? 'N/A'}
- Oldest included candle: ${recentCandles[0]?.t ?? 'N/A'}
- Latest included candle: ${recentCandles[recentCandles.length - 1]?.t ?? 'N/A'}

Candles JSON:
${JSON.stringify(recentCandles)}

STRICT RULES:
- Do NOT give trades when the market is ranging, consolidating, or structurally unclear
- Do NOT use heavily mitigated or repeatedly tapped zones as the main entry zone
- Do NOT approve setups with weak zone behavior, internal chop, or repeated wicks inside the zone
- Do NOT accept an engulfing candle alone as confirmation
- Do NOT validate BOS or CHoCH from wick-only breaks
- setup_rating must be A+ for strong confluence, B for valid but weaker confirmation, otherwise avoid
- If no strong setup exists, return a no-trade outcome using wait or avoid with bias = none
- stop_loss must align with structural invalidation, not a random distance
- take_profit_1 should only be set when at least 3R is realistically available to a logical target
- If price is in the wrong half of the dealing range for the intended direction, bias should usually be none and action should usually be wait or avoid

Return STRICT JSON ONLY. No markdown. No commentary outside JSON.`;
};

export const analyzeLiveChartCandles = async (
  symbol: string,
  timeframe: string,
  candles: MarketCandle[]
): Promise<VisionAnalysisResult> => {
  const prompt = buildPrompt(symbol, timeframe, candles);
  const candidates = await getProviderCandidates('PRO');
  const primaryModel = candidates[0].modelName;
  const fallbackModel = candidates[1]?.modelName ?? null;
  let lastError: unknown = null;
  let lastCandidate = candidates[0];

  for (const candidate of candidates) {
    try {
      const rawText = candidate.provider === 'gemini'
        ? await generateGeminiResponse(candidate.modelName, prompt)
        : await generateOpenAiResponse(candidate.modelName, prompt);

      const parsed = parseJsonObject(rawText);
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
          description: normalizeText(liquidity?.description, 'No clear liquidity event was identified from the recent OHLC data.'),
        },
        zones: {
          supply: normalizeQualifiedZone(zones?.supply),
          demand: normalizeQualifiedZone(zones?.demand),
        },
        pricePosition: {
          location: normalizePriceLocation(pricePosition?.location),
          explanation: normalizeText(pricePosition?.explanation, 'Price position is not clearly in premium or discount relative to the active dealing range.'),
        },
        entryPlan: {
          bias: normalizeBias(entryPlan?.bias),
          entryType: normalizeEntryType(entryPlan?.entry_type),
          entryZone: normalizeZone(entryPlan?.entry_zone),
          confirmation: normalizeConfirmation(entryPlan?.confirmation),
          reason: normalizeText(entryPlan?.reason, 'No disciplined entry is justified until the market returns to a stronger point of interest.'),
        },
        riskManagement: {
          invalidationLevel: normalizeNumeric(riskManagement?.invalidation_level),
          invalidationReason: normalizeText(riskManagement?.invalidation_reason, 'The setup fails if price breaks the structure that supports the active bias.'),
        },
        quality: {
          setupRating: normalizeSetupRating(quality?.setup_rating),
          confidence: normalizeConfidence(quality?.confidence),
        },
        finalVerdict: {
          action: normalizeFinalAction(finalVerdict?.action),
          message: normalizeText(finalVerdict?.message, 'Wait for a cleaner structure-aligned setup before entering.'),
        },
        reasoning: normalizeText(parsed.reasoning, 'The current OHLC data does not justify forcing a trade setup.'),
        visiblePriceRange: normalizeVisiblePriceRange(parsed.visible_price_range),
        stopLoss: normalizeNumeric(parsed.stop_loss),
        takeProfit1: normalizeNumeric(parsed.take_profit_1),
        takeProfit2: normalizeNumeric(parsed.take_profit_2),
        takeProfit3: normalizeNumeric(parsed.take_profit_3),
        analysisMeta: createMetadata(primaryModel, fallbackModel, candidate.modelName, candidate.provider),
      };
    } catch (error) {
      lastError = error;
      lastCandidate = candidate;
    }
  }

  throw new Error(
    lastError instanceof Error
      ? `${lastError.message} [${lastCandidate.provider}:${lastCandidate.modelName}]`
      : 'Live chart analysis failed'
  );
};