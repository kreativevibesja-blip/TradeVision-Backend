// ============================================================
// GoldX — License Service
// ============================================================

import { supabase } from '../../lib/supabase';
import {
  hashLicenseKey,
  generateLicenseKey,
  generateSessionToken,
  hashSessionToken,
  computeHmac,
  verifyHmac,
  isTimestampValid,
  aesEncrypt,
  aesDecrypt,
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
  GoldxSessionMode,
  GoldxModeConfig,
  GoldxOnboardingState,
  GoldxSetupRequest,
  GoldxMaskedSetupRequest,
  GoldxSetupRequestStatus,
} from './types';

const SESSION_TTL_MINUTES = 10;
const DEBUG_MODE = process.env.DEBUG_LICENSE === 'true';
const SKIP_HMAC = process.env.SKIP_HMAC === 'true';
const USED_NONCES = new Map<string, number>();

function logVerifyDebug(...args: unknown[]) {
  if (DEBUG_MODE) {
    console.log(...args);
  }
}

function buildHmacPayloadCandidates(req: GoldxVerifyRequest): string[] {
  const trimmedLicenseKey = req.licenseKey.trim();
  const trimmedAccount = req.mt5Account.trim();
  const trimmedDeviceId = req.deviceId.trim();
  const trimmedNonce = req.nonce.trim();
  const timestampMs = req.timestamp < 1e12 ? req.timestamp * 1000 : req.timestamp;
  const timestampSec = req.timestamp < 1e12 ? req.timestamp : Math.trunc(req.timestamp / 1000);

  return Array.from(new Set([
    `${req.licenseKey}:${req.mt5Account}:${req.deviceId}:${req.timestamp}:${req.nonce}`,
    `${trimmedLicenseKey}:${trimmedAccount}:${trimmedDeviceId}:${req.timestamp}:${trimmedNonce}`,
    `${trimmedLicenseKey}:${trimmedAccount}:${trimmedDeviceId}:${timestampSec}:${trimmedNonce}`,
    `${trimmedLicenseKey}:${trimmedAccount}:${trimmedDeviceId}:${timestampMs}:${trimmedNonce}`,
  ]));
}

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

