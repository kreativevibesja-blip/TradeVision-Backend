type ClientEgressCounts = {
  authRefreshCount: number;
  sessionFetchCount: number;
  listenerCount: number;
  pollingCount: number;
  activeChannels: number;
};

export interface ClientEgressMetricRow extends ClientEgressCounts {
  minute: string;
  userId: string;
  tabId: string;
  route: string;
  lastSeenAt: string;
}

const MAX_BUCKETS = 5000;
const store = new Map<string, ClientEgressMetricRow>();

const getMinuteBucket = (date = new Date()) => date.toISOString().slice(0, 16);

const cleanup = () => {
  if (store.size <= MAX_BUCKETS) {
    return;
  }

  const rows = [...store.entries()].sort((left, right) => left[1].lastSeenAt.localeCompare(right[1].lastSeenAt));
  const deleteCount = store.size - MAX_BUCKETS;

  for (const [key] of rows.slice(0, deleteCount)) {
    store.delete(key);
  }
};

export const recordClientEgressMetric = (input: {
  userId: string;
  tabId: string;
  route: string;
  metrics: ClientEgressCounts;
}) => {
  const minute = getMinuteBucket();
  const key = `${minute}:${input.userId}:${input.tabId}`;
  const existing = store.get(key);

  const nextRow: ClientEgressMetricRow = existing
    ? {
        ...existing,
        route: input.route || existing.route,
        authRefreshCount: existing.authRefreshCount + input.metrics.authRefreshCount,
        sessionFetchCount: existing.sessionFetchCount + input.metrics.sessionFetchCount,
        listenerCount: Math.max(existing.listenerCount, input.metrics.listenerCount),
        pollingCount: Math.max(existing.pollingCount, input.metrics.pollingCount),
        activeChannels: Math.max(existing.activeChannels, input.metrics.activeChannels),
        lastSeenAt: new Date().toISOString(),
      }
    : {
        minute,
        userId: input.userId,
        tabId: input.tabId,
        route: input.route,
        authRefreshCount: input.metrics.authRefreshCount,
        sessionFetchCount: input.metrics.sessionFetchCount,
        listenerCount: input.metrics.listenerCount,
        pollingCount: input.metrics.pollingCount,
        activeChannels: input.metrics.activeChannels,
        lastSeenAt: new Date().toISOString(),
      };

  store.set(key, nextRow);
  cleanup();

  console.info('[client-egress]', nextRow);
  return nextRow;
};

export const listClientEgressMetrics = (limit = 250) =>
  [...store.values()]
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    .slice(0, Math.max(1, Math.min(limit, 1000)));
