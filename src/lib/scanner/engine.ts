import { supabase } from '../../lib/supabase';
import {
  runSessionScanner as runUserSessionScanner,
  checkPotentialTradeAlerts,
  getCurrentSessionTypes,
} from '../../services/scannerService';

const SCANNER_SESSION_TABLE = 'ScannerSession';
const SCAN_RESULT_TABLE = 'ScanResult';
const USER_TABLE = 'User';

type ScannerUserRow = {
  id: string;
  subscription: string;
  banned: boolean;
};

async function getEligibleScannerUserIds(): Promise<string[]> {
  const [sessionRowsResult, openTradeRowsResult] = await Promise.all([
    supabase
      .from(SCANNER_SESSION_TABLE)
      .select('userId')
      .eq('isActive', true),
    supabase
      .from(SCAN_RESULT_TABLE)
      .select('userId')
      .in('status', ['active', 'triggered']),
  ]);

  if (sessionRowsResult.error) throw new Error(sessionRowsResult.error.message);
  if (openTradeRowsResult.error) throw new Error(openTradeRowsResult.error.message);

  const userIds = new Set<string>();

  for (const row of sessionRowsResult.data ?? []) {
    if (typeof row.userId === 'string' && row.userId) userIds.add(row.userId);
  }

  for (const row of openTradeRowsResult.data ?? []) {
    if (typeof row.userId === 'string' && row.userId) userIds.add(row.userId);
  }

  return Array.from(userIds);
}

async function getEligibleUsers(): Promise<ScannerUserRow[]> {
  const userIds = await getEligibleScannerUserIds();
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from(USER_TABLE)
    .select('id, subscription, banned')
    .in('id', userIds)
    .eq('subscription', 'TOP_TIER')
    .eq('banned', false);

  if (error) throw new Error(error.message);
  return (data ?? []) as ScannerUserRow[];
}

export async function runSessionScanner(): Promise<void> {
  const activeWindows = getCurrentSessionTypes();
  console.log(`[scanner-engine] tick started | active windows: ${activeWindows.join(', ') || 'none'}`);

  const users = await getEligibleUsers();
  console.log(`[scanner-engine] eligible users: ${users.length}`);

  if (users.length === 0) {
    return;
  }

  for (const user of users) {
    try {
      const { results, alerts } = await runUserSessionScanner(user.id);
      const potentialAlerts = await checkPotentialTradeAlerts(user.id);

      console.log(
        `[scanner-engine] user ${user.id} | new signals: ${results.length} | new alerts: ${alerts.length} | potential alerts: ${potentialAlerts.length}`,
      );
    } catch (error) {
      console.error(`[scanner-engine] user ${user.id} tick failed:`, error);
    }
  }
}