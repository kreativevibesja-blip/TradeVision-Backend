import {
  getSystemSetting,
  hasPaidSubscription,
  listPaymentsForUserId,
  type PaymentMethod,
  type PaymentRecord,
  type SubscriptionTier,
  updateUser,
  upsertSystemSetting,
} from '../lib/supabase';

export interface BillingState {
  currentPlan: SubscriptionTier;
  status: 'free' | 'active' | 'expired' | 'cancelled';
  expiresAt: string | null;
  lastPaymentAt: string | null;
  canceledAt: string | null;
  source: 'payment' | 'admin' | 'user' | 'system';
}

export interface BillingSummary extends BillingState {
  canCancel: boolean;
  canRenew: boolean;
  recentPayments: PaymentRecord[];
}

const BILLING_PERIOD_DAYS = 30;
const BILLING_SETTING_PREFIX = 'billing:';

const isPaidMethod = (paymentMethod: PaymentMethod) => paymentMethod === 'PAYPAL' || paymentMethod === 'CARD' || paymentMethod === 'BANK_TRANSFER' || paymentMethod === 'COUPON';

const getPaymentEffectiveAt = (payment: PaymentRecord) => payment.verifiedAt || payment.createdAt;

const addDays = (dateIso: string, days: number) => {
  const date = new Date(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const getBillingKey = (userId: string) => `${BILLING_SETTING_PREFIX}${userId}`;

const getLatestCompletedPaidPayment = (payments: PaymentRecord[]) =>
  payments
    .filter((payment) => payment.status === 'COMPLETED' && payment.plan !== 'FREE' && isPaidMethod(payment.paymentMethod))
    .sort((left, right) => new Date(getPaymentEffectiveAt(right)).getTime() - new Date(getPaymentEffectiveAt(left)).getTime())[0] || null;

const isBillingState = (value: unknown): value is BillingState => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.currentPlan === 'FREE' || candidate.currentPlan === 'PRO' || candidate.currentPlan === 'TOP_TIER') &&
    typeof candidate.status === 'string' &&
    'expiresAt' in candidate &&
    'lastPaymentAt' in candidate &&
    'canceledAt' in candidate &&
    typeof candidate.source === 'string'
  );
};

export async function getStoredBillingState(userId: string): Promise<BillingState | null> {
  const setting = await getSystemSetting(getBillingKey(userId));
  return isBillingState(setting?.value) ? setting.value : null;
}

export async function persistBillingState(userId: string, state: BillingState) {
  await upsertSystemSetting(getBillingKey(userId), state);
  return state;
}

const bootstrapBillingState = async (userId: string, subscription: SubscriptionTier, payments: PaymentRecord[]) => {
  const latestCompletedPaidPayment = getLatestCompletedPaidPayment(payments);
  const lastPaymentAt = latestCompletedPaidPayment ? getPaymentEffectiveAt(latestCompletedPaidPayment) : null;
  const expiresAt = lastPaymentAt ? addDays(lastPaymentAt, BILLING_PERIOD_DAYS) : null;
  const activePaidPlan = hasPaidSubscription(subscription) ? subscription : latestCompletedPaidPayment?.plan || 'FREE';
  const hasActivePaidPlan = Boolean(activePaidPlan !== 'FREE' && expiresAt && new Date(expiresAt).getTime() > Date.now());

  const state: BillingState = hasActivePaidPlan
    ? {
        currentPlan: activePaidPlan,
        status: 'active',
        expiresAt,
        lastPaymentAt,
        canceledAt: null,
        source: 'system',
      }
    : {
        currentPlan: 'FREE',
        status: latestCompletedPaidPayment && expiresAt && new Date(expiresAt).getTime() <= Date.now() ? 'expired' : 'free',
        expiresAt,
        lastPaymentAt,
        canceledAt: null,
        source: 'system',
      };

  await persistBillingState(userId, state);
  return state;
};

export async function setBillingStateFromAdmin(userId: string, subscription: SubscriptionTier) {
  const currentState = await getStoredBillingState(userId);
  const now = new Date().toISOString();
  const hasCurrentActivePaidPlan = Boolean(
    currentState &&
      currentState.currentPlan !== 'FREE' &&
      currentState.expiresAt &&
      new Date(currentState.expiresAt).getTime() > Date.now()
  );
  const activeExpiresAt = hasCurrentActivePaidPlan && currentState ? currentState.expiresAt : null;

  const nextState: BillingState = subscription !== 'FREE'
    ? {
        currentPlan: subscription,
        status: 'active',
        expiresAt: activeExpiresAt ?? addDays(now, BILLING_PERIOD_DAYS),
        lastPaymentAt: currentState?.lastPaymentAt ?? now,
        canceledAt: null,
        source: 'admin',
      }
    : {
        currentPlan: 'FREE',
        status: currentState?.currentPlan !== 'FREE' || currentState?.status === 'active' ? 'cancelled' : 'free',
        expiresAt: currentState?.expiresAt ?? null,
        lastPaymentAt: currentState?.lastPaymentAt ?? null,
        canceledAt: now,
        source: 'admin',
      };

  await persistBillingState(userId, nextState);
  await updateUser(userId, { subscription: nextState.currentPlan });
  return nextState;
}

export async function setBillingStateFromPayment(userId: string, paymentAt: string, plan: Exclude<SubscriptionTier, 'FREE'>) {
  const state: BillingState = {
    currentPlan: plan,
    status: 'active',
    expiresAt: addDays(paymentAt, BILLING_PERIOD_DAYS),
    lastPaymentAt: paymentAt,
    canceledAt: null,
    source: 'payment',
  };

  await persistBillingState(userId, state);
  await updateUser(userId, { subscription: plan });
  return state;
}

export async function setBillingStateFromCancellation(userId: string) {
  const currentState = await getStoredBillingState(userId);
  const now = new Date().toISOString();

  const state: BillingState = {
    currentPlan: 'FREE',
    status: 'cancelled',
    expiresAt: currentState?.expiresAt ?? null,
    lastPaymentAt: currentState?.lastPaymentAt ?? null,
    canceledAt: now,
    source: 'user',
  };

  await persistBillingState(userId, state);
  await updateUser(userId, { subscription: 'FREE' });
  return state;
}

export async function getBillingSummaryForUser(userId: string, subscription: SubscriptionTier): Promise<BillingSummary> {
  const payments = await listPaymentsForUserId(userId);
  const storedState = (await getStoredBillingState(userId)) || (await bootstrapBillingState(userId, subscription, payments));
  let normalizedState = storedState;

  if (storedState.status === 'active' && storedState.expiresAt && new Date(storedState.expiresAt).getTime() <= Date.now()) {
    normalizedState = {
      ...storedState,
      currentPlan: 'FREE',
      status: 'expired',
      source: 'system',
    };
    await persistBillingState(userId, normalizedState);
    await updateUser(userId, { subscription: 'FREE' });
  }

  return {
    ...normalizedState,
    canCancel: normalizedState.status === 'active' && normalizedState.currentPlan !== 'FREE',
    canRenew: normalizedState.status === 'expired' || normalizedState.status === 'cancelled',
    recentPayments: payments.slice(0, 5),
  };
}