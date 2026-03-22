import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createOrder, captureOrder, generateClientToken } from '../services/paypalService';
import {
  createPaymentRecord,
  getPricingPlanByTierWithFallback,
  listPaymentsForUserId,
  updatePaymentByOrderId,
  getReferralByReferredUserId,
  getSystemSetting,
} from '../lib/supabase';
import { getBillingSummaryForUser, setBillingStateFromCancellation, setBillingStateFromPayment } from '../services/billing';
import { validateCouponInternal, applyDiscount, incrementCouponUsage } from './couponController';
import { processReferralPayment, getReferralDiscountForUser } from '../services/referralService';

export const createPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { plan, couponCode } = req.body;
    if (!plan || !['PRO'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const pricing = await getPricingPlanByTierWithFallback(plan);
    let amount = pricing ? pricing.price : 19;
    const planName = pricing ? pricing.name : 'Pro';

    let appliedCouponId: string | null = null;

    // Apply referral discount if user was referred and hasn't paid yet
    let referralDiscountApplied = false;
    const referralDiscount = await getReferralDiscountForUser(req.user!.id);
    if (referralDiscount > 0) {
      amount = Math.round(amount * (1 - referralDiscount / 100) * 100) / 100;
      referralDiscountApplied = true;
    }

    if (couponCode && typeof couponCode === 'string') {
      const couponResult = await validateCouponInternal(couponCode, req.user!.id);
      if (!couponResult.valid || !couponResult.discount) {
        return res.status(400).json({ error: couponResult.message });
      }
      amount = Math.round(applyDiscount(amount, couponResult.discount) * 100) / 100;
      appliedCouponId = couponResult.couponId!;
    }

    if (amount <= 0) {
      // Free via full discount — activate immediately without PayPal
      await createPaymentRecord({
        userId: req.user!.id,
        paypalOrderId: `COUPON-${Date.now()}`,
        amount: 0,
        status: 'COMPLETED',
        plan: 'PRO',
      });

      if (appliedCouponId) {
        await incrementCouponUsage(appliedCouponId, req.user!.id);
      }

      await setBillingStateFromPayment(req.user!.id, new Date().toISOString());
      return res.json({ orderId: null, approveUrl: null, freeActivation: true });
    }

    const order = await createOrder(amount.toString(), planName);

    await createPaymentRecord({
      userId: req.user!.id,
      paypalOrderId: order.id,
      amount,
      status: 'PENDING',
      plan: 'PRO',
    });

    // Stash coupon for post-capture usage tracking
    if (appliedCouponId) {
      pendingCouponMap.set(order.id, { couponId: appliedCouponId, userId: req.user!.id });
    }

    const approveLink = order.links?.find((l) => l.rel === 'approve')?.href;

    return res.json({ orderId: order.id, approveUrl: approveLink });
  } catch (error) {
    console.error('Create payment error:', error);
    return res.status(500).json({ error: 'Payment creation failed' });
  }
};

// Temporary in-memory map to track which order used a coupon.
// In a production cluster you would use a DB column on the Payment table instead.
const pendingCouponMap = new Map<string, { couponId: string; userId: string }>();

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
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    const capture = await captureOrder(orderId);

    if (capture.status === 'COMPLETED') {
      const payment = await updatePaymentByOrderId(orderId, { status: 'COMPLETED' });

      // Track coupon usage if this order used a coupon
      const couponInfo = pendingCouponMap.get(orderId);
      if (couponInfo) {
        await incrementCouponUsage(couponInfo.couponId, couponInfo.userId).catch((err) =>
          console.error('Failed to track coupon usage:', err)
        );
        pendingCouponMap.delete(orderId);
      }

      await setBillingStateFromPayment(req.user!.id, payment.createdAt);

      // Process referral commission on successful payment
      await processReferralPayment(req.user!.id, payment.amount ?? 0).catch((err) =>
        console.error('Failed to process referral payment:', err)
      );

      return res.json({ success: true, message: 'Subscription activated' });
    }

    return res.status(400).json({ error: 'Payment not completed' });
  } catch (error) {
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
    const summary = await getBillingSummaryForUser(req.user!.id, req.user!.subscription as 'FREE' | 'PRO');
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
