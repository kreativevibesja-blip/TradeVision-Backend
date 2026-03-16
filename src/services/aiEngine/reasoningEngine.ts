import OpenAI from 'openai';
import { config } from '../../config';
import type { ChartVisionOutput } from '../imageProcessing/chartVision';
import type { MarketStructureOutput } from '../structureEngine/marketStructure';
import { roundPrice } from '../../utils/volatilityDetector';

export interface TradeReasoningOutput {
  bias: 'bullish' | 'bearish' | 'neutral';
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  confidence: number;
  explanation: string;
}

type RawReasoning = Partial<TradeReasoningOutput> & {
  confidence?: number | string;
};

const openai = new OpenAI({ apiKey: config.openai.apiKey || 'missing-api-key' });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildFallback = (pair: string, layer1: ChartVisionOutput, layer2: MarketStructureOutput): TradeReasoningOutput => {
  const entry = roundPrice((layer2.tradeSetup.entryZone[0] + layer2.tradeSetup.entryZone[1]) / 2, pair);
  const risk = Math.abs(entry - layer2.tradeSetup.stopLoss);
  const multiplier = layer2.marketBias === 'bearish' ? -1 : 1;
  const tp1 = roundPrice(entry + risk * 1.6 * multiplier, pair);
  const tp2 = roundPrice(entry + risk * 2.6 * multiplier, pair);
  const confidence = clamp(
    Math.round(
      52 +
        layer1.trendStrength * 24 +
        (layer2.smcSignals.bos.length > 0 ? 8 : 0) +
        (layer1.range === 'compression' ? -6 : 4) +
        (layer1.volatility === 'extreme' ? -4 : 3)
    ),
    35,
    92
  );

  return {
    bias: layer2.marketBias,
    entry,
    stopLoss: layer2.tradeSetup.stopLoss,
    tp1,
    tp2,
    confidence,
    explanation:
      layer2.marketBias === 'neutral'
        ? 'Price is rotating inside a balanced structure. Wait for a clean break or a stronger reaction from a supply or demand zone before committing risk.'
        : `Price is maintaining ${layer2.marketBias} structure with ${layer2.liquidity} and ${layer2.tradeSetup.type} conditions around the current zone. The setup is anchored on structure, liquidity, and the current ${layer2.volatilityRegime} volatility regime.`,
  };
};

const parseContent = (content: string, fallback: TradeReasoningOutput): TradeReasoningOutput => {
  try {
    const parsed = JSON.parse(content) as RawReasoning;
    return {
      bias: parsed.bias === 'bullish' || parsed.bias === 'bearish' ? parsed.bias : fallback.bias,
      entry: typeof parsed.entry === 'number' ? parsed.entry : fallback.entry,
      stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : fallback.stopLoss,
      tp1: typeof parsed.tp1 === 'number' ? parsed.tp1 : fallback.tp1,
      tp2: typeof parsed.tp2 === 'number' ? parsed.tp2 : fallback.tp2,
      confidence:
        typeof parsed.confidence === 'number'
          ? clamp(Math.round(parsed.confidence), 0, 100)
          : fallback.confidence,
      explanation: typeof parsed.explanation === 'string' && parsed.explanation.trim() ? parsed.explanation.trim() : fallback.explanation,
    };
  } catch {
    return fallback;
  }
};

export async function generateTradeReasoning(
  pair: string,
  timeframe: string,
  layer1: ChartVisionOutput,
  layer2: MarketStructureOutput
): Promise<TradeReasoningOutput> {
  const fallback = buildFallback(pair, layer1, layer2);

  if (!config.openai.apiKey) {
    return fallback;
  }

  const prompt = `You are a professional trading analyst. Use only the structured context below. Do not infer anything from raw image pixels.

Return valid JSON only with this exact schema:
{
  "bias": "bullish | bearish | neutral",
  "entry": 0,
  "stopLoss": 0,
  "tp1": 0,
  "tp2": 0,
  "confidence": 0,
  "explanation": ""
}

Context:
${JSON.stringify({ pair, timeframe, layer1, layer2 }, null, 2)}

Rules:
- Keep prices numeric.
- Bias must align with the market structure unless there is a clear reason to stay neutral.
- Confidence must be 0-100.
- Use concise institutional-style reasoning.
- Focus on liquidity, BOS, CHoCH, FVG, supply/demand, volatility regime, and the proposed trade setup.`;

  try {
    const response = await openai.chat.completions.create({
      model: config.openai.analysisModel,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 700,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    const parsed = parseContent(content, fallback);

    return {
      ...parsed,
      entry: roundPrice(parsed.entry, pair),
      stopLoss: roundPrice(parsed.stopLoss, pair),
      tp1: roundPrice(parsed.tp1, pair),
      tp2: roundPrice(parsed.tp2, pair),
      confidence: clamp(parsed.confidence, 0, 100),
    };
  } catch (error) {
    console.error('AI reasoning fallback triggered:', error);
    return fallback;
  }
}