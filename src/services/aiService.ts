import OpenAI from 'openai';
import { config } from '../config';
import fs from 'fs';

const openai = new OpenAI({ apiKey: config.openai.apiKey });

export interface ChartAnalysis {
  marketCondition: string;
  bias: string;
  entry: string;
  stopLoss: string;
  takeProfits: string[];
  confidence: number;
  analysisText: string;
  strategy: string;
  structure: {
    bos: string[];
    choch: string[];
    liquidityZones: string[];
    supportResistance: string[];
  };
  waitConditions: string;
}

interface RawChartAnalysis {
  market_condition?: string;
  bias?: string;
  entry_zone?: string;
  stop_loss?: string;
  take_profit_targets?: string[];
  confidence_score?: string | number;
  strategy_used?: string;
  wait_conditions?: string;
  analysis_summary?: string;
}

const ANALYSIS_PROMPT = `You are an elite professional trading analyst specializing in price action, Smart Money Concepts (SMC), trend trading, and support/resistance analysis.

Your task is to analyze a trading chart screenshot and produce a professional trading analysis.

The chart may come from any platform including MT5, cTrader, TradingView, or Deriv synthetic markets (Boom, Crash, Volatility indices, Step, Jump).

Do not assume indicators exist. Focus primarily on price structure and candlestick behavior.

Follow this framework:

PHASE 1 - MARKET STRUCTURE DETECTION
- Determine current market structure.
- Identify higher highs/higher lows, lower highs/lower lows, consolidation, BOS, and CHOCH.
- Classify the market as one of: Trending Uptrend, Trending Downtrend, Range / Consolidation, Accumulation, Distribution, Volatility spike.

PHASE 2 - KEY LEVEL IDENTIFICATION
- Detect support zones, resistance zones, liquidity pools, previous highs/lows, and range boundaries.
- Identify likely liquidity at equal highs, equal lows, and clustered stop zones.

PHASE 3 - SMART MONEY CONCEPTS ANALYSIS
- Identify liquidity sweeps, fair value gaps, order blocks or supply/demand zones, mitigation areas, and structure shifts.
- Determine whether price recently swept liquidity above highs or below lows.

PHASE 4 - TREND AND MOMENTUM ANALYSIS
- Determine dominant directional bias.
- Assess continuation probability, pullback vs breakout context, and momentum strength.

PHASE 5 - TRADE SETUP GENERATION
- Provide market bias, entry zone, stop loss, and up to 3 take profit targets.
- Use realistic structure-based invalidation and target logic.

PHASE 6 - WAIT CONDITIONS
- If the setup is not confirmed, specify what confirmation to wait for.

PHASE 7 - TRADE CONFIDENCE SCORE
- Score the setup from 0 to 100.
- Explain why the score is high or low, including strengths and risks.

PHASE 8 - FINAL SUMMARY
- Provide a short final verdict on whether traders should consider entering now or waiting.

Return results as valid JSON using this exact schema:
{
  "market_condition": "",
  "bias": "",
  "entry_zone": "",
  "stop_loss": "",
  "take_profit_targets": ["", "", ""],
  "confidence_score": "",
  "strategy_used": "",
  "wait_conditions": "",
  "analysis_summary": ""
}

Rules:
- Return ONLY valid JSON.
- No markdown, no code fences, no extra commentary.
- Use specific price areas when visible; otherwise describe structure zones clearly.
- Keep bias as BULLISH, BEARISH, or NEUTRAL.
- Keep confidence_score as a numeric score from 0 to 100, with no percent sign if possible.`;

function extractConfidenceScore(value: string | number | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }

  if (typeof value === 'string') {
    const match = value.match(/\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(100, parsed));
      }
    }
  }

  return 30;
}

function normalizeAnalysis(raw: RawChartAnalysis, fallbackText: string): ChartAnalysis {
  return {
    marketCondition: raw.market_condition?.trim() || 'Range / Consolidation',
    bias: raw.bias?.trim().toUpperCase() || 'NEUTRAL',
    entry: raw.entry_zone?.trim() || 'Await clearer entry confirmation from structure.',
    stopLoss: raw.stop_loss?.trim() || 'Invalidation not clearly visible on the chart.',
    takeProfits:
      raw.take_profit_targets?.filter((target) => typeof target === 'string' && target.trim().length > 0) ||
      ['Monitor nearby liquidity and opposing structure for exits.'],
    confidence: extractConfidenceScore(raw.confidence_score),
    analysisText:
      raw.analysis_summary?.trim() ||
      fallbackText ||
      'Analysis could not be parsed. Please try uploading a clearer chart image.',
    strategy: raw.strategy_used?.trim() || 'Price Action / Smart Money Concepts',
    structure: {
      bos: [],
      choch: [],
      liquidityZones: [],
      supportResistance: [],
    },
    waitConditions:
      raw.wait_conditions?.trim() ||
      'Wait for confirmation at a key structure zone before entering.',
  };
}

export async function analyzeChart(
  imagePath: string,
  pair: string,
  timeframe: string
): Promise<ChartAnalysis> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${ANALYSIS_PROMPT}\n\nTrading pair/index: ${pair}\nTimeframe: ${timeframe}`,
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || '';
  
  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned) as RawChartAnalysis;

    return normalizeAnalysis(parsed, cleaned);
  } catch {
    return {
      marketCondition: 'Range / Consolidation',
      bias: 'NEUTRAL',
      entry: 'Unable to determine precise entry from chart',
      stopLoss: 'Unable to determine precise stop loss from chart',
      takeProfits: ['Refer to key resistance/support levels'],
      confidence: 30,
      analysisText: content || 'Analysis could not be parsed. Please try uploading a clearer chart image.',
      strategy: 'Manual Review Required',
      structure: {
        bos: [],
        choch: [],
        liquidityZones: [],
        supportResistance: [],
      },
      waitConditions: 'Please re-upload a clearer chart screenshot for better analysis.',
    };
  }
}