export async function getLicenseByHash(hash: string): Promise<GoldxLicense | null> {
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
    if (
      !state.sessionMode
      || state.maxSimultaneousTrades == null
      || state.currentOpenTrades == null
      || state.dailyTargetPercent == null
      || state.burstActive == null
      || state.burstTradesOpened == null
      || state.maxBurstTrades == null
    ) {
      const { data: updatedWithSession } = await supabase
        .from('goldx_account_state')
        .update({
          session_mode: state.sessionMode ?? 'hybrid',
          max_simultaneous_trades: state.maxSimultaneousTrades ?? 10,
          current_open_trades: state.currentOpenTrades ?? 0,
          daily_target_percent: state.dailyTargetPercent ?? 3,
          burst_active: state.burstActive ?? false,
          burst_trades_opened: state.burstTradesOpened ?? 0,
          max_burst_trades: state.maxBurstTrades ?? 10,
          updated_at: new Date().toISOString(),
        })
        .eq('id', state.id)
        .select()
        .single();
      if (updatedWithSession) {
        return snakeToCamel(updatedWithSession) as unknown as GoldxAccountState;
      }
    }
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
      session_mode: 'hybrid',
      max_simultaneous_trades: 10,
      current_open_trades: 0,
      daily_target_percent: 3,
      burst_active: false,
      burst_trades_opened: 0,
      max_burst_trades: 10,
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

async function setPendingDashboardGrant(
  userId: string,
  payload: { licenseKey: string; issuedAt: string; expiresAt: string },
): Promise<void> {
  await supabase
    .from('goldx_settings')
    .upsert({
      key: `dashboard_grant:${userId}`,
      value: {
        licenseKey: aesEncrypt(payload.licenseKey),
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
      },
      updated_at: new Date().toISOString(),
    });
}

export async function consumePendingDashboardGrant(
  userId: string,
): Promise<{ licenseKey: string; issuedAt: string; expiresAt: string } | null> {
  const settingKey = `dashboard_grant:${userId}`;
  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', settingKey)
    .maybeSingle();

  const rawValue = data?.value;
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const value = rawValue as Record<string, unknown>;
  if (typeof value.licenseKey !== 'string' || typeof value.issuedAt !== 'string' || typeof value.expiresAt !== 'string') {
    return null;
  }

  await supabase
    .from('goldx_settings')
    .delete()
    .eq('key', settingKey);

  return {
    licenseKey: aesDecrypt(value.licenseKey),
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

function maskValue(value: string, visibleStart = 2, visibleEnd = 2): string {
  if (!value) return '';
  if (value.length <= visibleStart + visibleEnd) return '*'.repeat(value.length);
  return `${value.slice(0, visibleStart)}${'*'.repeat(Math.max(3, value.length - visibleStart - visibleEnd))}${value.slice(-visibleEnd)}`;
}

function maskEmail(value: string): string {
  const [localPart, domain] = value.split('@');
  if (!localPart || !domain) return maskValue(value, 2, 0);
  return `${maskValue(localPart, 1, 1)}@${domain}`;
}

export async function getOrCreateOnboardingState(userId: string): Promise<GoldxOnboardingState> {
  const { data: existing } = await supabase
    .from('goldx_onboarding_state')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    return snakeToCamel(existing) as unknown as GoldxOnboardingState;
  }

  const { data, error } = await supabase
    .from('goldx_onboarding_state')
    .insert({ user_id: userId })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create onboarding state: ${error?.message ?? 'Unknown error'}`);
  }

  return snakeToCamel(data) as unknown as GoldxOnboardingState;
}

export async function updateOnboardingState(
  userId: string,
  updates: Partial<Pick<GoldxOnboardingState, 'hasDownloadedEa' | 'hasConnectedMt5' | 'setupCompleted'>>,
): Promise<GoldxOnboardingState> {
  await getOrCreateOnboardingState(userId);

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.hasDownloadedEa === 'boolean') payload.has_downloaded_ea = updates.hasDownloadedEa;
  if (typeof updates.hasConnectedMt5 === 'boolean') payload.has_connected_mt5 = updates.hasConnectedMt5;
  if (typeof updates.setupCompleted === 'boolean') payload.setup_completed = updates.setupCompleted;

  const { data, error } = await supabase
    .from('goldx_onboarding_state')
    .update(payload)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update onboarding state: ${error?.message ?? 'Unknown error'}`);
  }

  return snakeToCamel(data) as unknown as GoldxOnboardingState;
}

export async function getOnboardingState(userId: string): Promise<GoldxOnboardingState> {
  return getOrCreateOnboardingState(userId);
}

export async function markOnboardingStateByLicenseId(
  licenseId: string,
  updates: Partial<Pick<GoldxOnboardingState, 'hasDownloadedEa' | 'hasConnectedMt5' | 'setupCompleted'>>,
): Promise<void> {
  const { data } = await supabase
    .from('goldx_licenses')
    .select('user_id')
    .eq('id', licenseId)
    .single();

  const userId = (data as Record<string, unknown> | null)?.user_id;
  if (typeof userId !== 'string') return;
  await updateOnboardingState(userId, updates);
}

