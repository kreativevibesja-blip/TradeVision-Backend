import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createOrder, captureOrder, generateClientToken } from '../services/paypalService';
import {
  type BankTransferBank,
  type BillingPlan,
  type PaymentMethod,
  type SubscriptionTier,
  createPaymentRecord,
  getPaymentByOrderId,
  getPricingPlanByTierWithFallback,
  listPaymentsForUserId,
  updatePaymentByOrderId,
} from '../lib/supabase';
import { getBillingSummaryForUser, setBillingStateFromCancellation, setBillingStateFromPayment } from '../services/billing';
import { validateCouponInternal, applyDiscount, incrementCouponUsage } from './couponController';
import { processReferralPayment, getReferralDiscountForUser } from '../services/referralService';
import { assertNoRefundPolicyAccepted, PolicyAcceptanceRequiredError } from '../services/policyAcceptance';
import { clearPaymentCouponContext, getPaymentCouponContext, storePaymentCouponContext } from '../services/paymentCouponContext';

const isCheckoutMethod = (value: unknown): value is Extract<PaymentMethod, 'PAYPAL' | 'CARD'> => value === 'PAYPAL' || value === 'CARD';
const isBankTransferBank = (value: unknown): value is BankTransferBank => value === 'SCOTIABANK' || value === 'NCB';

