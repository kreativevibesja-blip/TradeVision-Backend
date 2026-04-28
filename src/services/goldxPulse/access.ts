import { getSystemSetting, hasTopTierAccess, type SubscriptionTier } from '../../lib/supabase';

const GOLDX_PULSE_SETTING_PREFIX = 'goldxPulse:subscription:';

type GoldxPulseSettingValue = {
  status?: 'active' | 'inactive' | 'cancelled' | 'expired' | 'trial';
  expiresAt?: string | null;
  planName?: string;
};

export interface GoldxPulseAccessSummary {
  active: boolean;
  source: 'admin' | 'pulse-subscription' | 'platform-plan' | 'none';
  planName: string | null;
  expiresAt: string | null;
  reason: string | null;
}

function isActiveSetting(value: GoldxPulseSettingValue | null) {
  if (!value) {
    return false;
  }

  if (value.status !== 'active' && value.status !== 'trial') {
    return false;
  }

  if (!value.expiresAt) {
    return true;
  }

  return new Date(value.expiresAt).getTime() > Date.now();
}

export async function getGoldxPulseAccess(
  userId: string,
  subscription: SubscriptionTier | string,
  role: string,
): Promise<GoldxPulseAccessSummary> {
  if (role === 'ADMIN') {
    return {
      active: true,
      source: 'admin',
      planName: 'Admin override',
      expiresAt: null,
      reason: null,
    };
  }

  const setting = await getSystemSetting(`${GOLDX_PULSE_SETTING_PREFIX}${userId}`);
  const value = (setting?.value ?? null) as GoldxPulseSettingValue | null;

  if (isActiveSetting(value)) {
    return {
      active: true,
      source: 'pulse-subscription',
      planName: value?.planName ?? 'GoldX Pulse',
      expiresAt: value?.expiresAt ?? null,
      reason: null,
    };
  }

  if (hasTopTierAccess(subscription)) {
    return {
      active: true,
      source: 'platform-plan',
      planName: 'TOP_TIER access bundle',
      expiresAt: null,
      reason: null,
    };
  }

  return {
    active: false,
    source: 'none',
    planName: value?.planName ?? null,
    expiresAt: value?.expiresAt ?? null,
    reason: value?.status && value.status !== 'active' ? `GoldX Pulse access is ${value.status}.` : 'GoldX Pulse subscription required.',
  };
}
