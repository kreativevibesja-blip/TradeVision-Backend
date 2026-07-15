export type MarketBias = 'bullish' | 'bearish' | 'neutral' | 'unclear';
export type MarketCondition = 'trending' | 'ranging' | 'corrective' | 'volatile' | 'unclear';
export type SetupType = 'continuation' | 'reversal' | 'breakout' | 'pullback' | 'range' | 'no_trade';
export type EntryReadiness = 'ready' | 'waiting' | 'no_trade';
export type AnalysisMode = 'conservative' | 'balanced' | 'institutional';
export type EntryTiming = 'ENTER NOW' | 'WAIT 1 CANDLE' | 'WAIT 2 CANDLES' | 'WAIT FOR RETEST' | 'WATCH ONLY';
export type TradeQuality = 'Excellent' | 'Strong' | 'Moderate' | 'Weak';
export type RiskLevel = 'low' | 'medium' | 'high';
export type SetupQuality = 'A+' | 'A' | 'B' | 'C' | 'avoid';
export type TradeDirection = 'buy' | 'sell' | 'none';
export type KeyLevelType = 'support' | 'resistance' | 'supply' | 'demand' | 'liquidity' | 'fvg' | 'range_high' | 'range_low';

export interface TradingKeyLevel {
  type: KeyLevelType;
  price: number | null;
  description: string;
}

export interface TradingAnalysis {
  marketBias: MarketBias;
  marketCondition: MarketCondition;
  setupType: SetupType;
  entryReadiness: EntryReadiness;
  analysisMode: AnalysisMode;
  entryTiming: EntryTiming;
  confidence: number;
  setupQuality: SetupQuality;
  tradeQuality: TradeQuality;
  riskLevel: RiskLevel;
  direction: TradeDirection;
  entryZone: {
    from: number | null;
    to: number | null;
  };
  stopLoss: number | null;
  takeProfits: number[];
  invalidation: string;
  riskReward: number | null;
  keyLevels: TradingKeyLevel[];
  whatToWaitFor: string;
  tradeRadarRecommendation: {
    sendToRadar: boolean;
    reason: string;
  };
  summary: string;
  mentorNotes: string[];
}

export const SAFE_TRADING_ANALYSIS_FALLBACK: TradingAnalysis = {
  marketBias: 'unclear',
  marketCondition: 'unclear',
  setupType: 'no_trade',
  entryReadiness: 'no_trade',
  analysisMode: 'conservative',
  entryTiming: 'WATCH ONLY',
  confidence: 0,
  setupQuality: 'avoid',
  tradeQuality: 'Weak',
  riskLevel: 'high',
  direction: 'none',
  entryZone: { from: null, to: null },
  stopLoss: null,
  takeProfits: [],
  invalidation: 'No clean setup detected. Chart requires more confirmation.',
  riskReward: null,
  keyLevels: [],
  whatToWaitFor: 'No clean setup detected. Chart requires more confirmation.',
  tradeRadarRecommendation: {
    sendToRadar: false,
    reason: 'A setup should only be monitored after a clearer trigger forms.',
  },
  summary: 'No clean setup detected. Chart requires more confirmation.',
  mentorNotes: ['Orion does not see a clean setup right now. Wait for clearer market structure before considering risk.'],
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? value as Record<string, unknown> : null;

const normalizeEnum = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(normalized) ? normalized as T : fallback;
};

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const normalizeText = (value: unknown, fallback: string) =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

const normalizeConfidence = (value: unknown) => {
  const parsed = normalizeNumber(value);
  return parsed === null ? 0 : Math.max(0, Math.min(100, Math.round(parsed)));
};

const normalizeSetupQuality = (value: unknown): SetupQuality => {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized === 'A+' || normalized === 'A' || normalized === 'B' || normalized === 'C') {
    return normalized;
  }
  return 'avoid';
};

const tradeQualityFromConfidence = (confidence: number): TradeQuality => {
  if (confidence >= 85) return 'Excellent';
  if (confidence >= 75) return 'Strong';
  if (confidence >= 60) return 'Moderate';
  return 'Weak';
};

const normalizeKeyLevels = (value: unknown): TradingKeyLevel[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 12).map((item) => {
    const record = asRecord(item) ?? {};
    return {
      type: normalizeEnum(record.type, ['support', 'resistance', 'supply', 'demand', 'liquidity', 'fvg', 'range_high', 'range_low'] as const, 'support'),
      price: normalizeNumber(record.price),
      description: normalizeText(record.description, 'Key trading level identified by Orion.'),
    };
  });
};

const normalizeTakeProfits = (value: unknown) =>
  Array.isArray(value)
    ? value.map(normalizeNumber).filter((item): item is number => item !== null).slice(0, 4)
    : [];

