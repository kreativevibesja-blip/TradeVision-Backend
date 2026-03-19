import { listPaymentsForUserId, type PaymentRecord, type SubscriptionTier, updateUser } from '../lib/supabase';

export interface BillingSummary {
  currentPlan: SubscriptionTier;
  status: 'free' | 'active' | 'expired';
  expiresAt: string | null;
  lastPaymentAt: string | null;
  canCancel: boolean;
  canRenew: boolean;
  recentPayments: PaymentRecord[];
}

const BILLING_PERIOD_DAYS = 30;

const addDays = (dateIso: string, days: number) => {
  const date = new Date(dateIso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const getLatestCompletedProPayment = (payments: PaymentRecord[]) =>
  payments.find((payment) => payment.status === 'COMPLETED' && payment.plan === 'PRO') || null;

export async function getBillingSummaryForUser(userId: string, subscription: SubscriptionTier): Promise<BillingSummary> {
  const payments = await listPaymentsForUserId(userId);
  const latestCompletedProPayment = getLatestCompletedProPayment(payments);
  const expiresAt = latestCompletedProPayment ? addDays(latestCompletedProPayment.createdAt, BILLING_PERIOD_DAYS) : null;
  const isActive = Boolean(expiresAt && new Date(expiresAt).getTime() > Date.now() && subscription === 'PRO');
  const hadProPayment = Boolean(latestCompletedProPayment);

  if (subscription === 'PRO' && expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    await updateUser(userId, { subscription: 'FREE' });
    return {
      currentPlan: 'FREE',
      status: 'expired',
      expiresAt,
      lastPaymentAt: latestCompletedProPayment!.createdAt,
      canCancel: false,
      canRenew: true,
      recentPayments: payments.slice(0, 5),
    };
  }

  if (isActive) {
    return {
      currentPlan: 'PRO',
      status: 'active',
      expiresAt,
      lastPaymentAt: latestCompletedProPayment!.createdAt,
      canCancel: true,
      canRenew: false,
      recentPayments: payments.slice(0, 5),
    };
  }

  return {
    currentPlan: 'FREE',
    status: hadProPayment && expiresAt ? 'expired' : 'free',
    expiresAt,
    lastPaymentAt: latestCompletedProPayment?.createdAt ?? null,
    canCancel: false,
    canRenew: hadProPayment,
    recentPayments: payments.slice(0, 5),
  };
}
