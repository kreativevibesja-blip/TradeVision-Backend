// ============================================================
// GoldX — License Service
// ============================================================

import { supabase } from '../../lib/supabase';
import {
  hashLicenseKey,
  generateLicenseKey,
  generateSessionToken,
  hashSessionToken,
  verifyHmac,
  isTimestampValid,
} from './crypto';
import type {
  GoldxLicense,
  GoldxLicenseSession,
  GoldxAccountState,
  GoldxSubscription,
  GoldxAuditLog,
  GoldxTradeHistory,
  GoldxPlan,
  GoldxVerifyRequest,
  GoldxVerifyResponse,
  GoldxMode,
  GoldxModeConfig,
} from './types';

const SESSION_TTL_MINUTES = 10;
const USED_NONCES = new Map<string, number>();

// Clean nonces older than 10 minutes every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [nonce, ts] of USED_NONCES) {
    if (ts < cutoff) USED_NONCES.delete(nonce);
  }
}, 5 * 60 * 1000);

// ── DB Helpers ──────────────────────────────────────────────

const snakeToCamel = (row: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = value;
  }
  return result;
};

async function getLicenseByHash(hash: string): Promise<GoldxLicense | null> {
  const { data, error } = await supabase
    .from('goldx_licenses')
    .select('*')
    .eq('license_hash', hash)
    .single();
  if (error || !data) return null;
  return snakeToCamel(data) as unknown as GoldxLicense;
}