const createManualPaymentReference = () => `BANK-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

const resolvePlanPaymentAmount = async (userId: string, plan: Extract<SubscriptionTier, 'PRO' | 'TOP_TIER'>, couponCode?: string) => {
  const pricing = await getPricingPlanByTierWithFallback(plan);
  let amount = pricing ? pricing.price : plan === 'TOP_TIER' ? 39.95 : 9.95;
  let effectivePlan: Extract<SubscriptionTier, 'PRO' | 'TOP_TIER'> = plan;
  let planName = pricing ? pricing.name : plan === 'TOP_TIER' ? 'Top Tier 👑' : 'Pro';
  let appliedCoupon: { couponId: string; grantPlan: Extract<SubscriptionTier, 'PRO' | 'TOP_TIER'> | null; grantDurationDays: number | null } | null = null;

  const referralDiscount = await getReferralDiscountForUser(userId);
  if (referralDiscount > 0) {
    amount = Math.round(amount * (1 - referralDiscount / 100) * 100) / 100;
  }

  if (couponCode && typeof couponCode === 'string') {
    const couponResult = await validateCouponInternal(couponCode, userId);
    if (!couponResult.valid) {
      throw new Error(couponResult.message || 'Invalid coupon');
    }

    if (couponResult.specialOffer) {
      amount = Math.round(couponResult.specialOffer.overridePrice * 100) / 100;
      effectivePlan = couponResult.specialOffer.grantPlan;
      planName = couponResult.specialOffer.grantPlan === 'TOP_TIER' ? 'PRO+' : 'Pro';
    } else if (couponResult.discount) {
      amount = Math.round(applyDiscount(amount, couponResult.discount) * 100) / 100;
    }

    appliedCoupon = {
      couponId: couponResult.couponId!,
      grantPlan: couponResult.specialOffer?.grantPlan ?? null,
      grantDurationDays: couponResult.specialOffer?.grantDurationDays ?? null,
    };
  }

  return {
    amount,
    planName,
    appliedCoupon,
    effectivePlan,
  };
};

export const createPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { plan, couponCode, method, policyAccepted } = req.body;
    if (!plan || !['PRO', 'TOP_TIER'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const paymentMethod: Extract<PaymentMethod, 'PAYPAL' | 'CARD'> = isCheckoutMethod(method) ? method : 'PAYPAL';

    const selectedPlan = plan as Extract<SubscriptionTier, 'PRO' | 'TOP_TIER'>;
    await assertNoRefundPolicyAccepted({
      userId: req.user!.id,
      planId: selectedPlan,
      policyAccepted: policyAccepted === true,
      req,
      persistAcceptance: true,
    });
    const { amount, appliedCoupon, effectivePlan, planName } = await resolvePlanPaymentAmount(req.user!.id, selectedPlan, couponCode);

    if (amount <= 0) {
      // Free via full discount — activate immediately without PayPal
      await createPaymentRecord({
        userId: req.user!.id,
        paypalOrderId: `COUPON-${Date.now()}`,
        amount: 0,
        status: 'COMPLETED',
        paymentMethod: 'COUPON',
        plan: effectivePlan,
        verifiedAt: new Date().toISOString(),
      });

      if (appliedCoupon) {
        await incrementCouponUsage(appliedCoupon.couponId, req.user!.id);
      }

      await setBillingStateFromPayment(
        req.user!.id,
        new Date().toISOString(),
        appliedCoupon?.grantPlan ?? effectivePlan,
        appliedCoupon?.grantDurationDays ?? undefined,
      );
      return res.json({ orderId: null, approveUrl: null, freeActivation: true });
    }

    const order = await createOrder(amount.toString(), planName);

    await createPaymentRecord({
      userId: req.user!.id,
      paypalOrderId: order.id,
      amount,
      status: 'PENDING',
      paymentMethod,
      plan: effectivePlan,
    });

    if (appliedCoupon) {
      await storePaymentCouponContext(order.id, {
        couponId: appliedCoupon.couponId,
        userId: req.user!.id,
        grantPlan: appliedCoupon.grantPlan,
        grantDurationDays: appliedCoupon.grantDurationDays,
      });
    }

    const approveLink = order.links?.find((l) => l.rel === 'approve')?.href;

    return res.json({ orderId: order.id, approveUrl: approveLink });
  } catch (error) {
    if (error instanceof PolicyAcceptanceRequiredError) {
      return res.status(403).json({ error: 'Policy acceptance required.' });
    }
    console.error('Create payment error:', error);
    return res.status(500).json({ error: 'Payment creation failed' });
  }
};

export const createBankTransferRequest = async (req: AuthRequest, res: Response) => {
  try {
    const { plan, couponCode, bank, policyAccepted } = req.body;

    if (plan !== 'PRO' && plan !== 'TOP_TIER') {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    if (!isBankTransferBank(bank)) {
      return res.status(400).json({ error: 'Invalid bank selection' });
    }

    const selectedPlan = plan as Extract<SubscriptionTier, 'PRO' | 'TOP_TIER'>;
    await assertNoRefundPolicyAccepted({
      userId: req.user!.id,
      planId: selectedPlan,
      policyAccepted: policyAccepted === true,
      req,
      persistAcceptance: true,
    });
    const { amount, appliedCoupon, effectivePlan } = await resolvePlanPaymentAmount(req.user!.id, selectedPlan, couponCode);
    const referenceId = createManualPaymentReference();
    const payment = await createPaymentRecord({
      userId: req.user!.id,
      paypalOrderId: referenceId,
      amount,
      status: 'PENDING',
      paymentMethod: 'BANK_TRANSFER',
      bankTransferBank: bank,
      plan: effectivePlan as BillingPlan,
    });

    if (appliedCoupon) {
      await storePaymentCouponContext(referenceId, {
        couponId: appliedCoupon.couponId,
        userId: req.user!.id,
        grantPlan: appliedCoupon.grantPlan,
        grantDurationDays: appliedCoupon.grantDurationDays,
      });
    }

    return res.json({
      success: true,
      payment: {
        id: payment.id,
        referenceId: payment.paypalOrderId,
        bankTransferBank: payment.bankTransferBank,
        createdAt: payment.createdAt,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
  } catch (error) {
    if (error instanceof PolicyAcceptanceRequiredError) {
      return res.status(403).json({ error: 'Policy acceptance required.' });
    }
    console.error('Bank transfer request error:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create bank transfer request' });
  }
};

export const getPayPalClientToken = async (_req: AuthRequest, res: Response) => {
  try {
    const clientToken = await generateClientToken();
    return res.json({ clientToken });
  } catch (error) {
    console.error('PayPal client token error:', error);
    return res.status(500).json({ error: 'Failed to initialize card payments' });
  }
};

export const handlePaymentSuccess = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId, policyAccepted } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const existingPayment = await getPaymentByOrderId(orderId);
    if (!existingPayment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (existingPayment.userId !== req.user!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await assertNoRefundPolicyAccepted({
      userId: req.user!.id,
      planId: existingPayment.plan,
      policyAccepted: policyAccepted === true,
      req,
      persistAcceptance: false,
    });

    const capture = await captureOrder(orderId);

    if (capture.status === 'COMPLETED') {
      const payment = await updatePaymentByOrderId(orderId, { status: 'COMPLETED', verifiedAt: new Date().toISOString() });

      const couponInfo = await getPaymentCouponContext(orderId);
      if (couponInfo) {
        await incrementCouponUsage(couponInfo.couponId, couponInfo.userId).catch((err) =>
          console.error('Failed to track coupon usage:', err)
        );
        await clearPaymentCouponContext(orderId);
      }

      if (payment.plan !== 'PRO' && payment.plan !== 'TOP_TIER') {
        return res.status(400).json({ error: 'Unsupported payment plan' });
      }

      await setBillingStateFromPayment(
        req.user!.id,
        payment.verifiedAt || new Date().toISOString(),
        couponInfo?.grantPlan ?? payment.plan,
        couponInfo?.grantDurationDays ?? undefined,
      );

      // Process referral commission on successful payment
      await processReferralPayment(req.user!.id, payment.amount ?? 0).catch((err) =>
        console.error('Failed to process referral payment:', err)
      );

      return res.json({ success: true, message: 'Subscription activated' });
    }

    return res.status(400).json({ error: 'Payment not completed' });
  } catch (error) {
    if (error instanceof PolicyAcceptanceRequiredError) {
      return res.status(403).json({ error: 'Policy acceptance required.' });
    }
    console.error('Payment success error:', error);
    return res.status(500).json({ error: 'Payment processing failed' });
  }
};

export const getPaymentHistory = async (req: AuthRequest, res: Response) => {
  try {
    const payments = await listPaymentsForUserId(req.user!.id);

    return res.json({ payments });
  } catch (error) {
    console.error('Payment history error:', error);
    return res.status(500).json({ error: 'Failed to retrieve payments' });
  }
};

export const getBillingSummary = async (req: AuthRequest, res: Response) => {
  try {
    const summary = await getBillingSummaryForUser(req.user!.id, req.user!.subscription as SubscriptionTier);
    return res.json({ billing: summary });
  } catch (error) {
    console.error('Billing summary error:', error);
    return res.status(500).json({ error: 'Failed to retrieve billing summary' });
  }
};

export const cancelSubscription = async (req: AuthRequest, res: Response) => {
  try {
    await setBillingStateFromCancellation(req.user!.id);
    const summary = await getBillingSummaryForUser(req.user!.id, 'FREE');
    return res.json({ success: true, billing: summary });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
};

