import { runSessionScanner } from './engine';

const SCANNER_INTERVAL_MS = 15_000;

let scannerTimer: ReturnType<typeof setInterval> | null = null;
let scannerTickInFlight = false;

async function tick() {
  if (scannerTickInFlight) {
    console.log('[scanner-runner] skipping tick because previous scanner pass is still running');
    return;
  }

  scannerTickInFlight = true;

  try {
    await runSessionScanner();
  } catch (error) {
    console.error('[scanner-runner] tick failed:', error);
  } finally {
    scannerTickInFlight = false;
  }
}

export function startScanner() {
  if (scannerTimer) {
    return;
  }

  console.log(`[scanner-runner] started (poll every ${SCANNER_INTERVAL_MS}ms)`);
  void tick();
  scannerTimer = setInterval(() => {
    void tick();
  }, SCANNER_INTERVAL_MS);
}

export function stopScanner() {
  if (!scannerTimer) {
    return;
  }

  clearInterval(scannerTimer);
  scannerTimer = null;
  console.log('[scanner-runner] stopped');
}