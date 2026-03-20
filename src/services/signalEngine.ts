import { getPricePrecision } from '../utils/volatilityDetector';
import type { PriceEngineResult } from './priceEngine';
import type { FilteredSignalResult } from './signalFilter';

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
  signalType: 'instant' | 'pending' | 'wait';
  entryZone: { low: number; high: number } | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  riskReward: string | null;
  entryType: FilteredSignalResult['entryType'];
  recommendation: FilteredSignalResult['recommendation'];
  reasoning: string;
  trendStrength: FilteredSignalResult['trendStrength'];
  structure: FilteredSignalResult['structure'];
  structureSummary: string;
  liquidityContext: string;
  clarity: FilteredSignalResult['clarity'];
  currentPriceRelation: FilteredSignalResult['currentPriceRelation'];
  aiEntryZone: FilteredSignalResult['entryZone'];
  confirmationNeeded: boolean;
  confirmationDetails: string;
  invalidationHint: string;
  filterReason: string;
  range: number;
  buffer: number;
  priceSource: PriceEngineResult['priceSource'];
  executionMode: PriceEngineResult['executionMode'];
  waitConditions: string;
  setupGuide: SetupGuide;
  provider: 'gemini-vision+filter';
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

const buildSetupGuide = (pair: string, filtered: FilteredSignalResult, pricePlan: PriceEngineResult): SetupGuide => {
  const zoneText = pricePlan.entryZone ? formatZone(pricePlan.entryZone.low, pricePlan.entryZone.high, pair) : filtered.entryZone.label;
  const entryTrigger =
    filtered.signalType === 'instant'
      ? 'Execution can be taken now because price is already at the trade location and the confirmation condition is already present.'
      : filtered.signalType === 'pending'
        ? `Plan execution only when price reaches ${zoneText} and confirms there with the behavior described below.`
        : 'Do not execute yet. Wait for price to move into the reaction area and prove intent there.';

  return {
    likelyEntryArea: `${filtered.entryZone.description}${pricePlan.entryZone ? ` Numeric watch zone: ${zoneText}.` : ''}`,
    whyThisArea: `${filtered.structureSummary} Liquidity context is ${filtered.liquidityContext}, so the focus stays on a high-quality reaction rather than forcing a price close to the current candle.`,
    confirmationChecklist: [
      filtered.confirmationDetails,
      filtered.currentPriceRelation === 'far_from_zone'
        ? 'Let price travel into the preferred zone before planning execution.'
        : 'Avoid chasing candles that extend away from the preferred zone.',
      filtered.signalType === 'instant'
        ? 'If momentum stalls immediately after entry, reassess instead of averaging into a weaker setup.'
        : 'Only participate if the first reaction from the zone shows clear follow-through.'
    ],
    entryTrigger,
    stopGuidance:
      pricePlan.stopLoss !== null
        ? `Risk is defined beyond ${formatPrice(pricePlan.stopLoss, pair)}. ${filtered.invalidationHint}`
        : `No executable stop belongs here yet because the setup is still in wait mode. ${filtered.invalidationHint}`,
    watchOut: filtered.filterReason,
  };
};

export function buildTradeSignal(pair: string, filtered: FilteredSignalResult, pricePlan: PriceEngineResult): TradeSignalResult {
  let confidence = 30;

  if (filtered.bias !== 'neutral') confidence += 12;
  if (filtered.trendStrength === 'strong') confidence += 18;
  if (filtered.trendStrength === 'moderate') confidence += 10;
  if (filtered.clarity === 'clear') confidence += 18;
  if (filtered.clarity === 'mixed') confidence += 6;
  if (filtered.entryType === 'pullback') confidence += 5;
  if (filtered.currentPriceRelation === 'at_zone') confidence += 10;
  if (filtered.currentPriceRelation === 'near_zone') confidence += 5;
  if (filtered.signalType === 'instant') confidence += 14;
  if (filtered.signalType === 'pending') confidence += 6;
  if (filtered.confirmationNeeded) confidence -= 8;
  confidence -= filtered.filterFlags.length * 3;
  if (filtered.signalType === 'wait') confidence -= 20;

  confidence = clamp(confidence, 15, 95);

  if (filtered.signalType === 'wait') {
    confidence = Math.min(confidence, 45);
  }

  const setupGuide = buildSetupGuide(pair, filtered, pricePlan);
  const waitConditions = `${setupGuide.likelyEntryArea} ${setupGuide.entryTrigger} ${setupGuide.watchOut}`;

  const reasoning =
    filtered.signalType === 'wait'
      ? `${filtered.structureSummary} The filtered signal state is WAIT because ${filtered.filterReason.toLowerCase()} No executable prices were forced. The system keeps the focus on ${filtered.entryZone.description.toLowerCase()} and waits for a higher-quality chart location before publishing levels.`
      : filtered.signalType === 'pending'
        ? `${filtered.structureSummary} The AI sees a valid idea, but it is still PENDING because ${filtered.filterReason.toLowerCase()} The engine therefore publishes an entry zone instead of pretending the current candle is already an executable fill.`
        : `${filtered.structureSummary} The setup remains INSTANT because structure, price location, and confirmation are aligned. Entry is allowed at the current price of ${formatPrice(pricePlan.currentPrice, pair)}, with risk and targets derived from the live-price range model rather than fabricated chart-image precision.`;

  return {
    bias: filtered.bias,
    confidence,
    currentPrice: pricePlan.currentPrice,
    signalType: filtered.signalType,
    entryZone: pricePlan.entryZone,
    entry: pricePlan.entry,
    stopLoss: pricePlan.stopLoss,
    takeProfits: pricePlan.takeProfits,
    riskReward: pricePlan.riskReward,
    entryType: filtered.entryType,
    recommendation: filtered.recommendation,
    reasoning,
    trendStrength: filtered.trendStrength,
    structure: filtered.structure,
    structureSummary: filtered.structureSummary,
    liquidityContext: filtered.liquidityContext,
    clarity: filtered.clarity,
    currentPriceRelation: filtered.currentPriceRelation,
    aiEntryZone: filtered.entryZone,
    confirmationNeeded: filtered.confirmationNeeded,
    confirmationDetails: filtered.confirmationDetails,
    invalidationHint: filtered.invalidationHint,
    filterReason: filtered.filterReason,
    range: pricePlan.range,
    buffer: pricePlan.buffer,
    priceSource: pricePlan.priceSource,
    executionMode: pricePlan.executionMode,
    waitConditions,
    setupGuide,
    provider: 'gemini-vision+filter',
  };
}