async function getLicensesByUser(userId: string): Promise<GoldxLicense[]> {
  const { data, error } = await supabase
    .from('goldx_licenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((r: Record<string, unknown>) => snakeToCamel(r) as unknown as GoldxLicense);
}

async function createLicense(userId: string, expiresAt: string): Promise<{ license: GoldxLicense; rawKey: string }> {
  const rawKey = generateLicenseKey();
  const licenseHash = hashLicenseKey(rawKey);

  const { data, error } = await supabase
    .from('goldx_licenses')
    .insert({
      user_id: userId,
      license_hash: licenseHash,
      status: 'active',
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create license: ${error.message}`);
  return { license: snakeToCamel(data) as unknown as GoldxLicense, rawKey };
}

async function updateLicense(id: string, updates: Partial<Record<string, unknown>>): Promise<void> {
  const snakeUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    snakeUpdates[snakeKey] = value;
  }
  snakeUpdates['updated_at'] = new Date().toISOString();

  const { error } = await supabase
    .from('goldx_licenses')
    .update(snakeUpdates)
    .eq('id', id);
  if (error) throw new Error(`Failed to update license: ${error.message}`);
}

async function createSession(licenseId: string, ip: string | null): Promise<{ token: string; expiresAt: string }> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('goldx_license_sessions')
    .insert({
      license_id: licenseId,
      session_token_hash: tokenHash,
      ip_address: ip,
      expires_at: expiresAt,
    });
  if (error) throw new Error(`Failed to create session: ${error.message}`);

  return { token, expiresAt };
}

async function getSessionByTokenHash(tokenHash: string): Promise<(GoldxLicenseSession & { license: GoldxLicense }) | null> {
  const { data, error } = await supabase
    .from('goldx_license_sessions')
    .select('*, goldx_licenses(*)')
    .eq('session_token_hash', tokenHash)
    .single();
  if (error || !data) return null;

  const session = snakeToCamel(data) as unknown as GoldxLicenseSession & { goldx_licenses: Record<string, unknown> };
  const licenseRaw = (data as Record<string, unknown>).goldx_licenses as Record<string, unknown>;
  return {
    ...session,
    license: snakeToCamel(licenseRaw) as unknown as GoldxLicense,
  } as GoldxLicenseSession & { license: GoldxLicense };
}

async function cleanExpiredSessions(): Promise<void> {
  await supabase
    .from('goldx_license_sessions')
    .delete()
    .lt('expires_at', new Date().toISOString());
}

// ── Account State ───────────────────────────────────────────

async function getOrCreateAccountState(
  licenseId: string,
  mt5Account: string,
  mode: GoldxMode = 'hybrid',
): Promise<GoldxAccountState> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from('goldx_account_state')
    .select('*')
    .eq('license_id', licenseId)
    .eq('mt5_account', mt5Account)
    .single();

  if (existing) {
    const state = snakeToCamel(existing) as unknown as GoldxAccountState;
    // Reset daily counters if new day
    if (state.resetDate !== today) {
      const { data: updated } = await supabase
        .from('goldx_account_state')
        .update({
          trades_today: 0,
          profit_today: 0,
          drawdown_today: 0,
          reset_date: today,
          updated_at: new Date().toISOString(),
        })
        .eq('id', state.id)
        .select()
        .single();
      if (updated) return snakeToCamel(updated) as unknown as GoldxAccountState;
    }
    return state;
  }

  const { data: created, error } = await supabase
    .from('goldx_account_state')
    .insert({
      license_id: licenseId,
      mt5_account: mt5Account,
      mode,
      reset_date: today,
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create account state: ${error.message}`);
  return snakeToCamel(created) as unknown as GoldxAccountState;
}

async function updateAccountState(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const snakeUpdates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    snakeUpdates[snakeKey] = value;
  }
  snakeUpdates['updated_at'] = new Date().toISOString();

  await supabase.from('goldx_account_state').update(snakeUpdates).eq('id', id);
}

// ── Audit ───────────────────────────────────────────────────

async function insertAuditLog(
  event: string,
  opts: { licenseId?: string; userId?: string; ip?: string; meta?: Record<string, unknown> } = {},
): Promise<void> {
  await supabase.from('goldx_audit_logs').insert({
    license_id: opts.licenseId ?? null,
    user_id: opts.userId ?? null,
    event,
    ip_address: opts.ip ?? null,
    meta: opts.meta ?? {},
  });
}

// ── Mode Config ─────────────────────────────────────────────

async function getModeConfig(mode: GoldxMode): Promise<GoldxModeConfig> {
  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', 'modes')
    .single();

  const defaults: Record<GoldxMode, GoldxModeConfig> = {
    fast: { riskPercent: 2.0, maxTrades: 6, filterStrictness: 'loose' },
    prop: { riskPercent: 0.5, maxTrades: 3, filterStrictness: 'strict' },
    hybrid: { riskPercent: 1.0, maxTrades: 4, filterStrictness: 'normal' },
  };

  if (!data?.value) return defaults[mode];
  const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  return parsed[mode] ?? defaults[mode];
}

// ── Core: License Verification ──────────────────────────────

export async function verifyLicense(
  req: GoldxVerifyRequest,
  signature: string,
  ip: string | null,
): Promise<GoldxVerifyResponse> {
  // 1. Anti-replay: check timestamp
  if (!isTimestampValid(req.timestamp)) {
    await insertAuditLog('verify_rejected_replay', { ip: ip ?? undefined, meta: { reason: 'timestamp' } });
    return { valid: false, error: 'Request expired or clock skew too large' };
  }

  // 2. Anti-replay: check nonce
  if (USED_NONCES.has(req.nonce)) {
    await insertAuditLog('verify_rejected_replay', { ip: ip ?? undefined, meta: { reason: 'nonce' } });
    return { valid: false, error: 'Duplicate request' };
  }
  USED_NONCES.set(req.nonce, Date.now());

  // 3. Verify HMAC signature
  const payload = `${req.licenseKey}:${req.mt5Account}:${req.deviceId}:${req.timestamp}:${req.nonce}`;
  if (!verifyHmac(payload, signature)) {
    await insertAuditLog('verify_rejected_hmac', { ip: ip ?? undefined, meta: { mt5Account: req.mt5Account } });
    return { valid: false, error: 'Invalid signature' };
  }

  // 4. Look up license
  const licenseHash = hashLicenseKey(req.licenseKey);
  const license = await getLicenseByHash(licenseHash);
  if (!license) {
    await insertAuditLog('verify_rejected_notfound', { ip: ip ?? undefined });
    return { valid: false, error: 'License not found' };
  }

  // 5. Check status
  if (license.status !== 'active') {
    await insertAuditLog('verify_rejected_status', { licenseId: license.id, ip: ip ?? undefined, meta: { status: license.status } });
    return { valid: false, error: `License ${license.status}` };
  }

  // 6. Check expiry
  if (new Date(license.expiresAt) < new Date()) {
    await updateLicense(license.id, { status: 'expired' });
    await insertAuditLog('license_expired', { licenseId: license.id, ip: ip ?? undefined });
    return { valid: false, error: 'License expired' };
  }

  // 7. Bind MT5 account (first time) or verify match
  if (!license.mt5Account) {
    await updateLicense(license.id, { mt5Account: req.mt5Account, deviceId: req.deviceId });
  } else if (license.mt5Account !== req.mt5Account) {
    await insertAuditLog('verify_rejected_account_mismatch', {
      licenseId: license.id,
      ip: ip ?? undefined,
      meta: { expected: license.mt5Account, received: req.mt5Account },
    });
    return { valid: false, error: 'License bound to a different MT5 account' };
  }

  // 8. Update last checked
  await updateLicense(license.id, { lastCheckedAt: new Date().toISOString() });

  // 9. Issue session token
  const session = await createSession(license.id, ip);

  // 10. Get account state for mode config
  const accountState = await getOrCreateAccountState(license.id, req.mt5Account);
  const modeConfig = await getModeConfig(accountState.mode);

  await insertAuditLog('verify_success', {
    licenseId: license.id,
    userId: license.userId,
    ip: ip ?? undefined,
    meta: { mt5Account: req.mt5Account, mode: accountState.mode },
  });

  return {
    valid: true,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    maxTradesPerDay: modeConfig.maxTrades,
    mode: accountState.mode,
  };
}

// ── Core: Session Validation ────────────────────────────────

export async function validateSession(
  sessionToken: string,
): Promise<{ valid: boolean; license?: GoldxLicense; accountState?: GoldxAccountState; error?: string }> {
  const tokenHash = hashSessionToken(sessionToken);
  const session = await getSessionByTokenHash(tokenHash);

  if (!session) {
    return { valid: false, error: 'Invalid session' };
  }

  if (new Date(session.expiresAt) < new Date()) {
    return { valid: false, error: 'Session expired' };
  }

  if (session.license.status !== 'active') {
    return { valid: false, error: 'License not active' };
  }

  const accountState = session.license.mt5Account
    ? await getOrCreateAccountState(session.license.id, session.license.mt5Account)
    : undefined;

  return { valid: true, license: session.license, accountState };
}

// ── Subscription → License Flow ─────────────────────────────

export async function createSubscriptionAndLicense(
  userId: string,
  planId: string,
  paypalOrderId: string | null,
): Promise<{ subscriptionId: string; rawLicenseKey: string }> {
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  // Create subscription
  const { data: sub, error: subErr } = await supabase
    .from('goldx_subscriptions')
    .insert({
      user_id: userId,
      plan_id: planId,
      status: 'active',
      paypal_order_id: paypalOrderId,
      current_period_end: periodEnd,
    })
    .select()
    .single();
  if (subErr) throw new Error(`Failed to create subscription: ${subErr.message}`);

  // Create license
  const { rawKey } = await createLicense(userId, periodEnd);

  await insertAuditLog('subscription_created', {
    userId,
    meta: { planId, subscriptionId: sub.id },
  });

  return { subscriptionId: sub.id, rawLicenseKey: rawKey };
}

export async function ensureAdminGoldxAccess(
  userId: string,
): Promise<{ created: boolean; rawLicenseKey: string | null }> {
  const [plan, activeSubscription, activeLicense] = await Promise.all([
    getGoldxPlan(),
    getUserSubscription(userId),
    getUserLicense(userId),
  ]);

  if (!plan) {
    throw new Error('No active GoldX plan');
  }

  if (activeSubscription && activeLicense) {
    return { created: false, rawLicenseKey: null };
  }

  let createdLicenseKey: string | null = null;
  const periodEnd = activeSubscription?.currentPeriodEnd
    ?? activeLicense?.expiresAt
    ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (!activeSubscription) {
    const { error } = await supabase
      .from('goldx_subscriptions')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        status: 'active',
        paypal_order_id: 'admin-grant',
        current_period_end: periodEnd,
      });

    if (error) {
      throw new Error(`Failed to provision admin subscription: ${error.message}`);
    }
  }

  if (!activeLicense) {
    const { rawKey } = await createLicense(userId, periodEnd);
    createdLicenseKey = rawKey;
  }

  await insertAuditLog(createdLicenseKey ? 'admin_access_provisioned' : 'admin_access_synced', {
    userId,
    meta: { planId: plan.id },
  });

  return {
    created: !activeSubscription || !activeLicense,
    rawLicenseKey: createdLicenseKey,
  };
}

