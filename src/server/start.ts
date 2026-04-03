import { DERIV_SCANNER_SYMBOL_IDS } from '../lib/deriv/symbols';
import { startDerivStream } from '../lib/deriv/ws';
import { startLiveLifecycleMonitor } from '../lib/scanner/liveLifecycle';
import { startScanner } from '../lib/scanner/runner';

let started = false;

export function startSystem() {
  if (started) {
    return;
  }

  started = true;
  startDerivStream(DERIV_SCANNER_SYMBOL_IDS);
  startLiveLifecycleMonitor();
  startScanner();
  console.log('[system] market stream and scanner running');
}
