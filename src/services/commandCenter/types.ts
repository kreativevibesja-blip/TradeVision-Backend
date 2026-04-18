export interface CommandCenterCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type TradeDirection = 'buy' | 'sell';

export type TradeState = 'READY' | 'WAIT' | 'INVALID' | 'TRIGGERED' | 'ACTIVE' | 'CLOSED';

export type LiveStatusMessage =
  | 'approaching entry'
  | 'entry triggered'
  | 'momentum strong'
  | 'momentum fading'
  | 'approaching TP'
  | 'exit warning'
  | 'wait for confirmation'
  | 'price in entry zone'
  | 'watching structure';

export interface EntryZone {
  min: number;
  max: number;
}

export interface TradeInput {
  id: string;
  pair: string;
  timeframe: string;
  direction: TradeDirection;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  confirmation: string;
  invalidationLevel: number | null;
  invalidationReason: string;
  reasoning: string;
  confidence: number;
  marketCondition?: string;
  primaryStrategy?: string;
  structure?: {
    bos: string;
    choch: string;
    state?: string;
  };
  liquidity?: {
    type?: string;
    sweep?: string;
  };
  createdAt: string;
}

export interface MarketData {
  currentPrice: number;
  candles: CommandCenterCandle[];
  timestamp: number;
}

export interface ConfidenceReason {
  label: string;
  status: boolean;
}

export interface ConfidenceResult {
  score: number;
  reasons: ConfidenceReason[];
}

export interface TimingResult {
  message: string;
  candlesEstimate: string;
  conditions: string[];
}

export interface SltpGuidance {
  slInstruction: string;
  tpLevels: { label: string; price: number }[];
}

export interface InvalidationResult {
  isInvalid: boolean;
  reason: string;
}

export interface CommandCenterSnapshot {
  trade: TradeInput;
  state: TradeState;
  entryZone: EntryZone;
  confidence: ConfidenceResult;
  timing: TimingResult;
  sltp: SltpGuidance;
  liveStatus: LiveStatusMessage;
  invalidation: InvalidationResult;
  currentPrice: number;
  updatedAt: string;
}
