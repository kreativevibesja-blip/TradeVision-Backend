// ============================================================
// GoldX — Shared Types
// ============================================================

export type GoldxMode = 'fast' | 'prop' | 'hybrid';
export type GoldxSessionMode = 'night' | 'day' | 'hybrid' | 'all';
export type GoldxLicenseStatus = 'active' | 'expired' | 'revoked';
export type GoldxSubscriptionStatus = 'active' | 'cancelled' | 'expired' | 'past_due';
export type GoldxTradeDirection = 'buy' | 'sell';
export type GoldxTradeOutcome = 'tp' | 'sl' | 'be' | 'manual';
export type GoldxFilterStrictness = 'loose' | 'normal' | 'strict';
export type GoldxSessionStatus = 'day' | 'night' | 'asian' | 'london' | 'newYork' | 'closed';

export interface GoldxPlan {
  id: string;
  name: string;
  price: number;
  billingCycle: string;
  features: string[];
  isActive: boolean;
  createdAt: string;
}

export interface GoldxSubscription {
  id: string;
  userId: string;
  planId: string;
  status: GoldxSubscriptionStatus;
  paypalOrderId: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelledAt: string | null;
  createdAt: string;
}

export interface GoldxLicense {
  id: string;
  userId: string;
  licenseHash: string;
  mt5Account: string | null;
  deviceId: string | null;
  status: GoldxLicenseStatus;
  expiresAt: string;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface GoldxLicenseSession {
  id: string;
  licenseId: string;
  sessionTokenHash: string;
  ipAddress: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface GoldxAccountState {
  id: string;
  licenseId: string;
  mt5Account: string;
  mode: GoldxMode;
  sessionMode: GoldxSessionMode;
  tradesToday: number;
  profitToday: number;
  drawdownToday: number;
  lastTradeAt: string | null;
  resetDate: string;
}

export interface GoldxAuditLog {
  id: string;
  licenseId: string | null;
  userId: string | null;
  event: string;
  ipAddress: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface GoldxTradeHistory {
  id: string;
  licenseId: string;
  mt5Account: string;
  symbol: string;
  direction: GoldxTradeDirection;
  entryPrice: number | null;
  slPrice: number | null;
  tpPrice: number | null;
  lotSize: number | null;
  mode: GoldxMode;
  outcome: GoldxTradeOutcome | null;
  profit: number | null;
  openedAt: string;
  closedAt: string | null;
}

export interface GoldxModeConfig {
  riskPercent: number;
  maxTrades: number;
  filterStrictness: GoldxFilterStrictness;
}

export interface GoldxStrategyConfig {
  symbol: string;
  timeframe: string;
  sessionStart: string;
  sessionEnd: string;
  lastEntryTime: string;
  rangeLookbackMinutes: [number, number];
  atrMaxMultiplier: number;
  maxSpreadPoints: number;
  cooldownMinutes: number;
}

export interface GoldxTradeControlConfig {
  cooldownMinutes: number;
  dailyProfitStopPercent: number;
  dailyDrawdownStopPercent: number;
}

export interface GoldxSessionWindow {
  start: number;
  end: number;
}

export interface GoldxSessionSettings {
  daySession: GoldxSessionWindow;
  nightSession: GoldxSessionWindow;
  asianSession: GoldxSessionWindow;
  londonSession: GoldxSessionWindow;
  newYorkSession: GoldxSessionWindow;
  dayTradingEnabled?: boolean;
  asianTradingEnabled?: boolean;
  londonTradingEnabled?: boolean;
  newYorkTradingEnabled?: boolean;
}

export interface GoldxSignal {
  action: 'buy' | 'sell' | 'none';
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lotSize: number | null;
  confidence: number;
  reason: string;
  mode: GoldxMode;
  timestamp: string;
  sessionType?: GoldxSessionStatus;
  strategyName?: string;
  sweepDetected?: boolean;
  bosConfirmed?: boolean;
  trendAligned?: boolean;
}

export type GoldxSetupRequestStatus = 'pending' | 'in_progress' | 'completed';

export interface GoldxOnboardingState {
  userId: string;
  hasDownloadedEa: boolean;
  hasConnectedMt5: boolean;
  setupCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoldxSetupRequest {
  id: string;
  userId: string;
  mt5Login: string;
  server: string;
  email: string;
  note: string | null;
  status: GoldxSetupRequestStatus;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoldxMaskedSetupRequest {
  id: string;
  userId: string;
  mt5LoginMasked: string;
  server: string;
  emailMasked: string;
  notePreview: string | null;
  status: GoldxSetupRequestStatus;
  internalNotesPreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoldxVerifyRequest {
  licenseKey: string;
  mt5Account: string;
  deviceId: string;
  timestamp: number;
  nonce: string;
}

export interface GoldxVerifyResponse {
  valid: boolean;
  sessionToken?: string;
  expiresAt?: string;
  maxTradesPerDay?: number;
  mode?: GoldxMode;
  error?: string;
  debug?: {
    boundAccount: string;
    licenseId: string;
  };
}