export async function adminGrantGoldxAccess(
  userId: string,
  adminUserId: string,
): Promise<{ created: boolean; rawLicenseKey: string | null }> {
  const [plan, activeSubscription, activeLicense] = await Promise.all([
    getGoldxPlan(),
    getUserSubscription(userId),
    getUserLicense(userId),
  ]);

  if (!plan) {
    throw new Error('No active GoldX plan');
  }

  if (activeSubscription && activeLicense) {
    await insertAuditLog('admin_goldx_access_checked', {
      userId: adminUserId,
      meta: { targetUserId: userId, planId: plan.id, created: false },
    });
    return { created: false, rawLicenseKey: null };
  }

  let createdLicenseKey: string | null = null;
  const periodEnd = activeSubscription?.currentPeriodEnd
    ?? activeLicense?.expiresAt
    ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (!activeSubscription) {
    const { error } = await supabase
      .from('goldx_subscriptions')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        status: 'active',
        paypal_order_id: `admin-grant:${adminUserId}`,
        current_period_end: periodEnd,
      });

    if (error) {
      throw new Error(`Failed to grant GoldX subscription: ${error.message}`);
    }
  }

  if (!activeLicense) {
    const { rawKey } = await createLicense(userId, periodEnd);
    createdLicenseKey = rawKey;
  }

  await insertAuditLog(createdLicenseKey ? 'admin_goldx_access_granted' : 'admin_goldx_access_synced', {
    userId: adminUserId,
    meta: { targetUserId: userId, planId: plan.id },
  });

  return {
    created: !activeSubscription || !activeLicense,
    rawLicenseKey: createdLicenseKey,
  };
}

