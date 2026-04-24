import type { GoldxAccountState, GoldxMode, GoldxRuntimeTradeState } from './types';
import type { BrokerSession, StrategySessionMode } from './session';
import type { MarketRegime, MarketSnapshot } from './indicators';

export interface EngineStrategyConfig {
  symbol: string;
  timeframe: string;
  debugLogging: boolean;
  dayMaxSpreadPoints: number;
  nightMaxSpreadPoints: number;
  stableAtrMultiplier: number;
  momentumBodyAtrMultiplier: number;
  microTpAtrMultiplier: number;
  burstSlAtrMultiplier: number;
  dayPullbackMinPct: number;
  dayPullbackMaxPct: number;
  nightSweepAtrBuffer: number;
  confidenceThreshold: number;
  dayTpMin: number;
  dayTpMax: number;
  daySlMin: number;
  daySlMax: number;
  nightTpMin: number;
  nightTpMax: number;
  nightSlMin: number;
  nightSlMax: number;
  softCooldownFastSeconds: number;
  softCooldownHybridSeconds: number;
  softCooldownPropSeconds: number;
  softOpenTradeLimit: number;
  defaultBurstEntries: number;
  maxBurstEntries: number;
}

export interface EngineTradeControlConfig {
  dailyProfitStopPercent: number;
  dailyDrawdownStopPercent: number;
  maxTradesPerMinute: number;
  maxLossPerBatchPercent: number;
  maxBurstsPerHour: number;
  burstLossStreakLimit: number;
  burstDelayMsMin: number;
  burstDelayMsMax: number;
}

export interface StrategyContext {
  now: string;
  mode: GoldxMode;
  sessionMode: StrategySessionMode;
  session: BrokerSession;
  accountState: GoldxAccountState;
  runtimeState: Required<GoldxRuntimeTradeState>;
  snapshot: MarketSnapshot;
  regime: MarketRegime;
  config: EngineStrategyConfig;
  tradeControl: EngineTradeControlConfig;
}

export interface StrategyCandidate {
  action: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reason: string;
  strategyName: string;
  trend: boolean;
  rangeDetected: boolean;
  spread: number;
  atr: number;
  trendAligned: boolean;
  sweepDetected: boolean;
  bosConfirmed: boolean;
  entriesCount: number;
  lotMultiplier?: number;
  debug: Record<string, unknown>;
}

export interface StrategyEvaluation {
  candidate: StrategyCandidate | null;
  reason: string;
  debug: Record<string, unknown>;
}
