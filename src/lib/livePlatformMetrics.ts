import { getJamaicaDateInputValue } from '../utils/jamaicaTime';

type QueueMetricStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

interface VisitorSessionState {
  lastSeenAtMs: number;
  visitorDate: string;
}

interface LivePlatformMetricsSnapshot {
  currentVisitors: number;
  totalVisitorsToday: number;
  activeAnalyses: number;
  totalAnalysesToday: number;
}

const ACTIVE_VISITOR_WINDOW_MS = 5 * 60 * 1000;
const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_DAY_BUCKETS = 3;

const visitorSessions = new Map<string, VisitorSessionState>();
const dailyVisitorSessions = new Map<string, Set<string>>();
const dailyAnalysisCounts = new Map<string, number>();
const activeQueueJobs = new Map<string, QueueMetricStatus>();

function pruneDailyBuckets<T>(store: Map<string, T>) {
  if (store.size <= MAX_DAY_BUCKETS) {
    return;
  }

  const keys = Array.from(store.keys()).sort();
  while (keys.length > MAX_DAY_BUCKETS) {
    const oldest = keys.shift();
    if (oldest) {
      store.delete(oldest);
    }
  }
}

function pruneVisitorSessions(nowMs: number) {
  for (const [sessionId, state] of visitorSessions.entries()) {
    if (nowMs - state.lastSeenAtMs > SESSION_RETENTION_MS) {
      visitorSessions.delete(sessionId);
    }
  }
}

export function recordVisitorHeartbeat(input: { sessionId: string; visitorDate: string; lastSeenAt?: string }) {
  const lastSeenAtMs = input.lastSeenAt ? new Date(input.lastSeenAt).getTime() : Date.now();
  visitorSessions.set(input.sessionId, {
    lastSeenAtMs,
    visitorDate: input.visitorDate,
  });

  const dailySessions = dailyVisitorSessions.get(input.visitorDate) ?? new Set<string>();
  dailySessions.add(input.sessionId);
  dailyVisitorSessions.set(input.visitorDate, dailySessions);

  pruneVisitorSessions(lastSeenAtMs);
  pruneDailyBuckets(dailyVisitorSessions);
}

export function recordAnalysisCreated(createdAtIso?: string) {
  const dayKey = getJamaicaDateInputValue(createdAtIso ? new Date(createdAtIso) : new Date());
  dailyAnalysisCounts.set(dayKey, (dailyAnalysisCounts.get(dayKey) ?? 0) + 1);
  pruneDailyBuckets(dailyAnalysisCounts);
}

export function recordQueueJobState(jobId: string, status: QueueMetricStatus) {
  if (status === 'queued' || status === 'processing') {
    activeQueueJobs.set(jobId, status);
    return;
  }

  activeQueueJobs.delete(jobId);
}

export function getLivePlatformMetricsSnapshot(todayDate: string, activeSinceIso?: string): LivePlatformMetricsSnapshot {
  const nowMs = Date.now();
  const activeSinceMs = activeSinceIso ? new Date(activeSinceIso).getTime() : nowMs - ACTIVE_VISITOR_WINDOW_MS;

  pruneVisitorSessions(nowMs);
  pruneDailyBuckets(dailyVisitorSessions);
  pruneDailyBuckets(dailyAnalysisCounts);

  let currentVisitors = 0;
  for (const state of visitorSessions.values()) {
    if (state.lastSeenAtMs >= activeSinceMs) {
      currentVisitors += 1;
    }
  }

  return {
    currentVisitors,
    totalVisitorsToday: dailyVisitorSessions.get(todayDate)?.size ?? 0,
    activeAnalyses: activeQueueJobs.size,
    totalAnalysesToday: dailyAnalysisCounts.get(todayDate) ?? 0,
  };
}