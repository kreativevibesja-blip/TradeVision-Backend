import type { GoldxSessionMode, GoldxSessionStatus } from './types';

export type BrokerSession = 'day' | 'night' | 'inactive';
export type StrategySessionMode = 'day' | 'night' | 'hybrid' | 'all_sessions';

export function normalizeSessionMode(sessionMode: GoldxSessionMode | undefined | null): StrategySessionMode {
  if (sessionMode === 'all' || sessionMode === 'all_sessions') return 'all_sessions';
  if (sessionMode === 'day' || sessionMode === 'night' || sessionMode === 'hybrid') return sessionMode;
  return 'hybrid';
}

export function getSessionType(now: Date = new Date()): BrokerSession {
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (minutes >= 13 * 60 && minutes < 22 * 60) return 'day';
  if (minutes >= 0 && minutes < 6 * 60) return 'night';
  return 'inactive';
}

export function resolveAllowedSession(sessionMode: StrategySessionMode, brokerSession: BrokerSession): BrokerSession {
  if (sessionMode === 'day') return brokerSession === 'day' ? 'day' : 'inactive';
  if (sessionMode === 'night') return brokerSession === 'night' ? 'night' : 'inactive';
  if (sessionMode === 'hybrid') return brokerSession;
  return brokerSession === 'inactive' ? 'inactive' : brokerSession;
}

export function toSessionStatus(session: BrokerSession): GoldxSessionStatus {
  if (session === 'day') return 'day';
  if (session === 'night') return 'night';
  return 'closed';
}