// ── Expiry / Cancellation ───────────────────────────────────

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  const { data: sub } = await supabase
    .from('goldx_subscriptions')
    .select('user_id, current_period_end')
    .eq('id', subscriptionId)
    .single();

  await supabase
    .from('goldx_subscriptions')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriptionId);

  if (sub?.user_id) {
    const licenses = await getLicensesByUser(sub.user_id);
    for (const lic of licenses) {
      if (lic.status === 'active') {
        await updateLicense(lic.id, {
          expiresAt: sub.current_period_end ?? lic.expiresAt,
          status: new Date(lic.expiresAt) < new Date() ? 'expired' : 'active',
        });
      }
    }
    await insertAuditLog('subscription_cancelled', { userId: sub.user_id, meta: { subscriptionId } });
  }
}

export async function expireOverdueLicenses(): Promise<number> {
  const { data: expired } = await supabase
    .from('goldx_licenses')
    .select('id, user_id')
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString());

  if (!expired?.length) return 0;

  for (const lic of expired) {
    await supabase
      .from('goldx_licenses')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', lic.id);
    await insertAuditLog('license_auto_expired', { licenseId: lic.id, userId: lic.user_id });
  }

  return expired.length;
}

// ── Admin Operations ────────────────────────────────────────

export async function adminGetAllLicenses(): Promise<GoldxLicense[]> {
  const { data } = await supabase
    .from('goldx_licenses')
    .select('*')
    .order('created_at', { ascending: false });
  return (data ?? []).map((r: Record<string, unknown>) => snakeToCamel(r) as unknown as GoldxLicense);
}

export async function adminGetAllSubscriptions(): Promise<GoldxSubscription[]> {
  const { data } = await supabase
    .from('goldx_subscriptions')
    .select('*')
    .order('created_at', { ascending: false });
  return (data ?? []).map((r: Record<string, unknown>) => snakeToCamel(r) as unknown as GoldxSubscription);
}

export async function adminRevokeLicense(licenseId: string, adminUserId: string): Promise<void> {
  await updateLicense(licenseId, { status: 'revoked' });
  await insertAuditLog('license_revoked', { licenseId, userId: adminUserId });
}

