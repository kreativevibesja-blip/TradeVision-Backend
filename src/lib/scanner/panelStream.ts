import type { Response } from 'express';

type ScannerPanelsPayload = {
  results: unknown[];
  potentials: unknown[];
  generatedAt: string;
};

type ScannerPanelsResolver = () => Promise<ScannerPanelsPayload>;

type ScannerPanelClient = {
  id: string;
  res: Response;
  resolvePayload: ScannerPanelsResolver;
};

const clientsByUser = new Map<string, Map<string, ScannerPanelClient>>();
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const REFRESH_DEBOUNCE_MS = 1200;

function sendEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function removeClient(userId: string, clientId: string) {
  const clients = clientsByUser.get(userId);
  if (!clients) {
    return;
  }

  clients.delete(clientId);
  if (clients.size === 0) {
    clientsByUser.delete(userId);
    const existingTimer = refreshTimers.get(userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      refreshTimers.delete(userId);
    }
  }
}

async function pushPanelsToUser(userId: string) {
  const clients = clientsByUser.get(userId);
  if (!clients || clients.size === 0) {
    return;
  }

  const firstClient = clients.values().next().value as ScannerPanelClient | undefined;
  if (!firstClient) {
    return;
  }

  try {
    const payload = await firstClient.resolvePayload();
    for (const client of clients.values()) {
      sendEvent(client.res, 'scanner-panels', payload);
    }
  } catch (error) {
    for (const client of clients.values()) {
      sendEvent(client.res, 'scanner-error', {
        message: error instanceof Error ? error.message : 'Failed to refresh scanner panels',
        generatedAt: new Date().toISOString(),
      });
    }
  }
}

export function registerScannerPanelStream(userId: string, res: Response, resolvePayload: ScannerPanelsResolver) {
  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clients = clientsByUser.get(userId) ?? new Map<string, ScannerPanelClient>();
  clients.set(clientId, { id: clientId, res, resolvePayload });
  clientsByUser.set(userId, clients);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sendEvent(res, 'connected', { ok: true, generatedAt: new Date().toISOString() });
  void pushPanelsToUser(userId);

  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, 25_000);

  const cleanup = () => {
    clearInterval(heartbeat);
    removeClient(userId, clientId);
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);
}

export function scheduleScannerPanelRefreshForUser(userId: string) {
  if (!clientsByUser.has(userId)) {
    return;
  }

  const existingTimer = refreshTimers.get(userId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  refreshTimers.set(
    userId,
    setTimeout(() => {
      refreshTimers.delete(userId);
      void pushPanelsToUser(userId);
    }, REFRESH_DEBOUNCE_MS),
  );
}

export function scheduleScannerPanelRefreshForAllUsers() {
  for (const userId of clientsByUser.keys()) {
    scheduleScannerPanelRefreshForUser(userId);
  }
}