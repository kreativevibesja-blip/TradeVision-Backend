import { getSystemSetting, upsertSystemSetting, type CouponGrantPlan } from '../lib/supabase';

const PAYMENT_COUPON_CONTEXT_PREFIX = 'paymentCouponContext:';

export interface PaymentCouponContext {
  couponId: string;
  userId: string;
  grantPlan: CouponGrantPlan | null;
  grantDurationDays: number | null;
}

const getPaymentCouponContextKey = (paymentRef: string) => `${PAYMENT_COUPON_CONTEXT_PREFIX}${paymentRef}`;

const isPaymentCouponContext = (value: unknown): value is PaymentCouponContext => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const validGrantPlan = candidate.grantPlan === null || candidate.grantPlan === 'PRO' || candidate.grantPlan === 'TOP_TIER';
  const validGrantDurationDays = candidate.grantDurationDays === null || typeof candidate.grantDurationDays === 'number';

  return typeof candidate.couponId === 'string'
    && typeof candidate.userId === 'string'
    && validGrantPlan
    && validGrantDurationDays;
};

export const storePaymentCouponContext = async (paymentRef: string, context: PaymentCouponContext) => {
  await upsertSystemSetting(getPaymentCouponContextKey(paymentRef), context);
};

export const getPaymentCouponContext = async (paymentRef: string): Promise<PaymentCouponContext | null> => {
  const setting = await getSystemSetting(getPaymentCouponContextKey(paymentRef));
  return isPaymentCouponContext(setting?.value) ? setting.value : null;
};

export const clearPaymentCouponContext = async (paymentRef: string) => {
  await upsertSystemSetting(getPaymentCouponContextKey(paymentRef), null);
};