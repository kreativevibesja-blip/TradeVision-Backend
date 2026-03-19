import { getPricePrecision } from '../utils/volatilityDetector';
import type { AnchoredPriceResult } from './priceAnchor';
import type { VisionAnalysisResult } from './visionAnalysis';

interface SetupGuide {
  likelyEntryArea: string;
  whyThisArea: string;
  confirmationChecklist: string[];
  entryTrigger: string;
  stopGuidance: string;
  watchOut: string;
}

export interface TradeSignalResult {
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  currentPrice: number;
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  riskReward: string | null;
  entryType: VisionAnalysisResult['entryType'];
  recommendation: VisionAnalysisResult['recommendation'];
  reasoning: string;
  trendStrength: VisionAnalysisResult['trendStrength'];
  structure: VisionAnalysisResult['structure'];
  structureSummary: string;
  liquidityContext: string;
  clarity: VisionAnalysisResult['clarity'];
  range: number;
  buffer: number;
  priceSource: AnchoredPriceResult['priceSource'];
  waitConditions: string;
  setupGuide: SetupGuide;
  provider: 'gemini-vision+anchor';
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatPrice = (value: number, pair: string) => value.toFixed(getPricePrecision(pair));

const formatZone = (low: number, high: number, pair: string) => {
  const zoneLow = Math.min(low, high);
  const zoneHigh = Math.max(low, high);

  if (zoneLow === zoneHigh) {
    return formatPrice(zoneLow, pair);
  }

  return `${formatPrice(zoneLow, pair)} - ${formatPrice(zoneHigh, pair)}`;
};

const getTeachingBias = (vision: VisionAnalysisResult): 'bullish' | 'bearish' | 'neutral' => {
  if (vision.bias !== 'neutral') {
    return vision.bias;
  }

  if (vision.liquidityContext.includes('below')) {
    return 'bullish';
  }

  if (vision.liquidityContext.includes('above')) {
    return 'bearish';
  }

  return 'neutral';
};

const buildBreakoutGuide = (pair: string, vision: VisionAnalysisResult, anchor: AnchoredPriceResult, direction: 'bullish' | 'bearish'): SetupGuide => {
  const isBullish = direction === 'bullish';
  const zoneLow = isBullish ? anchor.currentPrice + anchor.buffer * 0.4 : anchor.currentPrice - anchor.range * 0.65;
  const zoneHigh = isBullish ? anchor.currentPrice + anchor.range * 0.65 : anchor.currentPrice - anchor.buffer * 0.4;
  const zoneText = formatZone(zoneLow, zoneHigh, pair);
  const structuralArea = isBullish ? vision.structure.recentHighZone : vision.structure.recentLowZone;
  const retestSide = isBullish ? 'above' : 'below';
  const oppositeSide = isBullish ? 'below' : 'above';
  const triggerSide = isBullish ? 'higher' : 'lower';

  return {
    likelyEntryArea: `Watch the breakout edge around ${structuralArea} and the anchored watch zone near ${zoneText}. The cleaner entry is usually the first retest that holds ${retestSide} the broken level instead of chasing the initial impulse candle.`,
    whyThisArea: `A ${direction} breakout is higher quality when price proves acceptance beyond the range edge. That retest shows whether the breakout is real or just a brief liquidity run.`,
    confirmationChecklist: [
      `Wait for a decisive candle body to close ${retestSide} the breakout level with more displacement than the candles before it.`,
      `Let price retest the broken level and reject back ${retestSide} it instead of immediately slipping back inside the range.`,
      `Look for the next candle to continue ${triggerSide} rather than printing small overlapping bodies.`
    ],
    entryTrigger: `Enter on the confirmation close or on the first shallow retest that respects the breakout shelf ${retestSide} the level.`,
    stopGuidance: `Place the stop ${oppositeSide} the retest low or high that validates the breakout. If price closes back through that shelf, the breakout thesis is weakening.`,
    watchOut: `Skip the trade if the breakout candle is immediately retraced, if the retest cannot hold ${retestSide} the level, or if the move expands without follow-through.`
  };
};

const buildSweepGuide = (pair: string, vision: VisionAnalysisResult, anchor: AnchoredPriceResult, direction: 'bullish' | 'bearish'): SetupGuide => {
  const isBullish = direction === 'bullish';
  const zoneLow = isBullish ? anchor.currentPrice - anchor.range : anchor.currentPrice + anchor.buffer * 0.4;
  const zoneHigh = isBullish ? anchor.currentPrice - anchor.buffer * 0.4 : anchor.currentPrice + anchor.range;
  const zoneText = formatZone(zoneLow, zoneHigh, pair);
  const structuralArea = isBullish ? vision.structure.recentLowZone : vision.structure.recentHighZone;
  const liquiditySide = isBullish ? 'lows' : 'highs';
  const reclaimSide = isBullish ? 'above' : 'below';
  const stopSide = isBullish ? 'below' : 'above';
  const directionalEntry = isBullish ? 'long' : 'short';

  return {
    likelyEntryArea: `The most likely entry area is around ${structuralArea}, with the anchored reaction zone near ${zoneText}. Let price sweep the ${liquiditySide} first, then show that it can reclaim the level instead of entering in the middle of the range.`,
    whyThisArea: `In a ${direction} context, better entries often come after weaker traders are trapped on the wrong side of the local swing. That sweep creates the liquidity needed for a cleaner ${directionalEntry} continuation or reversal response.`,
    confirmationChecklist: [
      `Wait for a sweep of the local ${liquiditySide} into the watch zone rather than entering before liquidity is taken.`,
      `Look for a strong engulfing or displacement candle to close back ${reclaimSide} the reclaimed level.`,
      `Make sure the next candle respects that level and does not immediately trade back through it.`
    ],
    entryTrigger: `Enter on the confirmation candle close or on the first retest that holds ${reclaimSide} the swept level.`,
    stopGuidance: `Place the stop ${stopSide} the sweep wick or beyond the invalidation candle that reclaimed the zone.`,
    watchOut: `Avoid the setup if price keeps chopping through the level, if the reclaim candle is weak, or if momentum stalls as soon as it retests the zone.`
  };
};

const buildNeutralGuide = (pair: string, vision: VisionAnalysisResult, anchor: AnchoredPriceResult): SetupGuide => {
  const zoneText = formatZone(anchor.currentPrice - anchor.buffer, anchor.currentPrice + anchor.buffer, pair);

  return {
    likelyEntryArea: `The chart is balanced, so do not force a directional bias yet. Watch either ${vision.structure.recentLowZone} or ${vision.structure.recentHighZone} for the first clean liquidity sweep, with the current working zone centered around ${zoneText}.`,
    whyThisArea: `When structure is neutral, the edge is not in predicting direction early. The edge comes after one side of the range is taken and price quickly shows acceptance back inside or continuation beyond that boundary.`,
    confirmationChecklist: [
      'Wait for one side of the range to be swept cleanly before considering any entry.',
      'Look for a strong rejection or reclaim candle rather than overlapping candles with no displacement.',
      'Only participate if the next candle confirms the reclaim or breakout instead of drifting back into indecision.'
    ],
    entryTrigger: 'Enter only after the reclaim or breakout candle closes and the next candle proves the level is holding.',
    stopGuidance: 'Place the stop beyond the sweep wick on the side that was taken, not in the middle of the range.',
    watchOut: 'Stand aside if both sides of the range keep getting traded through, if bodies stay small and overlapping, or if there is no clear follow-through after the sweep.'
  };
};

const buildSetupGuide = (pair: string, vision: VisionAnalysisResult, anchor: AnchoredPriceResult): SetupGuide => {
  const teachingBias = getTeachingBias(vision);

  if (teachingBias === 'neutral') {
    return buildNeutralGuide(pair, vision, anchor);
  }

  if (vision.entryType === 'breakout') {
    return buildBreakoutGuide(pair, vision, anchor, teachingBias);
  }

  return buildSweepGuide(pair, vision, anchor, teachingBias);
};

export function buildTradeSignal(pair: string, vision: VisionAnalysisResult, anchor: AnchoredPriceResult): TradeSignalResult {
  let confidence = 30;

  if (vision.bias !== 'neutral') confidence += 15;
  if (vision.trendStrength === 'strong') confidence += 25;
  if (vision.trendStrength === 'moderate') confidence += 15;
  if (vision.clarity === 'clear') confidence += 20;
  if (vision.clarity === 'mixed') confidence += 8;
  if (vision.entryType === 'breakout') confidence += 5;
  if (vision.entryType === 'pullback') confidence += 8;
  if (vision.liquidityContext.includes('above') || vision.liquidityContext.includes('below')) confidence += 5;
  if (anchor.shouldWait) confidence -= 22;

  confidence = clamp(confidence, 15, 95);

  if (anchor.shouldWait) {
    confidence = Math.min(confidence, 45);
  }

  const setupGuide = buildSetupGuide(pair, vision, anchor);
  const waitConditions = `${setupGuide.likelyEntryArea} ${setupGuide.entryTrigger} ${setupGuide.watchOut}`;

  const reasoning = anchor.shouldWait
    ? `${vision.structureSummary} Gemini marked the chart as ${vision.clarity}, so the engine keeps the recommendation on wait. No exact prices were generated by AI. Rather than forcing an entry, the system now points to the most likely reaction area, what confirmation should appear there, and how the idea would be invalidated around the supplied current price of ${formatPrice(anchor.currentPrice, pair)}.`
    : `${vision.structureSummary} Bias is ${vision.bias} with ${vision.trendStrength} trend pressure and ${vision.entryType} conditions. Liquidity is positioned ${vision.liquidityContext}. Entry, stop loss, and targets are anchored mechanically to the supplied current price of ${formatPrice(anchor.currentPrice, pair)} using a ${formatPrice(anchor.range, pair)} working range and ${formatPrice(anchor.buffer, pair)} execution buffer, which avoids image-based fake precision.`;

  return {
    bias: vision.bias,
    confidence,
    currentPrice: anchor.currentPrice,
    entry: anchor.entry,
    stopLoss: anchor.stopLoss,
    takeProfits: anchor.takeProfits,
    riskReward: anchor.riskReward,
    entryType: vision.entryType,
    recommendation: anchor.shouldWait ? 'wait' : vision.recommendation,
    reasoning,
    trendStrength: vision.trendStrength,
    structure: vision.structure,
    structureSummary: vision.structureSummary,
    liquidityContext: vision.liquidityContext,
    clarity: vision.clarity,
    range: anchor.range,
    buffer: anchor.buffer,
    priceSource: anchor.priceSource,
    waitConditions,
    setupGuide,
    provider: 'gemini-vision+anchor',
  };
}