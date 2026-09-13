import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import { config } from '../config';
import { supabase } from '../lib/supabase';

type DerivAccountType = 'demo' | 'real';

type OAuthAttempt = {
  userId: string;
  state: string;
  codeVerifier: string;
  createdAt: number;
};

export interface DerivBotAccount {
  id: string;
  accountType: DerivAccountType;
  currency: string;
  balance: number | null;
  maskedAccountId: string;
}

const oauthAttempts = new Map<string, OAuthAttempt>();
const OAUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;

function requireBotConfig() {
  if (!config.deriv.botEnabled) throw new Error('Deriv Bot is not enabled.');
  if (!config.deriv.oauthClientId || !config.deriv.oauthRedirectUri) throw new Error('Deriv OAuth is not configured.');
  if (!config.deriv.tokenEncryptionKey) throw new Error('Deriv token encryption is not configured.');
}

function encryptionKey() {
  return createHash('sha256').update(config.deriv.tokenEncryptionKey).digest();
}

function encryptToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

function decryptToken(value: string) {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split('.');
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error('Stored Deriv token is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedEncoded, 'base64url')), decipher.final()]).toString('utf8');
}

function base64Url(value: Buffer) {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function maskAccountId(accountId: string) {
  return accountId.length > 4 ? `${accountId.slice(0, 2)}******${accountId.slice(-2)}` : '******';
}

function accountType(accountId: string, value: unknown): DerivAccountType {
  return Boolean(value) || /^(VRTC|CR)/i.test(accountId) ? 'demo' : 'real';
}

function cleanupOAuthAttempts() {
  const cutoff = Date.now() - OAUTH_ATTEMPT_TTL_MS;
  for (const [state, attempt] of oauthAttempts) {
    if (attempt.createdAt < cutoff) oauthAttempts.delete(state);
  }
}

export function createDerivOAuthUrl(userId: string) {
  requireBotConfig();
  cleanupOAuthAttempts();
  const state = randomUUID();
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
  oauthAttempts.set(state, { userId, state, codeVerifier, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: config.deriv.oauthClientId,
    redirect_uri: config.deriv.oauthRedirectUri,
    response_type: 'code',
    scope: 'trade',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://auth.deriv.com/oauth2/auth?${params.toString()}`;
}

async function exchangeCode(code: string, attempt: OAuthAttempt) {
  const response = await fetch('https://auth.deriv.com/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.deriv.oauthClientId,
      redirect_uri: config.deriv.oauthRedirectUri,
      code,
      code_verifier: attempt.codeVerifier,
    }),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== 'string') throw new Error('Deriv OAuth token exchange failed.');
  return payload.access_token;
}

export async function completeDerivOAuth(state: string, code: string) {
  requireBotConfig();
  const attempt = oauthAttempts.get(state);
  oauthAttempts.delete(state);
  if (!attempt || Date.now() - attempt.createdAt > OAUTH_ATTEMPT_TTL_MS) throw new Error('Deriv OAuth state is invalid or expired.');
  const accessToken = await exchangeCode(code, attempt);
  const accounts = await getDerivAccounts(accessToken);

  for (const account of accounts) {
    await supabase.from('deriv_bot_connections').upsert({
      user_id: attempt.userId,
      deriv_account_id: account.id,
      account_type: account.accountType,
      currency: account.currency,
      masked_account_id: account.maskedAccountId,
      encrypted_access_token: encryptToken(accessToken),
      status: 'connected',
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,deriv_account_id' });
  }

  return { userId: attempt.userId, accounts };
}

async function getDerivAccounts(accessToken: string): Promise<DerivBotAccount[]> {
  const response = await fetch(`${config.deriv.apiBaseUrl}/trading/v1/options/accounts`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.message === 'string' ? payload.message : 'Unable to load Deriv Options accounts.');
  const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.accounts) ? payload.accounts : [];
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    const id = String(item.account_id ?? item.id ?? '');
    return {
      id,
      accountType: accountType(id, item.is_virtual),
      currency: String(item.currency ?? 'USD'),
      balance: typeof item.balance === 'number' ? item.balance : Number.isFinite(Number(item.balance)) ? Number(item.balance) : null,
      maskedAccountId: maskAccountId(id),
    };
  }).filter((account) => account.id);
}

export async function listDerivAccounts(userId: string) {
  const { data, error } = await supabase.from('deriv_bot_connections').select('deriv_account_id,account_type,currency,masked_account_id').eq('user_id', userId).eq('status', 'connected');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.deriv_account_id),
    accountType: row.account_type as DerivAccountType,
    currency: String(row.currency),
    balance: null,
    maskedAccountId: String(row.masked_account_id),
  }));
}

export async function getStoredDerivToken(userId: string, accountId: string) {
  requireBotConfig();
  const { data, error } = await supabase.from('deriv_bot_connections').select('encrypted_access_token').eq('user_id', userId).eq('deriv_account_id', accountId).eq('status', 'connected').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.encrypted_access_token) throw new Error('Selected Deriv account is not connected.');
  await supabase.from('deriv_bot_connections').update({ last_used_at: new Date().toISOString() }).eq('user_id', userId).eq('deriv_account_id', accountId);
  return decryptToken(String(data.encrypted_access_token));
}

export async function disconnectDerivAccounts(userId: string) {
  const { error } = await supabase.from('deriv_bot_connections').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('user_id', userId);
  if (error) throw new Error(error.message);
}