export const validateTradingAnalysisResponse = (input: unknown): TradingAnalysis => {
  let value = input;

  if (typeof input === 'string') {
    try {
      const trimmed = input.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      value = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed);
    } catch {
      return SAFE_TRADING_ANALYSIS_FALLBACK;
    }
  }

  const record = asRecord(value);
  if (!record) {
    return SAFE_TRADING_ANALYSIS_FALLBACK;
  }

  const entryZoneRecord = asRecord(record.entryZone) ?? asRecord(record.entry_zone) ?? {};
  const radarRecord = asRecord(record.tradeRadarRecommendation) ?? asRecord(record.trade_radar_recommendation) ?? {};

  let result: TradingAnalysis = {
    marketBias: normalizeEnum(record.marketBias, ['bullish', 'bearish', 'neutral', 'unclear'] as const, 'unclear'),
    marketCondition: normalizeEnum(record.marketCondition, ['trending', 'ranging', 'corrective', 'volatile', 'unclear'] as const, 'unclear'),
    setupType: normalizeEnum(record.setupType, ['continuation', 'reversal', 'breakout', 'pullback', 'range', 'no_trade'] as const, 'no_trade'),
    entryReadiness: normalizeEnum(record.entryReadiness, ['ready', 'waiting', 'no_trade'] as const, 'no_trade'),
    analysisMode: normalizeEnum(record.analysisMode, ['conservative', 'balanced', 'institutional'] as const, 'conservative'),
    entryTiming: normalizeEnum(record.entryTiming, ['ENTER NOW', 'WAIT 1 CANDLE', 'WAIT 2 CANDLES', 'WAIT FOR RETEST', 'WATCH ONLY'] as const, 'WATCH ONLY'),
    confidence: normalizeConfidence(record.confidence),
    setupQuality: normalizeSetupQuality(record.setupQuality),
    tradeQuality: 'Weak',
    riskLevel: normalizeEnum(record.riskLevel, ['low', 'medium', 'high'] as const, 'high'),
    direction: normalizeEnum(record.direction, ['buy', 'sell', 'none'] as const, 'none'),
    entryZone: {
      from: normalizeNumber(entryZoneRecord.from),
      to: normalizeNumber(entryZoneRecord.to),
    },
    stopLoss: normalizeNumber(record.stopLoss),
    takeProfits: normalizeTakeProfits(record.takeProfits),
    invalidation: normalizeText(record.invalidation, SAFE_TRADING_ANALYSIS_FALLBACK.invalidation),
    riskReward: normalizeNumber(record.riskReward),
    keyLevels: normalizeKeyLevels(record.keyLevels),
    whatToWaitFor: normalizeText(record.whatToWaitFor, SAFE_TRADING_ANALYSIS_FALLBACK.whatToWaitFor),
    tradeRadarRecommendation: {
      sendToRadar: radarRecord.sendToRadar === true,
      reason: normalizeText(radarRecord.reason, SAFE_TRADING_ANALYSIS_FALLBACK.tradeRadarRecommendation.reason),
    },
    summary: normalizeText(record.summary, SAFE_TRADING_ANALYSIS_FALLBACK.summary),
    mentorNotes: Array.isArray(record.mentorNotes)
      ? record.mentorNotes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6)
      : [],
  };
  result = { ...result, tradeQuality: tradeQualityFromConfidence(result.confidence) };

  if (result.direction === 'none') {
    result = {
      ...result,
      entryZone: { from: null, to: null },
      stopLoss: null,
      takeProfits: [],
      riskReward: null,
      entryTiming: 'WATCH ONLY',
    };
  }

  if (result.entryReadiness === 'no_trade') {
    result = {
      ...result,
      setupType: 'no_trade',
      direction: 'none',
      entryZone: { from: null, to: null },
      stopLoss: null,
      takeProfits: [],
      riskReward: null,
      tradeRadarRecommendation: {
        sendToRadar: false,
        reason: result.tradeRadarRecommendation.reason,
      },
    };
  }

  if (result.confidence < 50 && (result.setupQuality === 'A' || result.setupQuality === 'A+')) {
    result = { ...result, setupQuality: 'C' };
  }

  if (result.tradeRadarRecommendation.sendToRadar && result.entryReadiness === 'no_trade') {
    result = {
      ...result,
      tradeRadarRecommendation: {
        sendToRadar: false,
        reason: 'Trade Radar requires at least a waiting setup with a clear condition to monitor.',
      },
    };
  }

  if (result.entryZone.from !== null && result.entryZone.to !== null && result.entryZone.from > result.entryZone.to) {
    result = { ...result, entryZone: { from: result.entryZone.to, to: result.entryZone.from } };
  }

  if (!result.mentorNotes.length) {
    result = {
      ...result,
      mentorNotes: [
        result.entryReadiness === 'ready'
          ? 'Orion sees a potential setup, but risk remains uncertain and must be managed.'
          : 'Orion does not recommend entering yet. Wait for stronger confirmation before risking capital.',
      ],
    };
  }

  return result;
};
