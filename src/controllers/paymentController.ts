import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createOrder, captureOrder } from '../services/paypalService';
import {
  createPaymentRecord,
  getPricingPlanByTier,
  listPaymentsForUserId,
  updatePaymentByOrderId,
  updateUser,
} from '../lib/supabase';

export const createPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { plan } = req.body;
    if (!plan || !['PRO'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const pricing = await getPricingPlanByTier(plan);
    const amount = pricing ? pricing.price.toString() : '19.00';
    const planName = pricing ? pricing.name : 'Pro';

    const order = await createOrder(amount, planName);

    await createPaymentRecord({
      userId: req.user!.id,
      paypalOrderId: order.id,
      amount: parseFloat(amount),
      status: 'PENDING',
      plan: 'PRO',
    });

    const approveLink = order.links?.find((l) => l.rel === 'approve')?.href;

    return res.json({ orderId: order.id, approveUrl: approveLink });
  } catch (error) {
    console.error('Create payment error:', error);
    return res.status(500).json({ error: 'Payment creation failed' });
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
      await updatePaymentByOrderId(orderId, { status: 'COMPLETED' });

      await updateUser(req.user!.id, { subscription: 'PRO' });

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