export async function getLatestSetupRequest(userId: string): Promise<GoldxSetupRequest | null> {
  const { data } = await supabase
    .from('goldx_setup_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = snakeToCamel(data) as unknown as GoldxSetupRequest;
  return {
    ...row,
    mt5Login: aesDecrypt((data as Record<string, unknown>).mt5_login as string),
    email: aesDecrypt((data as Record<string, unknown>).email as string),
    note: typeof (data as Record<string, unknown>).note === 'string' ? aesDecrypt((data as Record<string, unknown>).note as string) : null,
    internalNotes: typeof (data as Record<string, unknown>).internal_notes === 'string' ? aesDecrypt((data as Record<string, unknown>).internal_notes as string) : null,
  };
}

export async function createSetupRequest(
  userId: string,
  input: { mt5Login: string; server: string; email: string; note?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('goldx_setup_requests')
    .insert({
      user_id: userId,
      mt5_login: aesEncrypt(input.mt5Login.trim()),
      server: input.server.trim(),
      email: aesEncrypt(input.email.trim()),
      note: input.note?.trim() ? aesEncrypt(input.note.trim()) : null,
      status: 'pending',
    });

  if (error) throw new Error(`Failed to create setup request: ${error.message}`);

  await insertAuditLog('goldx_setup_requested', {
    userId,
    meta: { server: input.server.trim() },
  });
}

async function readMaskedSetupRequest(row: Record<string, unknown>): Promise<GoldxMaskedSetupRequest> {
  const mt5Login = aesDecrypt(row.mt5_login as string);
  const email = aesDecrypt(row.email as string);
  const note = typeof row.note === 'string' ? aesDecrypt(row.note) : null;
  const internalNotes = typeof row.internal_notes === 'string' ? aesDecrypt(row.internal_notes) : null;

  return {
    id: row.id as string,
    userId: row.user_id as string,
    mt5LoginMasked: maskValue(mt5Login, 2, 2),
    server: row.server as string,
    emailMasked: maskEmail(email),
    notePreview: note ? `${note.slice(0, 80)}${note.length > 80 ? '...' : ''}` : null,
    status: row.status as GoldxSetupRequestStatus,
    internalNotesPreview: internalNotes ? `${internalNotes.slice(0, 80)}${internalNotes.length > 80 ? '...' : ''}` : null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function adminGetSetupRequests(): Promise<GoldxMaskedSetupRequest[]> {
  const { data } = await supabase
    .from('goldx_setup_requests')
    .select('*')
    .order('created_at', { ascending: false });

  const rows = (data ?? []) as Record<string, unknown>[];
  return Promise.all(rows.map(readMaskedSetupRequest));
}

export async function adminUpdateSetupRequest(
  requestId: string,
  adminUserId: string,
  updates: { status?: GoldxSetupRequestStatus; internalNotes?: string | null },
): Promise<void> {
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.status) payload.status = updates.status;
  if (typeof updates.internalNotes === 'string') payload.internal_notes = aesEncrypt(updates.internalNotes.trim());
  if (updates.internalNotes === null) payload.internal_notes = null;

  const { error } = await supabase
    .from('goldx_setup_requests')
    .update(payload)
    .eq('id', requestId);

  if (error) throw new Error(`Failed to update setup request: ${error.message}`);

  await insertAuditLog('goldx_setup_request_updated', {
    userId: adminUserId,
    meta: { requestId, status: updates.status ?? null },
  });
}

export async function getEaDownloadUrl(): Promise<string | null> {
  const envUrl = process.env.GOLDX_EA_DOWNLOAD_URL?.trim();
  if (envUrl) return envUrl;

  const { data } = await supabase
    .from('goldx_settings')
    .select('value')
    .eq('key', 'eaDownload')
    .maybeSingle();

  const value = data?.value;
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && typeof (value as Record<string, unknown>).url === 'string') {
    return (value as Record<string, unknown>).url as string;
  }
  return null;
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
  logVerifyDebug('==== VERIFY REQUEST START ====');
  logVerifyDebug('REQ BODY:', req);
  logVerifyDebug('SIGNATURE:', signature);
  logVerifyDebug('IP:', ip);

  // 1. Anti-replay: check timestamp
  if (!isTimestampValid(req.timestamp)) {
    logVerifyDebug('❌ FAILED: TIMESTAMP INVALID', req.timestamp);
    await insertAuditLog('verify_rejected_replay', { ip: ip ?? undefined, meta: { reason: 'timestamp' } });
    return { valid: false, error: 'Request expired or clock skew too large' };
  }
  logVerifyDebug('✅ PASSED: TIMESTAMP');

  // 2. Anti-replay: check nonce
  if (USED_NONCES.has(req.nonce)) {
    logVerifyDebug('❌ FAILED: NONCE REUSED', req.nonce);
    await insertAuditLog('verify_rejected_replay', { ip: ip ?? undefined, meta: { reason: 'nonce' } });
    return { valid: false, error: 'Duplicate request' };
  }
  logVerifyDebug('✅ PASSED: NONCE');
  USED_NONCES.set(req.nonce, Date.now());

  // 3. Verify HMAC signature
  const payloadCandidates = buildHmacPayloadCandidates(req);
  logVerifyDebug('HMAC PAYLOAD CANDIDATES:', payloadCandidates);
  const matchedPayload = payloadCandidates.find((payload) => verifyHmac(payload, signature)) ?? null;

  if (!SKIP_HMAC && !matchedPayload) {
    logVerifyDebug('❌ FAILED: HMAC INVALID');
    logVerifyDebug('EXPECTED HMAC CANDIDATES:', payloadCandidates.map((payload) => ({ payload, signature: computeHmac(payload) })));
    await insertAuditLog('verify_rejected_hmac', { ip: ip ?? undefined, meta: { mt5Account: req.mt5Account } });
    return { valid: false, error: 'Invalid signature' };
  }
  if (matchedPayload) {
    logVerifyDebug('✅ HMAC MATCHED PAYLOAD:', matchedPayload);
  }
  logVerifyDebug(SKIP_HMAC ? '⚠️ HMAC BYPASSED VIA DEBUG FLAG' : '✅ PASSED: HMAC');

  // 4. Look up license
  const licenseHash = hashLicenseKey(req.licenseKey);
  const license = await getLicenseByHash(licenseHash);
  logVerifyDebug('LICENSE FOUND:', license);
  if (!license) {
    logVerifyDebug('❌ FAILED: LICENSE NOT FOUND');
    await insertAuditLog('verify_rejected_notfound', { ip: ip ?? undefined });
    return { valid: false, error: 'License not found' };
  }

  // 5. Check status
  if (license.status !== 'active') {
    logVerifyDebug('❌ FAILED: LICENSE STATUS INVALID', license.status);
    await insertAuditLog('verify_rejected_status', { licenseId: license.id, ip: ip ?? undefined, meta: { status: license.status } });
    return { valid: false, error: `License ${license.status}` };
  }

  // 6. Check expiry
  if (new Date(license.expiresAt) < new Date()) {
    logVerifyDebug('❌ FAILED: LICENSE EXPIRED', license.expiresAt);
    await updateLicense(license.id, { status: 'expired' });
    await insertAuditLog('license_expired', { licenseId: license.id, ip: ip ?? undefined });
    return { valid: false, error: 'License expired' };
  }

  // 7. Bind MT5 account (first time) or verify match
  logVerifyDebug('CURRENT MT5 ACCOUNT:', license.mt5Account);
  logVerifyDebug('INCOMING MT5 ACCOUNT:', req.mt5Account);
  if (!license.mt5Account) {
    logVerifyDebug('🔗 BINDING NEW MT5 ACCOUNT:', req.mt5Account);

    await updateLicense(license.id, {
      mt5Account: req.mt5Account,
      deviceId: req.deviceId,
    });
  } else if (license.mt5Account !== req.mt5Account) {
    logVerifyDebug('❌ FAILED: ACCOUNT MISMATCH', {
      expected: license.mt5Account,
      received: req.mt5Account,
    });
    await insertAuditLog('verify_rejected_account_mismatch', {
      licenseId: license.id,
      ip: ip ?? undefined,
      meta: { expected: license.mt5Account, received: req.mt5Account },
    });
    return { valid: false, error: 'License bound to a different MT5 account' };
  } else {
    logVerifyDebug('✅ MT5 ACCOUNT ALREADY MATCHED');
  }

  const updatedLicense = await getLicenseByHash(licenseHash);
  logVerifyDebug('UPDATED LICENSE:', updatedLicense);
  if (!updatedLicense?.mt5Account || updatedLicense.mt5Account !== req.mt5Account) {
    logVerifyDebug('❌ FAILED: MT5 BINDING NOT PERSISTED', updatedLicense);
    await insertAuditLog('verify_rejected_binding_not_persisted', {
      licenseId: license.id,
      ip: ip ?? undefined,
      meta: { expected: req.mt5Account, actual: updatedLicense?.mt5Account ?? null },
    });
    return { valid: false, error: 'Failed to persist MT5 account binding' };
  }

  // 8. Update last checked
  await updateLicense(license.id, { lastCheckedAt: new Date().toISOString() });

  // 9. Issue session token
  const session = await createSession(license.id, ip);

  // 10. Get account state for mode config
  const accountState = await getOrCreateAccountState(license.id, req.mt5Account);
  const modeConfig = await getModeConfig(accountState.mode);
  await updateOnboardingState(license.userId, { hasConnectedMt5: true });

  await insertAuditLog('verify_success', {
    licenseId: license.id,
    userId: license.userId,
    ip: ip ?? undefined,
    meta: { mt5Account: req.mt5Account, mode: accountState.mode },
  });

  logVerifyDebug('✅ VERIFY SUCCESS', {
    licenseId: license.id,
    boundAccount: req.mt5Account,
    mode: accountState.mode,
  });

  return {
    valid: true,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    maxTradesPerDay: modeConfig.maxTrades,
    mode: accountState.mode,
    debug: {
      boundAccount: req.mt5Account,
      licenseId: license.id,
    },
  };
}

export async function debugBindLicense(
  licenseKey: string,
  mt5Account: string,
  deviceId = 'debug-bind-license',
): Promise<GoldxLicense> {
  const licenseHash = hashLicenseKey(licenseKey);
  const license = await getLicenseByHash(licenseHash);

  if (!license) {
    throw new Error('License not found');
  }

  await updateLicense(license.id, {
    mt5Account,
    deviceId,
  });

  const updatedLicense = await getLicenseByHash(licenseHash);
  if (!updatedLicense) {
    throw new Error('License disappeared after bind update');
  }

  await insertAuditLog('license_debug_bound', {
    licenseId: updatedLicense.id,
    userId: updatedLicense.userId,
    meta: { mt5Account, deviceId },
  });

  return updatedLicense;
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
  const periodStart = new Date().toISOString();
  const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (!activeSubscription) {
    const { error } = await supabase
      .from('goldx_subscriptions')
      .insert({
        user_id: userId,
        plan_id: plan.id,
        status: 'active',
        paypal_order_id: `admin-grant:${adminUserId}`,
        current_period_start: periodStart,
        current_period_end: periodEnd,
      });

    if (error) {
      throw new Error(`Failed to grant GoldX subscription: ${error.message}`);
    }
  } else if (!activeLicense) {
    const { error } = await supabase
      .from('goldx_subscriptions')
      .update({
        status: 'active',
        cancelled_at: null,
        paypal_order_id: `admin-regrant:${adminUserId}`,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeSubscription.id);

    if (error) {
      throw new Error(`Failed to reset GoldX subscription window: ${error.message}`);
    }
  }

  if (!activeLicense) {
    const { rawKey } = await createLicense(userId, periodEnd);
    createdLicenseKey = rawKey;
    await setPendingDashboardGrant(userId, {
      licenseKey: rawKey,
      issuedAt: periodStart,
      expiresAt: periodEnd,
    });
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
    .limit(10);

  const licenses = ((data ?? []) as Record<string, unknown>[])
    .map((row) => snakeToCamel(row) as unknown as GoldxLicense);

  if (!licenses.length) {
    return null;
  }

  const boundLicense = licenses.find((license) => Boolean(license.mt5Account));
  return boundLicense ?? licenses[0] ?? null;
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

export async function setUserSessionMode(userId: string, sessionMode: GoldxSessionMode): Promise<void> {
  const license = await getUserLicense(userId);
  if (!license) throw new Error('No active license');
  if (!license.mt5Account) throw new Error('No MT5 account bound');
  await updateAccountState(
    (await getOrCreateAccountState(license.id, license.mt5Account)).id,
    { sessionMode },
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
  DEBUG_MODE,
  SKIP_HMAC,
};
