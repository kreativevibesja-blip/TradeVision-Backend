import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { createOrder, captureOrder } from '../services/paypalService';

export const createPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { plan } = req.body;
    if (!plan || !['PRO'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    const pricing = await prisma.pricingPlan.findUnique({ where: { tier: plan } });
    const amount = pricing ? pricing.price.toString() : '19.00';
    const planName = pricing ? pricing.name : 'Pro';

    const order = await createOrder(amount, planName);

    await prisma.payment.create({
      data: {
        userId: req.user!.id,
        paypalOrderId: order.id,
        amount: parseFloat(amount),
        status: 'PENDING',
        plan: 'PRO',
      },
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
      await prisma.payment.update({
        where: { paypalOrderId: orderId },
        data: { status: 'COMPLETED' },
      });

      await prisma.user.update({
        where: { id: req.user!.id },
        data: { subscription: 'PRO' },
      });

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
    const payments = await prisma.payment.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ payments });
  } catch (error) {
    console.error('Payment history error:', error);
    return res.status(500).json({ error: 'Failed to retrieve payments' });
  }
};
