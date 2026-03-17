"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateTradeReasoning = generateTradeReasoning;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../../config");
const volatilityDetector_1 = require("../../utils/volatilityDetector");
const openai = new openai_1.default({ apiKey: config_1.config.openai.apiKey || 'missing-api-key' });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const buildFallback = (pair, layer1, layer2) => {
    const entry = (0, volatilityDetector_1.roundPrice)((layer2.tradeSetup.entryZone[0] + layer2.tradeSetup.entryZone[1]) / 2, pair);
    const risk = Math.abs(entry - layer2.tradeSetup.stopLoss);
    const multiplier = layer2.marketBias === 'bearish' ? -1 : 1;
    const tp1 = (0, volatilityDetector_1.roundPrice)(entry + risk * 1.6 * multiplier, pair);
    const tp2 = (0, volatilityDetector_1.roundPrice)(entry + risk * 2.6 * multiplier, pair);
    const confidence = clamp(Math.round(52 +
        layer1.trendStrength * 24 +
        (layer2.smcSignals.bos.length > 0 ? 8 : 0) +
        (layer1.range === 'compression' ? -6 : 4) +
        (layer1.volatility === 'extreme' ? -4 : 3)), 35, 92);
    return {
        bias: layer2.marketBias,
        entry,
        stopLoss: layer2.tradeSetup.stopLoss,
        tp1,
        tp2,
        confidence,
        explanation: layer2.marketBias === 'neutral'
            ? 'Price is rotating inside a balanced structure. Wait for a clean break or a stronger reaction from a supply or demand zone before committing risk.'
            : `Price is maintaining ${layer2.marketBias} structure with ${layer2.liquidity} and ${layer2.tradeSetup.type} conditions around the current zone. The setup is anchored on structure, liquidity, and the current ${layer2.volatilityRegime} volatility regime.`,
    };
};
const parseContent = (content, fallback) => {
    try {
        const parsed = JSON.parse(content);
        return {
            bias: parsed.bias === 'bullish' || parsed.bias === 'bearish' ? parsed.bias : fallback.bias,
            entry: typeof parsed.entry === 'number' ? parsed.entry : fallback.entry,
            stopLoss: typeof parsed.stopLoss === 'number' ? parsed.stopLoss : fallback.stopLoss,
            tp1: typeof parsed.tp1 === 'number' ? parsed.tp1 : fallback.tp1,
            tp2: typeof parsed.tp2 === 'number' ? parsed.tp2 : fallback.tp2,
            confidence: typeof parsed.confidence === 'number'
                ? clamp(Math.round(parsed.confidence), 0, 100)
                : fallback.confidence,
            explanation: typeof parsed.explanation === 'string' && parsed.explanation.trim() ? parsed.explanation.trim() : fallback.explanation,
        };
    }
    catch {
        return fallback;
    }
};
async function generateTradeReasoning(pair, timeframe, layer1, layer2) {
    const fallback = buildFallback(pair, layer1, layer2);
    if (!config_1.config.openai.apiKey) {
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
            model: config_1.config.openai.analysisModel,
            response_format: { type: 'json_object' },
            temperature: 0.2,
            max_tokens: 700,
            messages: [{ role: 'user', content: prompt }],
        });
        const content = response.choices[0]?.message?.content?.trim() || '';
        const parsed = parseContent(content, fallback);
        return {
            ...parsed,
            entry: (0, volatilityDetector_1.roundPrice)(parsed.entry, pair),
            stopLoss: (0, volatilityDetector_1.roundPrice)(parsed.stopLoss, pair),
            tp1: (0, volatilityDetector_1.roundPrice)(parsed.tp1, pair),
            tp2: (0, volatilityDetector_1.roundPrice)(parsed.tp2, pair),
            confidence: clamp(parsed.confidence, 0, 100),
        };
    }
    catch (error) {
        console.error('AI reasoning fallback triggered:', error);
        return fallback;
    }
}
//# sourceMappingURL=reasoningEngine.js.map