export async function adminExtendLicense(licenseId: string, days: number, adminUserId: string): Promise<void> {
  const { data: lic } = await supabase
    .from('goldx_licenses')
    .select('expires_at')
    .eq('id', licenseId)
    .single();
  if (!lic) throw new Error('License not found');

  const currentExpiry = new Date(lic.expires_at);
  const base = currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

  await updateLicense(licenseId, { expiresAt: newExpiry, status: 'active' });
  await insertAuditLog('license_extended', { licenseId, userId: adminUserId, meta: { days, newExpiry } });
}

export async function adminGetAuditLogs(
  limit = 100,
  offset = 0,
): Promise<GoldxAuditLog[]> {
  const { data } = await supabase
    .from('goldx_audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return (data ?? []).map((r: Record<string, unknown>) => snakeToCamel(r) as unknown as GoldxAuditLog);
}

export async function adminGetDashboardStats(): Promise<Record<string, unknown>> {
  const [
    { count: totalLicenses },
    { count: activeLicenses },
    { count: totalSubs },
    { count: activeSubs },
  ] = await Promise.all([
    supabase.from('goldx_licenses').select('*', { count: 'exact', head: true }),
    supabase.from('goldx_licenses').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('goldx_subscriptions').select('*', { count: 'exact', head: true }),
    supabase.from('goldx_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  return {
    totalLicenses: totalLicenses ?? 0,
    activeLicenses: activeLicenses ?? 0,
    totalSubscriptions: totalSubs ?? 0,
    activeSubscriptions: activeSubs ?? 0,
  };
}

export async function adminUpdateSettings(
  key: string,
  value: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('goldx_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
}

export async function adminGetSettings(): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from('goldx_settings')
    .select('key, value');
  const result: Record<string, unknown> = {};
  for (const row of data ?? []) {
    result[(row as Record<string, unknown>).key as string] = (row as Record<string, unknown>).value;
  }
  return result;
}

export async function adminGetTradeHistory(limit = 100, offset = 0): Promise<GoldxTradeHistory[]> {
  const { data } = await supabase
    .from('goldx_trade_history')
    .select('*')
    .order('opened_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return (data ?? []).map((r: Record<string, unknown>) => snakeToCamel(r) as unknown as GoldxTradeHistory);
}

// ── User Operations ─────────────────────────────────────────

export async function getUserSubscription(userId: string): Promise<GoldxSubscription | null> {
  const { data } = await supabase
    .from('goldx_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .in('status', ['active', 'cancelled', 'past_due'])
    .order('created_at', { ascending: false })
    .limit(5);
  const rows = (data ?? []) as Record<string, unknown>[];
  if (!rows.length) return null;

  const now = new Date();
  const currentSub = rows
    .map((row) => snakeToCamel(row) as unknown as GoldxSubscription)
    .find((sub) => new Date(sub.currentPeriodEnd) >= now);

  if (currentSub) {
    return currentSub;
  }

  return null;
}

export async function getUserLicense(userId: string): Promise<GoldxLicense | null> {
  const { data } = await supabase
    .from('goldx_licenses')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!data) return null;
  return snakeToCamel(data) as unknown as GoldxLicense;
}

export async function getUserAccountState(userId: string): Promise<GoldxAccountState | null> {
  const license = await getUserLicense(userId);
  if (!license?.mt5Account) return null;
  return getOrCreateAccountState(license.id, license.mt5Account);
}

export async function setUserMode(userId: string, mode: GoldxMode): Promise<void> {
  const license = await getUserLicense(userId);
  if (!license) throw new Error('No active license');
  if (!license.mt5Account) throw new Error('No MT5 account bound');
  await updateAccountState(
    (await getOrCreateAccountState(license.id, license.mt5Account)).id,
    { mode },
  );
}

export async function getGoldxPlan(): Promise<GoldxPlan | null> {
  const { data } = await supabase
    .from('goldx_plans')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .single();
  if (!data) return null;
  return snakeToCamel(data) as unknown as GoldxPlan;
}

// Re-exports for convenience
export {
  getLicensesByUser,
  getOrCreateAccountState,
  getModeConfig,
  insertAuditLog,
  cleanExpiredSessions,
};
